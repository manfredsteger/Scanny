import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { getDb, paths } from '../db.js';
import { runOcrPipeline, syncArchivePdf } from './ocr.js';
import { detectDocument } from './extract.js';
import { buildTitle } from './title.js';

const execFileAsync = promisify(execFile);

// Verzeichnis dieser Datei bestimmen (für Fallback-Pfad zu scan.py)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scan.py-Pfad auflösen: Bevorzugt server/pipeline/scan.py relativ zum Arbeitsverzeichnis (cwd),
// mit Fallback auf den Pfad relativ zu __dirname
function resolveScanPyPath(): string {
  const cwdPath = path.resolve(process.cwd(), 'server/pipeline/scan.py');
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }
  const dirnamePath = path.resolve(__dirname, 'scan.py');
  if (fs.existsSync(dirnamePath)) {
    return dirnamePath;
  }
  return cwdPath;
}

export const SCAN_PY_PATH = resolveScanPyPath();

export interface ScanResult {
  ok: boolean;
  corners?: [number, number][];
  detected?: boolean;
  width?: number;
  height?: number;
  layout?: 'a4' | 'fit';
  error?: string;
}

/**
 * Ruft scan.py auf, um Ecken zu erkennen oder das Bild zu entzerren und nach A4 aufzubereiten.
 */
export async function runScanPy(options: {
  inputPath: string;
  outputPath?: string;
  mode?: 'bw' | 'gray' | 'color';
  corners?: string | null;
  rotation?: number;
  detectOnly?: boolean;
}): Promise<ScanResult> {
  const args = [SCAN_PY_PATH, '--in', options.inputPath];

  if (options.outputPath) {
    args.push('--out', options.outputPath);
  }

  if (options.mode) {
    args.push('--mode', options.mode);
  }

  if (options.rotation !== undefined && [0, 90, 180, 270].includes(options.rotation)) {
    args.push('--rotation', String(options.rotation));
  }

  if (options.corners) {
    args.push('--corners', options.corners);
  }

  if (options.detectOnly) {
    args.push('--detect-only');
  }

  try {
    const { stdout, stderr } = await execFileAsync('python3', args, {
      timeout: 120000, // 120 Sekunden Timeout
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr && stderr.trim()) {
      console.debug(`[scan.py stderr]`, stderr.trim());
    }

    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new Error('scan.py gab keine Ausgabe zurück.');
    }

    const parsed = JSON.parse(trimmed) as ScanResult;
    return parsed;
  } catch (err: any) {
    console.error('[scan.py error]', err);
    throw new Error(err?.message || 'Fehler beim Ausführen von scan.py');
  }
}

function parseUserEdited(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
  } catch {
    // ältere Einträge: kommagetrennt
  }
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * Erkennung nach der OCR: Typ, Datum, Betrag, Absender und Titel aus dem OCR-Text vorschlagen.
 * Setzt nur Felder, die NICHT in user_edited stehen, speichert das Ergebnis (inkl. Fundstellen)
 * in documents.extraction und benennt danach das Archiv-PDF passend um.
 * Synchron: zwischen Lesen und Schreiben kann kein Request dazwischenfunken.
 */
export function applyDetection(id: number, layout: string | null): void {
  const db = getDb();
  const doc = db
    .prepare('SELECT ocr_text, title, doc_type, sender, doc_date, user_edited, folder_id, status FROM documents WHERE id = ?')
    .get(id) as
    | {
        ocr_text: string | null;
        title: string | null;
        doc_type: string | null;
        sender: string | null;
        doc_date: string | null;
        user_edited: string | null;
        folder_id: number | null;
        status: string;
      }
    | undefined;
  if (!doc) return;

  if (!doc.ocr_text) {
    db.prepare('UPDATE documents SET extraction = NULL WHERE id = ?').run(id);
    return;
  }

  const det = detectDocument(doc.ocr_text, layout);
  const edited = parseUserEdited(doc.user_edited);

  const updates: Record<string, string | number | null> = {};
  if (!edited.has('doc_type')) updates.doc_type = det.type;
  if (!edited.has('sender') && det.sender) updates.sender = det.sender;
  if (!edited.has('doc_date') && det.date) updates.doc_date = det.date;
  if (!edited.has('amount_cents') && det.amountCents !== null) updates.amount_cents = det.amountCents;
  if (!edited.has('title')) {
    // Titel aus den endgültigen Werten bauen (vom Nutzer gesetzte Typen/Absender zählen mit)
    const title = buildTitle(
      (updates.doc_type as string | undefined) ?? doc.doc_type,
      (updates.sender as string | undefined) ?? doc.sender,
      (updates.doc_date as string | undefined) ?? doc.doc_date
    );
    if (title) updates.title = title;
  }

  // Automatisch ablegen (Einstellung auto_file, Standard AUS): nur bei sicher erkanntem Datum,
  // wenn der Nutzer keinen Ordner gewählt hat und ein passender Jahres-Ordner existiert
  const autoFile = (db.prepare("SELECT value FROM settings WHERE key = 'auto_file'").get() as
    | { value: string }
    | undefined)?.value === 'true';
  if (autoFile && !edited.has('folder_id') && doc.folder_id === null && det.date && det.dateConfidence >= 0.9) {
    const date = (updates.doc_date as string | undefined) ?? doc.doc_date;
    const folderId = date ? suggestFolderIdForDate(date) : null;
    if (folderId !== null) {
      updates.folder_id = folderId;
      updates.status = 'filed';
    }
  }

  const columns = Object.keys(updates);
  const setSql = columns.map((c) => `${c} = ?`).join(', ');
  db.prepare(
    `UPDATE documents SET extraction = ?${setSql ? ', ' + setSql : ''},
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`
  ).run(JSON.stringify(det), ...columns.map((c) => updates[c]), id);

  syncArchivePdf(id);

  console.log(
    `[Erkennung] Dokument ${id}: ${det.type} (${det.typeConfidence}), Datum ${det.date ?? '–'}, ` +
      `Betrag ${det.amountCents ?? '–'}, Absender ${det.sender ?? '–'}`
  );
}

/** Ordner-Vorschlag zum Datum: Steuerjahr-Ordner des Jahres, sonst Jahr-Ordner. */
export function suggestFolderIdForDate(isoDate: string): number | null {
  const year = parseInt(isoDate.slice(0, 4), 10);
  if (isNaN(year)) return null;
  const row = getDb()
    .prepare(
      `SELECT id FROM folders WHERE year = ? AND kind IN ('steuerjahr', 'jahr')
       ORDER BY CASE kind WHEN 'steuerjahr' THEN 0 ELSE 1 END LIMIT 1`
    )
    .get(year) as { id: number } | undefined;
  return row ? row.id : null;
}

function runDetectionSafely(id: number, layout: string | null): void {
  try {
    applyDetection(id, layout);
  } catch (err) {
    console.warn(`[Erkennung] Fehler bei Dokument ${id} (Dokument bleibt ohne Vorschläge):`, err);
  }
}

/**
 * Verarbeitet ein einzelnes Dokument aus der Warteschlange:
 * 1. Konvertierung/EXIF-Korrektur nach work/<id>.jpg
 * 2. Aufbereitung mit scan.py nach work/<id>.png
 * 3. Neues Vorschaubild (webp) erzeugen
 * 4. Speichern von corners, detected, status in der Datenbank
 */
export async function processDocument(id: number): Promise<void> {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;

  if (!doc) {
    console.warn(`[Pipeline] Dokument ${id} existiert nicht in der Datenbank.`);
    return;
  }

  // 1. Status auf 'processing' setzen
  db.prepare(`
    UPDATE documents
    SET status = 'processing',
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = ?
  `).run(id);

  console.log(`[Pipeline] Starte Bildaufbereitung für Dokument ${id} ("${doc.original_name}")...`);

  // 2. Prüfen, ob Original existiert
  const origPath = doc.original_path;
  if (!origPath || !fs.existsSync(origPath)) {
    const errorMsg = `Originaldatei nicht gefunden: ${origPath || 'kein Pfad hinterlegt'}`;
    console.error(`[Pipeline] ${errorMsg}`);
    db.prepare(`
      UPDATE documents
      SET status = 'error',
          detected = NULL,
          error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(errorMsg, id);
    return;
  }

  const ext = path.extname(origPath).toLowerCase();
  const baseTitle = path.parse(doc.original_name || origPath).name;

  try {
    // Sicherstellen, dass Arbeitsverzeichnisse existieren
    if (!fs.existsSync(paths.workDir)) {
      fs.mkdirSync(paths.workDir, { recursive: true });
    }
    if (!fs.existsSync(paths.thumbsDir)) {
      fs.mkdirSync(paths.thumbsDir, { recursive: true });
    }

    const outputPng = path.join(paths.workDir, `${id}.png`);
    const targetThumb = path.join(paths.thumbsDir, `${id}.webp`);

    // ==========================================
    // A) PDF-Eingang (Datei war schon PDF)
    // ==========================================
    if (ext === '.pdf') {
      console.log(`[Pipeline] Dokument ${id} ist ein PDF. Erzeuge Vorschau & starte OCR (--skip-text)...`);

      // 1. Seite 1 des PDFs rendern für Thumbnail und Vorschau-Cache (work/<id>.png)
      try {
        await execFileAsync('gs', [
          '-sDEVICE=png16m',
          '-dFirstPage=1',
          '-dLastPage=1',
          '-r150',
          '-o', outputPng,
          origPath,
        ], { timeout: 30000 });

        if (fs.existsSync(outputPng)) {
          await sharp(outputPng)
            .resize({ width: 400, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(targetThumb);
        }
      } catch (gsErr) {
        console.warn(`[Pipeline] Konnte Seite 1 des PDFs ${id} nicht mit Ghostscript rendern:`, gsErr);
      }

      // 2. OCR-Pipeline aufrufen (--skip-text Modus, ohne scan.py)
      const ocrRes = await runOcrPipeline({
        id,
        inputPath: origPath,
        isPdf: true,
        docDate: doc.doc_date,
        title: doc.title,
        originalName: doc.original_name,
        createdAt: doc.created_at,
        folderId: doc.folder_id,
        currentPdfPath: doc.pdf_path,
      });

      // 3. Datenbank aktualisieren
      db.prepare(`
        UPDATE documents
        SET status = CASE
              WHEN folder_id IS NOT NULL THEN 'filed'
              ELSE 'inbox'
            END,
            thumb_path = CASE
              WHEN ? = 1 THEN ?
              ELSE thumb_path
            END,
            pdf_path = ?,
            ocr_text = ?,
            page_count = ?,
            title = CASE
              WHEN title IS NULL OR TRIM(title) = '' THEN ?
              ELSE title
            END,
            error = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?
      `).run(
        fs.existsSync(targetThumb) ? 1 : 0,
        targetThumb,
        ocrRes.pdfPath,
        ocrRes.ocrText,
        ocrRes.pageCount,
        baseTitle,
        id
      );

      runDetectionSafely(id, null);

      console.log(
        `[Pipeline] PDF-Dokument ${id} erfolgreich verarbeitet (${ocrRes.pageCount} Seite(n), OCR-Text: ${Boolean(
          ocrRes.ocrText
        )}).`
      );
      return;
    }

    // ==========================================
    // B) Bild-Eingang (JPG, PNG, HEIC)
    // ==========================================
    const intermediateJpg = path.join(paths.workDir, `${id}.jpg`);
    const isHeic = ['.heic', '.heif'].includes(ext);

    // 1. Arbeitskopie erzeugen (EXIF-korrigiert oder HEIC-konvertiert)
    if (isHeic) {
      // HEIC/HEIF: vorher mit "heif-convert -q 92 <in> <DATA_DIR/work/<id>.jpg>" umwandeln
      console.log(`[Pipeline] Konvertiere HEIC nach JPEG: ${origPath} -> ${intermediateJpg}`);
      await execFileAsync('heif-convert', ['-q', '92', origPath, intermediateJpg], {
        timeout: 120000,
      });
      // EXIF-Ausrichtung auf das Zwischen-JPEG anwenden
      const tempRotated = path.join(paths.workDir, `${id}_temp.jpg`);
      await sharp(intermediateJpg).rotate().jpeg({ quality: 95 }).toFile(tempRotated);
      fs.renameSync(tempRotated, intermediateJpg);
    } else {
      // JPG/PNG: mit sharp().rotate() eine korrigierte Arbeitskopie nach work/<id>.jpg schreiben
      console.log(`[Pipeline] Erzeuge EXIF-orientiertes Arbeitsbild: ${origPath} -> ${intermediateJpg}`);
      await sharp(origPath).rotate().jpeg({ quality: 95 }).toFile(intermediateJpg);
    }

    // 2. Farbmodus ermitteln: Dokument-Einstellung oder Standard aus settings
    let colorMode = doc.color_mode || 'bw';
    if (!doc.color_mode) {
      const defaultSetting = db
        .prepare("SELECT value FROM settings WHERE key = 'default_color_mode'")
        .get() as { value: string } | undefined;
      if (defaultSetting?.value && ['bw', 'gray', 'color'].includes(defaultSetting.value)) {
        colorMode = defaultSetting.value;
      }
    }

    // 3. scan.py aufrufen (Entzerrung & Aufbereitung nach work/<id>.png)
    console.log(
      `[Pipeline] Starte scan.py für Dokument ${id} (Modus: ${colorMode}, Rotation: ${doc.rotation || 0})...`
    );
    const scanRes = await runScanPy({
      inputPath: intermediateJpg,
      outputPath: outputPng,
      mode: colorMode as 'bw' | 'gray' | 'color',
      corners: doc.corners || null,
      rotation: doc.rotation || 0,
    });

    if (!scanRes.ok) {
      throw new Error(scanRes.error || 'Fehler in scan.py');
    }

    const detected = scanRes.detected ? 1 : 0;
    const cornersJson = scanRes.corners ? JSON.stringify(scanRes.corners) : null;

    // 4. Neues Vorschaubild (webp) aus dem aufbereiteten PNG erzeugen
    await sharp(outputPng)
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(targetThumb);

    // 5. OCR-Pipeline aufrufen (ocrmypdf mit --image-dpi 300)
    const ocrRes = await runOcrPipeline({
      id,
      inputPath: outputPng,
      isPdf: false,
      docDate: doc.doc_date,
      title: doc.title,
      originalName: doc.original_name,
      createdAt: doc.created_at,
      folderId: doc.folder_id,
      currentPdfPath: doc.pdf_path,
    });

    // 6. Datenbank aktualisieren: Ecken, Status, Thumbnail, PDF-Pfad, OCR-Text, Seitenzahl
    db.prepare(`
      UPDATE documents
      SET status = CASE
            WHEN folder_id IS NOT NULL THEN 'filed'
            ELSE 'inbox'
          END,
          corners = COALESCE(?, corners),
          detected = ?,
          color_mode = ?,
          thumb_path = ?,
          pdf_path = ?,
          ocr_text = ?,
          page_count = ?,
          title = CASE
            WHEN title IS NULL OR TRIM(title) = '' THEN ?
            ELSE title
          END,
          error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(
      cornersJson,
      detected,
      colorMode,
      targetThumb,
      ocrRes.pdfPath,
      ocrRes.ocrText,
      ocrRes.pageCount,
      baseTitle,
      id
    );

    runDetectionSafely(id, scanRes.layout ?? null);

    console.log(
      `[Pipeline] Dokument ${id} erfolgreich aufbereitet & durchsuchbares PDF erzeugt (${ocrRes.pageCount} Seite(n), OCR-Text: ${Boolean(
        ocrRes.ocrText
      )}).`
    );
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.error(`[Pipeline] Fehler bei der Aufbereitung von Dokument ${id}:`, errorMsg);
    db.prepare(`
      UPDATE documents
      SET status = 'error',
          detected = NULL,
          error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(errorMsg, id);
  }
}
