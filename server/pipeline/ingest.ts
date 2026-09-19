import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import exifr from 'exifr';
import { getDb, paths } from '../db.js';
import { documentQueue } from './queue.js';

export interface IngestOptions {
  sourcePath: string;
  source: 'folder' | 'upload';
  originalName?: string;
  importBatch?: string | null;
  clientLastModified?: number | string | null;
}

function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fileBuffer = fs.readFileSync(filePath);
  hash.update(fileBuffer);
  return hash.digest('hex');
}

async function extractFileDate(filePath: string, clientLastModified?: number | string | null): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();

  // 1. Bei JPEG/HEIC zuerst Aufnahmedatum aus EXIF (DateTimeOriginal, CreateDate) prüfen
  if (['.jpg', '.jpeg', '.heic', '.heif'].includes(ext)) {
    try {
      const exif = await exifr.parse(filePath, ['DateTimeOriginal', 'CreateDate']);
      if (exif?.DateTimeOriginal instanceof Date && !isNaN(exif.DateTimeOriginal.getTime())) {
        return formatLocalDate(exif.DateTimeOriginal);
      }
      if (exif?.CreateDate instanceof Date && !isNaN(exif.CreateDate.getTime())) {
        return formatLocalDate(exif.CreateDate);
      }
    } catch {
      // EXIF nicht lesbar oder nicht vorhanden
    }
  }

  // 2. Client lastModified (beim Browser-Upload übermittelt)
  if (clientLastModified) {
    const ts = typeof clientLastModified === 'string' ? parseInt(clientLastModified, 10) : clientLastModified;
    if (!isNaN(ts) && ts > 0) {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) {
        return formatLocalDate(d);
      }
    }
  }

  // 3. Fallback auf fs.stat().mtime (z. B. für Upload-Ordner)
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.mtime && !isNaN(stat.mtime.getTime())) {
        return formatLocalDate(stat.mtime);
      }
    }
  } catch {}

  return null;
}

/**
 * Robuste Verschiebe-Funktion für Cross-Device (EXDEV) Bind-Mounts
 */
export function moveOrCopySync(src: string, dest: string): void {
  const srcStat = fs.statSync(src);
  try {
    fs.renameSync(src, dest);
  } catch (err: any) {
    if (err?.code === 'EXDEV' || err?.code === 'EACCES' || err?.code === 'EPERM' || err?.code === 'EBUSY') {
      fs.copyFileSync(src, dest);
      const destStat = fs.statSync(dest);
      if (srcStat.size !== destStat.size) {
        try {
          fs.unlinkSync(dest);
        } catch {}
        throw new Error(
          `Verschieben fehlgeschlagen: Quellgröße (${srcStat.size} Bytes) weicht von Zielgröße (${destStat.size} Bytes) ab.`
        );
      }
      fs.utimesSync(dest, srcStat.atime, srcStat.mtime);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

/**
 * Übernimmt eine Datei (aus dem Upload-Ordner oder per Web-Upload),
 * legt den DB-Datensatz an, verschiebt das Original und reiht es in die Queue ein.
 */
export async function ingestFile(options: IngestOptions): Promise<number> {
  const db = getDb();
  const rawOriginalName = options.originalName || path.basename(options.sourcePath);
  const ext = path.extname(rawOriginalName).toLowerCase() || path.extname(options.sourcePath).toLowerCase();
  const initialTitle = path.parse(rawOriginalName).name;

  // 1. Dateidatum (EXIF / clientLastModified / fs.stat().mtime) ermitteln, BEVOR die Datei verschoben wird
  let fileDate: string | null = null;
  try {
    fileDate = await extractFileDate(options.sourcePath, options.clientLastModified);
  } catch (dateErr) {
    console.warn(`[Ingest] Konnte Dateidatum vor Verschieben nicht ermitteln:`, dateErr);
  }

  // 2. Dokument-Datensatz anlegen (status 'queued')
  const defaultModeRow = db
    .prepare("SELECT value FROM settings WHERE key = 'default_color_mode'")
    .get() as { value: string } | undefined;
  const initialColorMode =
    defaultModeRow?.value && ['bw', 'gray', 'color'].includes(defaultModeRow.value)
      ? defaultModeRow.value
      : 'bw';

  const insertStmt = db.prepare(`
    INSERT INTO documents (
      status,
      source,
      import_batch,
      original_name,
      title,
      color_mode,
      created_at,
      updated_at
    ) VALUES (
      'queued',
      ?,
      ?,
      ?,
      ?,
      ?,
      strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    )
  `);

  const info = insertStmt.run(
    options.source,
    options.importBatch || null,
    rawOriginalName,
    initialTitle,
    initialColorMode
  );
  const docId = Number(info.lastInsertRowid);

  // 3. Datei nach DATA_DIR/originals/<id>.<ext> verschieben
  if (!fs.existsSync(paths.originalsDir)) {
    fs.mkdirSync(paths.originalsDir, { recursive: true });
  }

  const destPath = path.join(paths.originalsDir, `${docId}${ext}`);

  try {
    moveOrCopySync(options.sourcePath, destPath);
  } catch (err: any) {
    const errorMsg = `Verschieben ins Originale-Archiv fehlgeschlagen: ${err?.message || err}`;
    console.error(`[Ingest] ${errorMsg}`);
    db.prepare(`
      UPDATE documents
      SET status = 'error',
          error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(errorMsg, docId);
    return docId;
  }

  // 4. SHA-256 Hash berechnen
  let fileSha256: string | null = null;
  try {
    fileSha256 = computeSha256(destPath);
  } catch (hashErr) {
    console.warn(`[Ingest] Konnte SHA-256 für Dokument ${docId} nicht berechnen:`, hashErr);
  }

  // 5. original_path, sha256 und file_date setzen
  db.prepare(`
    UPDATE documents
    SET original_path = ?,
        sha256 = ?,
        file_date = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = ?
  `).run(destPath, fileSha256, fileDate, docId);

  console.log(
    `[Ingest] Dokument ${docId} ("${rawOriginalName}") erfasst (Dateidatum: ${fileDate || '–'}, SHA-256: ${fileSha256?.slice(0, 10)}…) -> ${destPath}`
  );

  // 6. Job in die Warteschlange einreihen
  documentQueue.enqueue(docId);

  return docId;
}

