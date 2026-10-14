import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, paths } from './db.js';
import {
  archiveDirForFolder,
  copyDirSync,
  groupLabel,
  homeDirFor,
  originalSuffix,
  planGroup,
  executePlan,
  applyPlanToDb,
  reserveBase,
  localDateString,
  sanitizeFilenameTitle,
  syncDocumentFiles,
} from './pipeline/files.js';

/**
 * Einmaliger Umzug vom alten Datenordner (./data mit originals/<id>.*, thumbs/, work/, scanny.db)
 * in den neuen Haushalt unter SCANNY_DIR (System/ + Originale neben ihrem PDF im Archiv).
 *
 * Läuft nur, wenn LEGACY_DATA_DIR gesetzt ist, dort eine scanny.db liegt und in System/ noch KEINE
 * existiert – also genau einmal. Vorher wird der komplette alte Ordner nach
 * System/_Sicherung-vor-Umzug-<Datum>/ kopiert; der alte Ordner selbst bleibt unangetastet.
 * Muss VOR dem ersten getDb() laufen.
 */
export function migrateLegacyStorage(): void {
  const legacy = paths.legacyDataDir;
  if (!legacy) return;
  const legacyDb = path.join(legacy, 'scanny.db');
  if (!fs.existsSync(legacyDb)) return;
  if (fs.existsSync(paths.dbPath)) return; // schon umgezogen

  console.log(`[Umzug] Alter Datenordner gefunden (${legacy}) – ziehe nach ${paths.dataDir} um...`);

  // 1. Sicherung des kompletten alten Ordners
  const backupDir = path.join(paths.dataDir, `_Sicherung-vor-Umzug-${localDateString()}`);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  copyDirSync(legacy, backupDir);
  console.log(`[Umzug] Sicherung angelegt: ${backupDir}`);

  // 2. Datenbank konsistent kopieren (VACUUM INTO übernimmt auch Änderungen aus der WAL-Datei)
  // Aus der Sicherungskopie lesen: der alte Ordner bleibt so garantiert unberührt (darf :ro sein)
  const old = new Database(path.join(backupDir, 'scanny.db'));
  try {
    old.prepare('VACUUM INTO ?').run(paths.dbPath);
  } finally {
    old.close();
  }

  // 3. Neue DB öffnen (führt Migrationen bis zur aktuellen Version aus)
  const db = getDb();
  const legacyFile = (stored: string | null, sub: string): string | null => {
    if (!stored) return null;
    const candidate = path.join(legacy, sub, path.basename(stored));
    return fs.existsSync(candidate) ? candidate : null;
  };

  // 4. Cache: Vorschaubilder und Arbeitsdateien (aufbereitete Scans) übernehmen
  for (const [sub, target] of [
    ['thumbs', paths.thumbsDir],
    ['work', paths.workDir],
  ] as const) {
    const src = path.join(legacy, sub);
    if (fs.existsSync(src)) copyDirSync(src, target);
  }
  const setThumb = db.prepare('UPDATE documents SET thumb_path = ? WHERE id = ?');
  for (const row of db.prepare('SELECT id, thumb_path FROM documents WHERE thumb_path IS NOT NULL').all() as any[]) {
    setThumb.run(path.join(paths.thumbsDir, path.basename(row.thumb_path)), row.id);
  }

  // 5. Originale mit sprechendem Namen neben ihr PDF kopieren
  const docs = db
    .prepare('SELECT * FROM documents ORDER BY merged_into IS NOT NULL, id')
    .all() as any[];
  let moved = 0;
  const missing: number[] = [];

  for (const doc of docs) {
    const src = legacyFile(doc.original_path, 'originals');
    if (!src) {
      if (doc.original_path) missing.push(doc.id);
      if (doc.original_path) db.prepare('UPDATE documents SET original_path = NULL WHERE id = ?').run(doc.id);
      continue;
    }
    const suffix = originalSuffix(src);
    const dir = doc.pdf_path ? path.dirname(doc.pdf_path) : archiveDirForFolder(doc.folder_id);
    fs.mkdirSync(dir, { recursive: true });
    const label = doc.pdf_path ? path.basename(doc.pdf_path).replace(/\.pdf$/i, '') : groupLabel(doc);
    const own = new Set<string>(doc.pdf_path ? [doc.pdf_path] : []);
    const base = reserveBase(dir, label, [suffix], own);
    const target = path.join(dir, base + suffix);
    fs.copyFileSync(src, target);
    db.prepare('UPDATE documents SET original_path = ? WHERE id = ?').run(target, doc.id);
    moved++;
  }

  // 6. Gruppen ausrichten: gemeinsamer Name, richtiger Ordner; Stapel-Teile in "<Name> (Originale)/"
  for (const doc of docs) {
    try {
      if (doc.merged_into) {
        const fresh = db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id) as any;
        const page = db
          .prepare('SELECT page_no FROM document_pages WHERE document_id = ? AND source_document_id = ?')
          .get(doc.merged_into, doc.id) as { page_no: number } | undefined;
        const title = sanitizeFilenameTitle(
          (fresh.title && fresh.title.trim()) || (fresh.original_name ? path.parse(fresh.original_name).name : 'Beleg')
        );
        const plan = planGroup(fresh, {
          targetDir: homeDirFor(fresh),
          label: `${String(page?.page_no ?? 0).padStart(2, '0')} ${title}`,
        });
        executePlan(plan);
        db.transaction(() => applyPlanToDb(plan))();
      } else {
        syncDocumentFiles(doc.id, { force: true });
      }
    } catch (err) {
      console.warn(`[Umzug] Dateigruppe von Dokument ${doc.id} konnte nicht ausgerichtet werden:`, err);
    }
  }

  fs.writeFileSync(
    path.join(backupDir, 'UMZUG.txt'),
    `Umzug am ${new Date().toISOString()}\n${moved} Originale übernommen.\n` +
      (missing.length ? `Fehlende Originale (Dokument-IDs): ${missing.join(', ')}\n` : '') +
      `Diese Sicherung kann gelöscht werden, sobald alles geprüft ist.\n`
  );
  console.log(
    `[Umzug] Fertig: ${docs.length} Belege, ${moved} Originale übernommen` +
      (missing.length ? `, fehlend: ${missing.join(', ')}` : '') +
      '.'
  );
}
