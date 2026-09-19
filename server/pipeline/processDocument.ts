import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { getDb, paths } from '../db.js';

const execFileAsync = promisify(execFile);

// Verzeichnis dieser Datei bestimmen (für scan.py)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCAN_PY_PATH = path.resolve(__dirname, 'scan.py');

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
          error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(errorMsg, id);
    return;
  }

  const ext = path.extname(origPath).toLowerCase();
  const baseTitle = path.parse(doc.original_name || origPath).name;

  try {
    // Falls PDF: In diesem Schritt überspringen (wird in Schritt 4 an OCR übergeben)
    if (ext === '.pdf') {
      console.log(`[Pipeline] Dokument ${id} ist ein PDF. Bildaufbereitung wird übersprungen.`);
      db.prepare(`
        UPDATE documents
        SET status = CASE
              WHEN folder_id IS NOT NULL THEN 'filed'
              ELSE 'inbox'
            END,
            title = CASE
              WHEN title IS NULL OR TRIM(title) = '' THEN ?
              ELSE title
            END,
            error = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?
      `).run(baseTitle, id);
      return;
    }

    // Sicherstellen, dass Arbeitsverzeichnisse existieren
    if (!fs.existsSync(paths.workDir)) {
      fs.mkdirSync(paths.workDir, { recursive: true });
    }
    if (!fs.existsSync(paths.thumbsDir)) {
      fs.mkdirSync(paths.thumbsDir, { recursive: true });
    }

    const intermediateJpg = path.join(paths.workDir, `${id}.jpg`);
    const outputPng = path.join(paths.workDir, `${id}.png`);
    const targetThumb = path.join(paths.thumbsDir, `${id}.webp`);

    const isHeic = ['.heic', '.heif'].includes(ext);

    // 3. Arbeitskopie erzeugen (EXIF-korrigiert oder HEIC-konvertiert)
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

    // 4. Farbmodus ermitteln: Dokument-Einstellung oder Standard aus settings
    let colorMode = doc.color_mode || 'bw';
    if (!doc.color_mode) {
      const defaultSetting = db
        .prepare("SELECT value FROM settings WHERE key = 'default_color_mode'")
        .get() as { value: string } | undefined;
      if (defaultSetting?.value && ['bw', 'gray', 'color'].includes(defaultSetting.value)) {
        colorMode = defaultSetting.value;
      }
    }

    // 5. scan.py aufrufen
    console.log(`[Pipeline] Starte scan.py für Dokument ${id} (Modus: ${colorMode}, Rotation: ${doc.rotation || 0})...`);
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

    // 6. Neues Vorschaubild (webp) aus dem aufbereiteten PNG erzeugen
    await sharp(outputPng)
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(targetThumb);

    // 7. Datenbank aktualisieren: Ecken, Status, Thumbnail, ggf. Titel
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
          title = CASE
            WHEN title IS NULL OR TRIM(title) = '' THEN ?
            ELSE title
          END,
          error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(cornersJson, detected, colorMode, targetThumb, baseTitle, id);

    console.log(
      `[Pipeline] Dokument ${id} erfolgreich aufbereitet (detected: ${Boolean(detected)}, layout: ${scanRes.layout}, A4 PNG: ${outputPng}).`
    );
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.error(`[Pipeline] Fehler bei der Aufbereitung von Dokument ${id}:`, errorMsg);
    db.prepare(`
      UPDATE documents
      SET status = 'error',
          error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(errorMsg, id);
  }
}
