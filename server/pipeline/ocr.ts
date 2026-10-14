import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import { paths } from '../db.js';
import { placeNewPdf } from './files.js';

const execFileAsync = promisify(execFile);

// Gemeinsame Datei-Helfer liegen jetzt in files.ts (Dateigruppen); hier für bestehende Importe weitergereicht
export { moveOrCopySync, localDateString, sanitizeFilenameTitle, archiveDirForFolder } from './files.js';

/**
 * Löscht temporäre Arbeitsdateien für ein Dokument in DATA_DIR/work,
 * AUSSER dem PNG (bleibt als Cache für die Anzeige).
 */
export function cleanupWorkFiles(id: number): void {
  try {
    if (!fs.existsSync(paths.workDir)) return;
    const entries = fs.readdirSync(paths.workDir);
    for (const entry of entries) {
      if (entry === `${id}.png` || entry === `${id}.jpg`) {
        // PNG (aufbereitet) und JPG (EXIF-korrigiertes Arbeitsbild) bleiben als Cache für
        // Anzeige und Ecken-Editor – beide sind jederzeit neu erzeugbar.
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

// pdfminer liest eingebettete TrueType-Schriften ohne ToUnicode-Tabelle korrekt (z. B. PDFs aus
// Browsern/Designtools); Ghostscript txtwrite liefert dort für ä/ö/ü/ß nur Steuerzeichen \x01, \x02 …
const PDFMINER_SCRIPT = `
import sys
from pdfminer.high_level import extract_text
first, last = int(sys.argv[2]), int(sys.argv[3])
sys.stdout.write(extract_text(sys.argv[1], page_numbers=range(first - 1, last)))
`;

/**
 * Vorhandenen Text der PDF-Seiten first..last (1-basiert) auslesen.
 * Bevorzugt pdfminer, fällt auf Ghostscript zurück. Steuerzeichen werden entfernt.
 */
export async function extractPdfText(pdfPath: string, first: number, last: number): Promise<string> {
  const opts = { timeout: 60000, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' as const };
  let text: string;
  try {
    ({ stdout: text } = await execFileAsync(
      'python3',
      ['-c', PDFMINER_SCRIPT, pdfPath, String(first), String(last)],
      { ...opts, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
    ));
  } catch (err) {
    console.warn(`[OCR] pdfminer fehlgeschlagen (${pdfPath}), nutze Ghostscript:`, err);
    ({ stdout: text } = await execFileAsync(
      'gs',
      ['-q', '-sDEVICE=txtwrite', `-dFirstPage=${first}`, `-dLastPage=${last}`, '-o', '-', pdfPath],
      opts
    ));
  }
  return text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0B\x0E-\x1F\x7F]/g, '');
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
  /** Original nach dem Ablegen (gleicher Grundname wie das PDF) */
  originalPath: string | null;
  ocrText: string | null;
  pageCount: number;
}

/**
 * Führt die OCR-Pipeline mit ocrmypdf aus:
 * - Bei Bildern: --image-dpi 300 -l deu --rotate-pages --deskew --output-type pdfa --optimize 1 --jobs 2
 * - Bei PDFs: --skip-text statt --image-dpi
 * - Exit-Code 6 (bereits Text vorhanden) wird abgefangen und ist KEIN Fehler.
 * - Sidecar-Text wird ausgelesen.
 * - page_count wird über pdf-lib ermittelt.
 * - PDF wird mit dem Original als Dateigruppe im Archiv abgelegt (files.ts, placeNewPdf).
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
  // Nur "deu": Mit "deu+eng" nimmt Tesseract für einzelne Wörter das englische Modell, das keine
  // Umlaute kennt ("Backerei", "Munchen", "Aschach"). Englischer Text wird mit "deu" trotzdem gelesen.
  const args: string[] = [];
  if (isPdf) {
    args.push(
      '--skip-text',
      '-l', 'deu',
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
      '-l', 'deu',
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
  // Diese Platzhalter durch den vorhandenen Text der Originalseiten ersetzen (pdfminer, Fallback Ghostscript).
  if (isPdf && ocrText && ocrText.includes('[OCR skipped on page')) {
    const markerRe = /\[OCR skipped on page\(s\) (\d+)(?:-(\d+))?\]/g;
    const parts: string[] = [];
    let lastIndex = 0;
    for (const m of ocrText.matchAll(markerRe)) {
      parts.push(ocrText.slice(lastIndex, m.index));
      const first = m[1];
      const last = m[2] || m[1];
      try {
        const stdout = await extractPdfText(inputPath, Number(first), Number(last));
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

  // 3. PDF zusammen mit dem Original als Dateigruppe ablegen (Name nach frischen DB-Werten)
  const placed = placeNewPdf(id, workPdfPath);
  const finalPdfPath = placed.pdfPath;

  // 5. Arbeitsdateien in DATA_DIR/work nach Erfolg löschen, AUSSER dem PNG
  cleanupWorkFiles(id);

  console.log(
    `[OCR] Dokument ${id} erfolgreich verarbeitet: PDF unter "${finalPdfPath}" (${pageCount} Seite(n), ${
      ocrText ? ocrText.length + ' Zeichen' : 'kein Text'
    })`
  );

  return {
    pdfPath: finalPdfPath,
    originalPath: placed.originalPath,
    ocrText,
    pageCount,
  };
}
