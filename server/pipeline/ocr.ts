import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import { getDb, paths } from '../db.js';

const execFileAsync = promisify(execFile);

/**
 * Verschiebt eine Datei atomar; fällt bei EXDEV (unterschiedliche Mountpoints) auf Copy + Unlink zurück.
 */
export function moveOrCopySync(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (err: any) {
    if (err && (err.code === 'EXDEV' || err.code === 'EPERM')) {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

/**
 * Liefert YYYY-MM-DD in lokaler Zeit (TZ des Containers), nicht UTC.
 */
export function localDateString(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const valid = isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(valid.getDate())}`;
}

/**
 * Bereinigt einen Titel für das Dateisystem (keine ungültigen Zeichen, max. 120 Zeichen gesamt).
 */
export function sanitizeFilenameTitle(rawTitle: string): string {
  return (
    rawTitle
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'Beleg'
  );
}

/**
 * Ermittelt den kollisionsfreien Zieldateipfad im Archiv:
 * Format: "<YYYY-MM-DD> <Titel>.pdf", max. 120 Zeichen, bei Kollision " (2)", " (3)" etc.
 */
export function determineArchivePdfPath(
  targetDir: string,
  dateStr: string,
  rawTitle: string,
  currentPdfPath: string | null = null
): string {
  const cleanTitle = sanitizeFilenameTitle(rawTitle);
  let base = `${dateStr} ${cleanTitle}`;
  // Maximale Basislänge: 120 minus 4 Zeichen für ".pdf" = 116
  if (base.length > 116) {
    base = base.slice(0, 116).trim();
  }

  let finalName = `${base}.pdf`;
  let counter = 2;

  while (
    fs.existsSync(path.join(targetDir, finalName)) &&
    path.join(targetDir, finalName) !== currentPdfPath
  ) {
    const suffix = ` (${counter})`;
    const maxBase = 116 - suffix.length;
    finalName = `${base.slice(0, maxBase).trim()}${suffix}.pdf`;
    counter++;
  }

  return path.join(targetDir, finalName);
}

/**
 * Löscht temporäre Arbeitsdateien für ein Dokument in DATA_DIR/work,
 * AUSSER dem PNG (bleibt als Cache für die Anzeige).
 */
export function cleanupWorkFiles(id: number): void {
  try {
    if (!fs.existsSync(paths.workDir)) return;
    const entries = fs.readdirSync(paths.workDir);
    for (const entry of entries) {
      if (entry === `${id}.png`) {
        // PNG bleibt als Cache für die Anzeige!
        continue;
      }
      if (entry.startsWith(`${id}.`) || entry.startsWith(`${id}_`)) {
        try {
          fs.unlinkSync(path.join(paths.workDir, entry));
        } catch (err) {
          console.warn(`[Pipeline] Konnte Arbeitsdatei ${entry} nicht löschen:`, err);
        }
      }
    }
  } catch (err) {
    console.warn(`[Pipeline] Fehler beim Bereinigen von workDir für Dokument ${id}:`, err);
  }
}

export interface OcrPipelineOptions {
  id: number;
  inputPath: string;
  isPdf: boolean;
  docDate?: string | null;
  title?: string | null;
  originalName?: string;
  createdAt?: string;
  folderId?: number | null;
  currentPdfPath?: string | null;
}

export interface OcrPipelineResult {
  pdfPath: string;
  ocrText: string | null;
  pageCount: number;
}

/**
 * Führt die OCR-Pipeline mit ocrmypdf aus:
 * - Bei Bildern: --image-dpi 300 -l deu+eng --rotate-pages --deskew --output-type pdfa --optimize 1 --jobs 2
 * - Bei PDFs: --skip-text statt --image-dpi
 * - Exit-Code 6 (bereits Text vorhanden) wird abgefangen und ist KEIN Fehler.
 * - Sidecar-Text wird ausgelesen.
 * - page_count wird über pdf-lib ermittelt.
 * - PDF wird in ARCHIVE_DIR abgelegt (<YYYY-MM-DD> <Titel>.pdf, max 120 Zeichen).
 * - Arbeitsdateien in work/ werden bis auf <id>.png bereinigt.
 */
export async function runOcrPipeline(options: OcrPipelineOptions): Promise<OcrPipelineResult> {
  const { id, inputPath, isPdf } = options;

  if (!fs.existsSync(paths.workDir)) {
    fs.mkdirSync(paths.workDir, { recursive: true });
  }

  const workPdfPath = path.join(paths.workDir, `${id}.pdf`);
  const workSidecarPath = path.join(paths.workDir, `${id}.txt`);

  // Falls vorherige work-Dateien noch daliegen, vorab säubern
  if (fs.existsSync(workSidecarPath)) {
    try {
      fs.unlinkSync(workSidecarPath);
    } catch {}
  }

  // ocrmypdf Argumente vorbereiten
  const args: string[] = [];
  if (isPdf) {
    args.push(
      '--skip-text',
      '-l', 'deu+eng',
      '--rotate-pages',
      '--deskew',
      '--output-type', 'pdfa',
      '--optimize', '1',
      '--jobs', '2',
      '--sidecar', workSidecarPath,
      inputPath,
      workPdfPath
    );
  } else {
    args.push(
      '--image-dpi', '300',
      '-l', 'deu+eng',
      '--rotate-pages',
      '--deskew',
      '--output-type', 'pdfa',
      '--optimize', '1',
      '--jobs', '2',
      '--sidecar', workSidecarPath,
      inputPath,
      workPdfPath
    );
  }

  console.log(
    `[OCR] Starte ocrmypdf für Dokument ${id} (${isPdf ? 'PDF-Modus: --skip-text' : 'Bild-Modus: --image-dpi 300'})...`
  );

  try {
    await execFileAsync('ocrmypdf', args, {
      timeout: 300000, // 300 s Timeout
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err: any) {
    // Exit-Code 6: Bereits Text vorhanden -> KEIN Fehler
    if (err?.code === 6 || err?.exitCode === 6 || err?.status === 6) {
      console.log(
        `[OCR] ocrmypdf Exit-Code 6 (bereits Text vorhanden) bei Dokument ${id} – wird nicht als Fehler gewertet.`
      );
      if (!fs.existsSync(workPdfPath) && isPdf && fs.existsSync(inputPath)) {
        fs.copyFileSync(inputPath, workPdfPath);
      }
    } else {
      console.error(`[OCR] Fehler bei ocrmypdf für Dokument ${id}:`, err);
      throw err;
    }
  }

  // Sicherstellen, dass workPdfPath existiert (z. B. falls Code 6 aufgetreten ist)
  if (!fs.existsSync(workPdfPath)) {
    if (isPdf && fs.existsSync(inputPath)) {
      fs.copyFileSync(inputPath, workPdfPath);
    } else {
      throw new Error(`ocrmypdf hat keine Ausgabedatei unter ${workPdfPath} erzeugt.`);
    }
  }

  // 1. Sidecar-Text auslesen
  let ocrText: string | null = null;
  if (fs.existsSync(workSidecarPath)) {
    try {
      const rawText = fs.readFileSync(workSidecarPath, 'utf8').trim();
      ocrText = rawText.length > 0 ? rawText : null;
    } catch (readErr) {
      console.warn(`[OCR] Konnte Sidecar-Datei ${workSidecarPath} nicht lesen:`, readErr);
    }
  }

  // Bei PDF-Eingängen steht im Sidecar für Seiten mit vorhandenem Text nur "[OCR skipped on page(s) 1-2]".
  // Diese Platzhalter durch den vorhandenen Text der Originalseiten ersetzen (Ghostscript txtwrite).
  if (isPdf && ocrText && ocrText.includes('[OCR skipped on page')) {
    const markerRe = /\[OCR skipped on page\(s\) (\d+)(?:-(\d+))?\]/g;
    const parts: string[] = [];
    let lastIndex = 0;
    for (const m of ocrText.matchAll(markerRe)) {
      parts.push(ocrText.slice(lastIndex, m.index));
      const first = m[1];
      const last = m[2] || m[1];
      try {
        const { stdout } = await execFileAsync(
          'gs',
          ['-q', '-sDEVICE=txtwrite', `-dFirstPage=${first}`, `-dLastPage=${last}`, '-o', '-', inputPath],
          { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }
        );
        parts.push(
          stdout
            .split('\n')
            .map((line) => line.trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
        );
      } catch (gsErr) {
        console.warn(`[OCR] Konnte vorhandenen Text (Seiten ${first}-${last}) aus PDF ${id} nicht lesen:`, gsErr);
      }
      lastIndex = (m.index ?? 0) + m[0].length;
    }
    parts.push(ocrText.slice(lastIndex));
    const merged = parts.join('').trim();
    ocrText = merged.length > 0 ? merged : null;
  }

  // Seitenumbrüche (Form Feed) im Sidecar als Leerzeile darstellen
  if (ocrText) {
    ocrText = ocrText.replace(/\s*\f\s*/g, '\n\n').trim() || null;
  }

  // 2. Seitenzahl mit pdf-lib auslesen
  let pageCount = 1;
  try {
    const pdfBytes = fs.readFileSync(workPdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    pageCount = pdfDoc.getPageCount();
  } catch (pdfErr) {
    console.warn(`[OCR] Konnte Seitenzahl für Dokument ${id} nicht auslesen:`, pdfErr);
  }

  // 3. Zielverzeichnis im Archiv bestimmen
  const db = getDb();
  // Titel/Datum/Ordner frisch aus der DB lesen: sie können während der OCR geändert worden sein
  const fresh = db
    .prepare('SELECT title, doc_date, folder_id, pdf_path FROM documents WHERE id = ?')
    .get(id) as { title: string | null; doc_date: string | null; folder_id: number | null; pdf_path: string | null } | undefined;
  if (fresh) {
    options.title = fresh.title;
    options.docDate = fresh.doc_date;
    options.folderId = fresh.folder_id;
    options.currentPdfPath = fresh.pdf_path;
  }
  let targetDir: string;
  if (options.folderId) {
    const folder = db
      .prepare('SELECT name FROM folders WHERE id = ?')
      .get(options.folderId) as { name: string } | undefined;
    if (folder && folder.name) {
      targetDir = path.join(paths.archiveDir, folder.name);
    } else {
      targetDir = path.join(paths.archiveDir, '_Eingang');
    }
  } else {
    targetDir = path.join(paths.archiveDir, '_Eingang');
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 4. Dateiname generieren (<YYYY-MM-DD> <Titel>.pdf, max. 120 Zeichen)
  const dateStr =
    options.docDate && /^\d{4}-\d{2}-\d{2}$/.test(options.docDate.trim())
      ? options.docDate.trim()
      : localDateString(options.createdAt);

  const titleToUse =
    (options.title && options.title.trim()) ||
    (options.originalName ? path.parse(options.originalName).name : 'Beleg');

  const finalPdfPath = determineArchivePdfPath(
    targetDir,
    dateStr,
    titleToUse,
    options.currentPdfPath
  );

  // Altes Archiv-PDF löschen, falls es sich geändert hat und noch existiert
  if (
    options.currentPdfPath &&
    options.currentPdfPath !== finalPdfPath &&
    fs.existsSync(options.currentPdfPath)
  ) {
    try {
      fs.unlinkSync(options.currentPdfPath);
    } catch (unlinkErr) {
      console.warn(`[OCR] Konnte altes PDF ${options.currentPdfPath} nicht löschen:`, unlinkErr);
    }
  }

  // PDF ins Archiv verschieben/kopieren
  moveOrCopySync(workPdfPath, finalPdfPath);

  // 5. Arbeitsdateien in DATA_DIR/work nach Erfolg löschen, AUSSER dem PNG
  cleanupWorkFiles(id);

  console.log(
    `[OCR] Dokument ${id} erfolgreich verarbeitet: PDF unter "${finalPdfPath}" (${pageCount} Seite(n), ${
      ocrText ? ocrText.length + ' Zeichen' : 'kein Text'
    })`
  );

  return {
    pdfPath: finalPdfPath,
    ocrText,
    pageCount,
  };
}
