import path from 'node:path';
import fs from 'node:fs';
import { getDb, paths } from '../db.js';
import { determineArchivePdfPath, localDateString, moveOrCopySync, planArchivePdf } from './ocr.js';

/** Unterordner im Archiv, in dem die PDFs gelöschter Belege liegen. */
export const TRASH_DIR_NAME = '_Papierkorb';

/** Nach so vielen Tagen im Papierkorb wird endgültig gelöscht. */
export const TRASH_RETENTION_DAYS = 30;

export interface TrashResult {
  code: number;
  body: any;
}

export function trashDir(): string {
  return path.join(paths.archiveDir, TRASH_DIR_NAME);
}

/** Kollisionsfreier Zielpfad für das PDF eines Belegs im Papierkorb. */
function planTrashPdf(doc: {
  title: string | null;
  doc_date: string | null;
  pdf_path: string | null;
  original_name: string | null;
  created_at: string | null;
}): string | null {
  if (!doc.pdf_path || !fs.existsSync(doc.pdf_path)) return null;

  const target = trashDir();
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

  const dateStr =
    doc.doc_date && /^\d{4}-\d{2}-\d{2}$/.test(doc.doc_date.trim())
      ? doc.doc_date.trim()
      : localDateString(doc.created_at);
  const title = (doc.title && doc.title.trim()) || (doc.original_name ? path.parse(doc.original_name).name : 'Beleg');

  return determineArchivePdfPath(target, dateStr, title, doc.pdf_path);
}

/**
 * Beleg in den Papierkorb legen: deleted_at setzen, PDF nach Archiv/_Papierkorb/ verschieben.
 * Original, Vorschaubild und Arbeitsdateien bleiben liegen, damit Wiederherstellen möglich ist.
 * Dateisystem zuerst, dann DB (Regel 7).
 */
export function trashDocument(id: number): TrashResult {
  const db = getDb();
  const doc = db
    .prepare('SELECT id, title, doc_date, pdf_path, original_name, created_at, deleted_at FROM documents WHERE id = ?')
    .get(id) as any;
  if (!doc) return { code: 404, body: { error: 'Dokument nicht gefunden.' } };
  if (doc.deleted_at) return { code: 200, body: { ok: true, id, already: true } };

  let newPdfPath = doc.pdf_path;
  try {
    const target = planTrashPdf(doc);
    if (target && target !== doc.pdf_path) {
      moveOrCopySync(doc.pdf_path, target);
      newPdfPath = target;
    }
  } catch (fsErr: any) {
    console.error(`[Papierkorb] PDF von Dokument ${id} konnte nicht verschoben werden:`, fsErr);
    return { code: 500, body: { error: `PDF konnte nicht in den Papierkorb verschoben werden: ${fsErr?.message || fsErr}` } };
  }

  try {
    db.prepare(`
      UPDATE documents
      SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
          pdf_path = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(newPdfPath, id);
  } catch (dbErr) {
    // DB-Update gescheitert: PDF zurück an den alten Ort, damit DB und Archiv übereinstimmen
    if (newPdfPath !== doc.pdf_path && doc.pdf_path) {
      try {
        moveOrCopySync(newPdfPath, doc.pdf_path);
      } catch (rbErr) {
        console.error(`[Papierkorb] Rücknahme des PDF-Verschiebens für ${id} fehlgeschlagen:`, rbErr);
      }
    }
    throw dbErr;
  }

  console.log(`[Papierkorb] Dokument ${id} in den Papierkorb gelegt.`);
  return { code: 200, body: { ok: true, id } };
}

/**
 * Beleg aus dem Papierkorb zurückholen: PDF wandert zurück nach Archiv/<Ordner>/ bzw. _Eingang/,
 * deleted_at wird geleert und der Status aus dem Ordner abgeleitet.
 */
export function restoreDocument(id: number): TrashResult {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  if (!doc) return { code: 404, body: { error: 'Dokument nicht gefunden.' } };
  if (!doc.deleted_at) return { code: 409, body: { error: 'Dokument liegt nicht im Papierkorb.' } };

  let newPdfPath = doc.pdf_path;
  try {
    const target = planArchivePdf(doc);
    if (target && target !== doc.pdf_path) {
      moveOrCopySync(doc.pdf_path, target);
      newPdfPath = target;
    }
  } catch (fsErr: any) {
    console.error(`[Papierkorb] PDF von Dokument ${id} konnte nicht zurückverschoben werden:`, fsErr);
    return { code: 500, body: { error: `PDF konnte nicht wiederhergestellt werden: ${fsErr?.message || fsErr}` } };
  }

  // Fehlerhafte Belege bleiben fehlerhaft, alles andere richtet sich nach dem Ordner
  const status = doc.status === 'inbox' || doc.status === 'filed' ? (doc.folder_id !== null ? 'filed' : 'inbox') : doc.status;

  try {
    db.prepare(`
      UPDATE documents
      SET deleted_at = NULL,
          status = ?,
          pdf_path = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(status, newPdfPath, id);
  } catch (dbErr) {
    if (newPdfPath !== doc.pdf_path && doc.pdf_path) {
      try {
        moveOrCopySync(newPdfPath, doc.pdf_path);
      } catch (rbErr) {
        console.error(`[Papierkorb] Rücknahme der Wiederherstellung für ${id} fehlgeschlagen:`, rbErr);
      }
    }
    throw dbErr;
  }

  console.log(`[Papierkorb] Dokument ${id} wiederhergestellt.`);
  return { code: 200, body: { ok: true, id } };
}

/**
 * Endgültig löschen: Original, PDF, Vorschaubild und Arbeitsdateien entfernen, danach den
 * Datenbankeintrag. Zeilen in document_pages verschwinden per ON DELETE CASCADE; Seiten anderer
 * Dokumente, die auf diesen Beleg zeigten, werden auf NULL gesetzt (ON DELETE SET NULL).
 */
export function purgeDocument(id: number): TrashResult {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  if (!doc) return { code: 404, body: { error: 'Dokument nicht gefunden.' } };

  const filesToDelete = [
    doc.original_path,
    doc.thumb_path,
    doc.pdf_path,
    path.join(paths.workDir, `${id}.png`),
    path.join(paths.workDir, `${id}.jpg`),
  ].filter(Boolean) as string[];

  for (const filePath of filesToDelete) {
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
