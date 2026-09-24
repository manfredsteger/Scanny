import { Router, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
// archiver ab v8: ESM-only, keine aufrufbare Standardausgabe mehr – die Klasse direkt nutzen
import { ZipArchive } from 'archiver';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDb, sanitizeFolderName } from '../db.js';
import { localDateString } from '../pipeline/ocr.js';

export const exportRouter = Router();

export interface ExportDocument {
  id: number;
  doc_date: string | null;
  doc_type: string | null;
  title: string | null;
  sender: string | null;
  amount_cents: number | null;
  page_count: number | null;
  pdf_path: string | null;
  original_name: string | null;
  created_at: string;
}

/** Anzeigenamen der Dokumenttypen – bewusst dieselben wie im Frontend (src/types.ts). */
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  rechnung: 'Rechnung',
  quittung: 'Quittung/Kassenbon',
  kontoauszug: 'Kontoauszug',
  vertrag: 'Vertrag',
  bescheid: 'Bescheid',
  lohnabrechnung: 'Lohnabrechnung',
  spendenquittung: 'Spendenquittung',
  versicherung: 'Versicherung',
  brief: 'Brief',
  sonstiges: 'Sonstiges',
};

export function formatTypeLabel(key: string | null | undefined): string {
  if (!key) return '';
  return DOCUMENT_TYPE_LABELS[key.toLowerCase().trim()] || key;
}

/** "2026-03-14" -> "14.03.2026" (ohne Zeitzonen-Umrechnung). */
export function formatDateDe(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Cent-Betrag im deutschen Zahlenformat: 123456 -> "1.234,56". Ohne Währungszeichen. */
export function formatAmountDe(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped},${rest}`;
}

/** Ein CSV-Feld escapen: Anführungszeichen verdoppeln, bei ; " oder Zeilenumbruch quoten. */
export function csvField(value: string | null | undefined): string {
  const text = (value ?? '').replace(/\r?\n/g, ' ').trim();
  if (text === '') return '';
  if (/[;"]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Baut die CSV-Übersicht: Semikolon-getrennt, UTF-8 mit BOM, deutsches Zahlenformat.
 * Spalten: Datum;Typ;Titel;Absender;Betrag;Seiten;Dateiname
 */
export function buildCsv(docs: ExportDocument[]): string {
  const lines = ['Datum;Typ;Titel;Absender;Betrag;Seiten;Dateiname'];
  for (const doc of docs) {
    lines.push(
      [
        csvField(formatDateDe(doc.doc_date)),
        csvField(formatTypeLabel(doc.doc_type)),
        csvField(doc.title || doc.original_name),
        csvField(doc.sender),
        csvField(formatAmountDe(doc.amount_cents)),
        csvField(String(doc.page_count || 1)),
        csvField(doc.pdf_path ? path.basename(doc.pdf_path) : ''),
      ].join(';')
    );
  }
  const sum = docs.reduce((acc, d) => acc + (d.amount_cents || 0), 0);
  lines.push(['Summe', '', '', '', csvField(formatAmountDe(sum)), '', ''].join(';'));
  // BOM, damit Excel unter Windows und macOS die Umlaute richtig liest
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * Dokumente eines Ordners für den Export auswählen: nur abgelegte, nicht gelöschte Belege,
 * optional auf Zeitraum (Belegdatum) und eine Auswahl von IDs eingegrenzt, sortiert nach Datum.
 * Belege ohne Belegdatum stehen am Ende und fallen nicht durch einen gesetzten Zeitraum.
 */
export function selectExportDocuments(options: {
  folderId: number;
  from?: string | null;
  to?: string | null;
  ids?: number[] | null;
}): ExportDocument[] {
  const conditions = ["d.status = 'filed'", 'd.deleted_at IS NULL', 'd.folder_id = ?'];
  const params: any[] = [options.folderId];

  if (options.from) {
    conditions.push('d.doc_date IS NOT NULL AND d.doc_date >= ?');
    params.push(options.from);
  }
  if (options.to) {
    conditions.push('d.doc_date IS NOT NULL AND d.doc_date <= ?');
    params.push(options.to);
  }
  if (options.ids && options.ids.length > 0) {
    conditions.push(`d.id IN (${options.ids.map(() => '?').join(',')})`);
    params.push(...options.ids);
  }

  return getDb()
    .prepare(
      `SELECT d.id, d.doc_date, d.doc_type, d.title, d.sender, d.amount_cents,
              d.page_count, d.pdf_path, d.original_name, d.created_at
       FROM documents d
       WHERE ${conditions.join(' AND ')}
       ORDER BY CASE WHEN d.doc_date IS NULL THEN 1 ELSE 0 END, d.doc_date ASC, d.id ASC`
    )
    .all(...params) as ExportDocument[];
}

/** Dateiname für den Download: "Scanny <Ordner> <Datum>.<ext>", dateisystemsicher. */
export function exportFileName(folderName: string, ext: string): string {
  const clean = sanitizeFolderName(`Scanny ${folderName} ${localDateString()}`) || 'Scanny Export';
  return `${clean}.${ext}`;
}

/** Content-Disposition mit ASCII-Rückfall und UTF-8-Variante setzen. */
function setDownloadHeaders(res: Response, fileName: string, contentType: string): void {
  const encoded = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
  res.setHeader('Cache-Control', 'no-store');
}

// ---------------------------------------------------------------------------
// Sammel-PDF
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28; // A4 hochkant in Punkt
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

/**
 * Helvetica kann nur WinAnsi. Zeichen außerhalb (z. B. typografische Anführungszeichen,
 * Gedankenstriche, Aufzählungspunkte) würden pdf-lib zum Werfen bringen – hier ersetzen.
 */
export function toWinAnsi(text: string): string {
  return (text || '')
    .replace(/[‘’‚‹›]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\xFF]/g, '');
}

/** Text auf eine Maximalbreite kürzen und mit "…" enden lassen. */
function fitText(text: string, font: any, size: number, maxWidth: number): string {
  const clean = toWinAnsi(text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let cut = clean;
  while (cut.length > 1 && font.widthOfTextAtSize(cut + '...', size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut + '...';
}

/**
 * Erzeugt das Sammel-PDF: vorneweg eine Übersicht mit Tabelle und Summe (bei Bedarf über
 * mehrere Seiten), danach alle Dokument-PDFs nach Datum.
 */
export async function buildCombinedPdf(
  folderName: string,
  docs: ExportDocument[],
  period: { from?: string | null; to?: string | null }
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const contentWidth = PAGE_WIDTH - 2 * MARGIN;
  // Spalten: Datum, Typ, Titel, Betrag
  const cols = [
    { x: MARGIN, width: 62 },
    { x: MARGIN + 68, width: 96 },
    { x: MARGIN + 170, width: contentWidth - 170 - 80 },
    { x: PAGE_WIDTH - MARGIN, width: 80 },
  ];

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const drawHeader = (first: boolean) => {
    if (first) {
      page.drawText(toWinAnsi(folderName), { x: MARGIN, y: y - 18, size: 18, font: bold, color: rgb(0.1, 0.1, 0.12) });
      y -= 30;
      const periodText =
        period.from || period.to
          ? `Zeitraum ${formatDateDe(period.from) || 'Anfang'} bis ${formatDateDe(period.to) || 'heute'}`
          : 'Gesamter Ordner';
      page.drawText(toWinAnsi(`${periodText} · ${docs.length} ${docs.length === 1 ? 'Beleg' : 'Belege'}`), {
        x: MARGIN, y: y - 12, size: 10, font: regular, color: rgb(0.42, 0.45, 0.5),
      });
      y -= 20;
      page.drawText(toWinAnsi(`Erstellt am ${formatDateDe(localDateString())} mit Scanny`), {
        x: MARGIN, y: y - 12, size: 9, font: regular, color: rgb(0.55, 0.58, 0.62),
      });
      y -= 30;
    }
    // Tabellenkopf
    page.drawText('Datum', { x: cols[0].x, y: y - 10, size: 9, font: bold, color: rgb(0.3, 0.33, 0.38) });
    page.drawText('Typ', { x: cols[1].x, y: y - 10, size: 9, font: bold, color: rgb(0.3, 0.33, 0.38) });
    page.drawText('Titel', { x: cols[2].x, y: y - 10, size: 9, font: bold, color: rgb(0.3, 0.33, 0.38) });
    const betragLabel = 'Betrag';
    page.drawText(betragLabel, {
      x: cols[3].x - bold.widthOfTextAtSize(betragLabel, 9), y: y - 10, size: 9, font: bold, color: rgb(0.3, 0.33, 0.38),
    });
    y -= 16;
    page.drawLine({
      start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.8, color: rgb(0.82, 0.84, 0.87),
    });
    y -= 12;
  };

  drawHeader(true);

  for (const doc of docs) {
    if (y < MARGIN + 60) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawHeader(false);
    }
    const grey = rgb(0.25, 0.27, 0.31);
    page.drawText(formatDateDe(doc.doc_date) || '-', { x: cols[0].x, y, size: 9, font: regular, color: grey });
    page.drawText(fitText(formatTypeLabel(doc.doc_type) || '-', regular, 9, cols[1].width), {
      x: cols[1].x, y, size: 9, font: regular, color: grey,
    });
    page.drawText(fitText(doc.title || doc.original_name || 'Beleg', regular, 9, cols[2].width), {
      x: cols[2].x, y, size: 9, font: regular, color: grey,
    });
    const amount = formatAmountDe(doc.amount_cents);
    if (amount) {
      page.drawText(amount, {
        x: cols[3].x - regular.widthOfTextAtSize(amount, 9), y, size: 9, font: regular, color: grey,
      });
    }
    y -= 15;
  }

  // Summenzeile
  if (y < MARGIN + 40) {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }
  y -= 4;
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.8, color: rgb(0.82, 0.84, 0.87),
  });
  y -= 15;
  const sum = docs.reduce((acc, d) => acc + (d.amount_cents || 0), 0);
  const sumText = formatAmountDe(sum) + ' EUR';
  page.drawText('Summe', { x: cols[0].x, y, size: 10, font: bold, color: rgb(0.1, 0.1, 0.12) });
  page.drawText(sumText, {
    x: cols[3].x - bold.widthOfTextAtSize(sumText, 10), y, size: 10, font: bold, color: rgb(0.1, 0.1, 0.12),
  });

  // Danach alle Dokument-PDFs in derselben Reihenfolge anhängen
  for (const doc of docs) {
    if (!doc.pdf_path || !fs.existsSync(doc.pdf_path)) {
      console.warn(`[Export] PDF von Dokument ${doc.id} fehlt und wird übersprungen: ${doc.pdf_path}`);
      continue;
    }
    try {
      const src = await PDFDocument.load(fs.readFileSync(doc.pdf_path), { ignoreEncryption: true });
      const pages = await pdf.copyPages(src, src.getPageIndices());
      for (const p of pages) pdf.addPage(p);
    } catch (err) {
      console.warn(`[Export] PDF von Dokument ${doc.id} konnte nicht angehängt werden:`, err);
    }
  }

  pdf.setTitle(toWinAnsi(`Scanny – ${folderName}`));
  pdf.setCreator('Scanny');
  return pdf.save();
}

// ---------------------------------------------------------------------------
// GET /api/folders/:id/export?format=zip|csv|pdf&from=&to=&ids=
// ---------------------------------------------------------------------------

exportRouter.get('/folders/:id/export', async (req: Request, res: Response) => {
  try {
    const folderId = parseInt(req.params.id, 10);
    if (isNaN(folderId)) return res.status(400).json({ error: 'Ungültige Ordner-ID.' });

    const folder = getDb().prepare('SELECT id, name FROM folders WHERE id = ?').get(folderId) as
      | { id: number; name: string }
      | undefined;
    if (!folder) return res.status(404).json({ error: 'Ordner nicht gefunden.' });

    const format = String(req.query.format || 'zip').toLowerCase();
    if (!['zip', 'csv', 'pdf'].includes(format)) {
      return res.status(400).json({ error: 'Format muss zip, csv oder pdf sein.' });
    }

    const isoDate = (raw: unknown): string | null => {
      const value = typeof raw === 'string' ? raw.trim() : '';
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    };
    const from = isoDate(req.query.from);
    const to = isoDate(req.query.to);
    if (from && to && from > to) {
      return res.status(400).json({ error: 'Das Startdatum liegt nach dem Enddatum.' });
    }

    const ids =
      typeof req.query.ids === 'string' && req.query.ids.trim()
        ? req.query.ids.split(',').map((v) => parseInt(v, 10)).filter((v) => !isNaN(v))
        : null;

    const docs = selectExportDocuments({ folderId, from, to, ids });
    if (docs.length === 0) {
      return res.status(404).json({ error: 'Für diese Auswahl gibt es keine Belege zum Exportieren.' });
    }

    // --- CSV ---------------------------------------------------------------
    if (format === 'csv') {
      setDownloadHeaders(res, exportFileName(folder.name, 'csv'), 'text/csv; charset=utf-8');
      return res.send(buildCsv(docs));
    }

    // --- Sammel-PDF --------------------------------------------------------
    if (format === 'pdf') {
      const bytes = await buildCombinedPdf(folder.name, docs, { from, to });
      setDownloadHeaders(res, exportFileName(folder.name, 'pdf'), 'application/pdf');
      return res.send(Buffer.from(bytes));
    }

    // --- ZIP (gestreamt, nicht im Speicher gebaut) -------------------------
    setDownloadHeaders(res, exportFileName(folder.name, 'zip'), 'application/zip');

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('warning', (err: any) => {
      if (err?.code === 'ENOENT') console.warn('[Export] ZIP-Warnung:', err);
      else throw err;
    });
    archive.on('error', (err: any) => {
      console.error('[Export] ZIP-Fehler:', err);
      // Header sind schon raus – Verbindung abbrechen, damit der Browser den Teil-Download verwirft
      res.destroy(err);
    });

    archive.pipe(res);
    // Bricht der Download ab, den Archivierer nicht weiterlaufen lassen
    res.on('close', () => {
      if (!res.writableFinished) archive.abort();
    });

    const usedNames = new Set<string>();
    for (const doc of docs) {
      if (!doc.pdf_path || !fs.existsSync(doc.pdf_path)) {
        console.warn(`[Export] PDF von Dokument ${doc.id} fehlt und wird übersprungen: ${doc.pdf_path}`);
        continue;
      }
      // Dateinamen wie im Archiv; bei Namensgleichheit im ZIP durchnummerieren
      let name = path.basename(doc.pdf_path);
      if (usedNames.has(name)) {
        const base = name.replace(/\.pdf$/i, '');
        let counter = 2;
        while (usedNames.has(`${base} (${counter}).pdf`)) counter++;
        name = `${base} (${counter}).pdf`;
      }
      usedNames.add(name);
      archive.file(doc.pdf_path, { name });
    }

    // Übersicht liegt dem ZIP immer bei – ohne sie ist ein Steuerordner nur ein Haufen PDFs
    archive.append(Buffer.from(buildCsv(docs), 'utf8'), { name: 'Uebersicht.csv' });

    await archive.finalize();
  } catch (error: any) {
    console.error('Fehler beim Export:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error?.message || 'Export fehlgeschlagen.' });
    } else {
      res.destroy(error);
    }
  }
});
