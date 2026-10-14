import path from 'node:path';
import fs from 'node:fs';
import { getDb, paths } from '../db.js';
import { applyPlanToDb, deleteGroupFiles, executePlan, isBusy, planGroup, revertPlan } from './files.js';

export { TRASH_DIR_NAME, trashDir } from './files.js';

/** Nach so vielen Tagen im Papierkorb wird endgültig gelöscht. */
export const TRASH_RETENTION_DAYS = 30;

export interface TrashResult {
  code: number;
  body: any;
}

/**
 * Beleg in den Papierkorb legen: deleted_at setzen, die ganze Dateigruppe (PDF, Original,
 * ggf. Teile-Ordner) nach Archiv/_Papierkorb/ verschieben. Dateisystem zuerst, dann DB (Regel 7).
 */
export function trashDocument(id: number): TrashResult {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  if (!doc) return { code: 404, body: { error: 'Dokument nicht gefunden.' } };
  if (doc.deleted_at) return { code: 200, body: { ok: true, id, already: true } };
  if (doc.merged_into) {
    return { code: 409, body: { error: 'Dieser Beleg ist Teil eines zusammengefügten Dokuments.' } };
  }
  if (isBusy(doc)) {
    return { code: 409, body: { error: 'Der Beleg wird gerade verarbeitet – bitte kurz warten.' } };
  }

  let plan;
  try {
    plan = planGroup({ ...doc, deleted_at: 'jetzt' });
    executePlan(plan);
  } catch (fsErr: any) {
    console.error(`[Papierkorb] Dateien von Dokument ${id} konnten nicht verschoben werden:`, fsErr);
    return { code: 500, body: { error: `Dateien konnten nicht in den Papierkorb verschoben werden: ${fsErr?.message || fsErr}` } };
  }

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE documents
        SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?
      `).run(id);
      applyPlanToDb(plan);
    })();
  } catch (dbErr) {
    revertPlan(plan);
    throw dbErr;
  }

  console.log(`[Papierkorb] Dokument ${id} in den Papierkorb gelegt.`);
  return { code: 200, body: { ok: true, id } };
}

/**
 * Beleg aus dem Papierkorb zurückholen: Dateigruppe wandert zurück nach Archiv/<Ordner>/ bzw. _Eingang/,
 * deleted_at wird geleert und der Status aus dem Ordner abgeleitet.
 */
export function restoreDocument(id: number): TrashResult {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  if (!doc) return { code: 404, body: { error: 'Dokument nicht gefunden.' } };
  if (!doc.deleted_at) return { code: 409, body: { error: 'Dokument liegt nicht im Papierkorb.' } };

  let plan;
  try {
    plan = planGroup({ ...doc, deleted_at: null, merged_into: null });
    executePlan(plan);
  } catch (fsErr: any) {
    console.error(`[Papierkorb] Dateien von Dokument ${id} konnten nicht zurückverschoben werden:`, fsErr);
    return { code: 500, body: { error: `Beleg konnte nicht wiederhergestellt werden: ${fsErr?.message || fsErr}` } };
  }

  // Fehlerhafte Belege bleiben fehlerhaft, alles andere richtet sich nach dem Ordner
  const status = doc.status === 'inbox' || doc.status === 'filed' ? (doc.folder_id !== null ? 'filed' : 'inbox') : doc.status;

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE documents
        SET deleted_at = NULL,
            merged_into = NULL,
            status = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?
      `).run(status, id);
      applyPlanToDb(plan);
    })();
  } catch (dbErr) {
    revertPlan(plan);
    throw dbErr;
  }

  console.log(`[Papierkorb] Dokument ${id} wiederhergestellt.`);
  return { code: 200, body: { ok: true, id } };
}

/**
 * Endgültig löschen: zuerst die Teile eines Stapels, dann PDF, Original, Teile-Ordner, Vorschaubild
 * und Arbeitsdateien, danach den Datenbankeintrag. Zeilen in document_pages verschwinden per
 * ON DELETE CASCADE; Seiten anderer Dokumente, die auf diesen Beleg zeigten, werden NULL.
 */
export function purgeDocument(id: number): TrashResult {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  if (!doc) return { code: 404, body: { error: 'Dokument nicht gefunden.' } };

  const parts = db.prepare('SELECT id FROM documents WHERE merged_into = ?').all(id) as { id: number }[];
  for (const part of parts) purgeDocument(part.id);

  deleteGroupFiles(doc);
  for (const filePath of [
    doc.thumb_path,
    path.join(paths.workDir, `${id}.png`),
    path.join(paths.workDir, `${id}.jpg`),
  ].filter(Boolean) as string[]) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (fErr) {
      console.warn(`[Papierkorb] Konnte Datei ${filePath} nicht löschen:`, fErr);
    }
  }

  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  console.log(`[Papierkorb] Dokument ${id} endgültig gelöscht.`);
  return { code: 200, body: { ok: true, id, message: `Dokument ${id} endgültig gelöscht.` } };
}

/** Alle Belege endgültig löschen, die länger als TRASH_RETENTION_DAYS im Papierkorb liegen. */
export function purgeExpiredTrash(): number {
  const rows = getDb()
    .prepare(
      `SELECT id FROM documents
       WHERE deleted_at IS NOT NULL
         AND merged_into IS NULL
         AND deleted_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)`
    )
    .all(`-${TRASH_RETENTION_DAYS} days`) as { id: number }[];

  for (const row of rows) {
    try {
      purgeDocument(row.id);
    } catch (err) {
      console.warn(`[Papierkorb] Automatisches Löschen von Dokument ${row.id} fehlgeschlagen:`, err);
    }
  }

  if (rows.length > 0) {
    console.log(`[Papierkorb] ${rows.length} Beleg(e) nach ${TRASH_RETENTION_DAYS} Tagen endgültig gelöscht.`);
  }
  return rows.length;
}

/** Beim Serverstart einmal aufräumen und danach täglich wiederholen. */
export function startTrashCleanup(): void {
  try {
    purgeExpiredTrash();
  } catch (err) {
    console.warn('[Papierkorb] Aufräumen beim Start fehlgeschlagen:', err);
  }

  const timer = setInterval(() => {
    try {
      purgeExpiredTrash();
    } catch (err) {
      console.warn('[Papierkorb] Tägliches Aufräumen fehlgeschlagen:', err);
    }
  }, 24 * 60 * 60 * 1000);
  timer.unref?.();
}
