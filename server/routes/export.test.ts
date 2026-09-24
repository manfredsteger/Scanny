import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scanny-export-'));
process.env.DATA_DIR = path.join(tmpRoot, 'data');
process.env.SCANNY_DIR = path.join(tmpRoot, 'scanny');
process.env.WATCH_DIR = path.join(tmpRoot, 'scanny', 'Upload');
process.env.ARCHIVE_DIR = path.join(tmpRoot, 'scanny', 'Archiv');

const { getDb, paths } = await import('../db.js');
const {
  buildCsv,
  csvField,
  formatAmountDe,
  formatDateDe,
  formatTypeLabel,
  toWinAnsi,
  exportFileName,
  selectExportDocuments,
  buildCombinedPdf,
} = await import('./export.js');

async function writePdf(target: string, pageCount: number): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) pdf.addPage([595, 842]);
  fs.writeFileSync(target, await pdf.save());
}

interface DocOptions {
  title: string;
  docDate: string | null;
  amountCents?: number | null;
  type?: string;
  sender?: string | null;
  pages?: number;
  folderId?: number | null;
  status?: string;
}

async function createFiledDocument(o: DocOptions): Promise<number> {
  const db = getDb();
  const info = db
    .prepare(`
      INSERT INTO documents (status, source, original_name, title, doc_date, doc_type, sender,
                             amount_cents, page_count, color_mode)
      VALUES (?, 'upload', ?, ?, ?, ?, ?, ?, ?, 'bw')
    `)
    .run(
      o.status ?? 'filed', `${o.title}.jpg`, o.title, o.docDate, o.type ?? 'rechnung',
      o.sender ?? 'Testabsender', o.amountCents ?? null, o.pages ?? 1
    );
  const id = Number(info.lastInsertRowid);
  const pdfPath = path.join(paths.archiveDir, 'Steuer 2026', `${o.docDate ?? '2026-01-01'} ${o.title}.pdf`);
  await writePdf(pdfPath, o.pages ?? 1);
  db.prepare('UPDATE documents SET pdf_path = ?, folder_id = ? WHERE id = ?').run(
    pdfPath, o.folderId === undefined ? 1 : o.folderId, id
  );
  return id;
}

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM document_pages').run();
  db.prepare('DELETE FROM documents').run();
  db.prepare('DELETE FROM folders').run();
  db.prepare("INSERT INTO folders (id, name, kind, year) VALUES (1, 'Steuer 2026', 'steuerjahr', 2026)").run();
  const dir = path.join(paths.archiveDir, 'Steuer 2026');
  if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, e));
});

describe('Export-Formatierung', () => {
  it('formatiert Beträge im deutschen Zahlenformat', () => {
    expect(formatAmountDe(49050)).toBe('490,50');
    expect(formatAmountDe(123456789)).toBe('1.234.567,89');
    expect(formatAmountDe(5)).toBe('0,05');
    expect(formatAmountDe(-1999)).toBe('-19,99');
    expect(formatAmountDe(null)).toBe('');
  });

  it('formatiert Datumsangaben ohne Zeitzonen-Umrechnung', () => {
    expect(formatDateDe('2026-03-14')).toBe('14.03.2026');
    expect(formatDateDe(null)).toBe('');
  });

  it('übersetzt Dokumenttypen in Anzeigenamen', () => {
    expect(formatTypeLabel('quittung')).toBe('Quittung/Kassenbon');
    expect(formatTypeLabel(null)).toBe('');
  });

  it('escapet CSV-Felder mit Semikolon und Anführungszeichen', () => {
    expect(csvField('Stadtwerke GmbH')).toBe('Stadtwerke GmbH');
    expect(csvField('Müller; Söhne')).toBe('"Müller; Söhne"');
    expect(csvField('Er sagte "hallo"')).toBe('"Er sagte ""hallo"""');
    expect(csvField('Zeile1\nZeile2')).toBe('Zeile1 Zeile2');
    expect(csvField(null)).toBe('');
  });

  it('ersetzt Zeichen, die Helvetica nicht kann', () => {
    expect(toWinAnsi('»Rechnung« – Teil 1 … 2')).toBe('"Rechnung" - Teil 1 ... 2');
    // Umlaute müssen erhalten bleiben, sie liegen in WinAnsi
    expect(toWinAnsi('Grüße für Müller')).toBe('Grüße für Müller');
  });

  it('baut einen dateisystemsicheren Downloadnamen', () => {
    expect(exportFileName('Steuer 2026', 'zip')).toMatch(/^Scanny Steuer 2026 \d{4}-\d{2}-\d{2}\.zip$/);
    expect(exportFileName('A/B:C', 'csv')).not.toMatch(/[/:]/);
  });
});

describe('CSV-Übersicht', () => {
  it('schreibt Kopfzeile, Belege und Summe mit BOM', async () => {
    const docs = selectExportDocuments({ folderId: 1 });
    expect(docs).toEqual([]);

    await createFiledDocument({ title: 'Stromrechnung', docDate: '2026-03-14', amountCents: 49050 });
    await createFiledDocument({ title: 'Bon; mit Semikolon', docDate: '2026-02-07', amountCents: 10235, type: 'quittung' });

    const csv = buildCsv(selectExportDocuments({ folderId: 1 }));
    const zeilen = csv.split('\r\n');

    expect(csv.startsWith('﻿')).toBe(true);
    expect(zeilen[0]).toBe('﻿Datum;Typ;Titel;Absender;Betrag;Seiten;Dateiname');
    // nach Datum sortiert: Februar vor März
    expect(zeilen[1]).toContain('07.02.2026;Quittung/Kassenbon;"Bon; mit Semikolon"');
    expect(zeilen[1]).toContain('102,35');
    expect(zeilen[2]).toContain('14.03.2026;Rechnung;Stromrechnung');
    expect(zeilen[3]).toBe('Summe;;;;592,85;;');
  });
});

describe('Auswahl der Export-Belege', () => {
  it('nimmt nur abgelegte, nicht gelöschte Belege des Ordners', async () => {
    const abgelegt = await createFiledDocument({ title: 'Abgelegt', docDate: '2026-03-01' });
    await createFiledDocument({ title: 'Im Eingang', docDate: '2026-03-02', status: 'inbox', folderId: null });
    const geloescht = await createFiledDocument({ title: 'Geloescht', docDate: '2026-03-03' });
    getDb().prepare("UPDATE documents SET deleted_at = '2026-03-04T10:00:00Z' WHERE id = ?").run(geloescht);

    const ids = selectExportDocuments({ folderId: 1 }).map((d) => d.id);
    expect(ids).toEqual([abgelegt]);
  });

  it('grenzt auf einen Zeitraum ein und sortiert nach Datum', async () => {
    await createFiledDocument({ title: 'Januar', docDate: '2026-01-15' });
    const feb = await createFiledDocument({ title: 'Februar', docDate: '2026-02-15' });
    const maerz = await createFiledDocument({ title: 'Maerz', docDate: '2026-03-15' });

    const ids = selectExportDocuments({ folderId: 1, from: '2026-02-01', to: '2026-03-31' }).map((d) => d.id);
    expect(ids).toEqual([feb, maerz]);
  });

  it('stellt Belege ohne Datum ans Ende und lässt sie bei gesetztem Zeitraum weg', async () => {
    const ohne = await createFiledDocument({ title: 'Ohne Datum', docDate: null });
    const mit = await createFiledDocument({ title: 'Mit Datum', docDate: '2026-05-05' });

    expect(selectExportDocuments({ folderId: 1 }).map((d) => d.id)).toEqual([mit, ohne]);
    expect(selectExportDocuments({ folderId: 1, from: '2026-01-01' }).map((d) => d.id)).toEqual([mit]);
  });

  it('berücksichtigt eine Auswahl einzelner Belege', async () => {
    const a = await createFiledDocument({ title: 'A', docDate: '2026-01-01' });
    await createFiledDocument({ title: 'B', docDate: '2026-01-02' });
    const c = await createFiledDocument({ title: 'C', docDate: '2026-01-03' });

    expect(selectExportDocuments({ folderId: 1, ids: [a, c] }).map((d) => d.id)).toEqual([a, c]);
  });
});

describe('Sammel-PDF', () => {
  it('stellt eine Übersicht voran und hängt alle Belege an', async () => {
    await createFiledDocument({ title: 'Erster Beleg', docDate: '2026-01-10', amountCents: 1000, pages: 2 });
    await createFiledDocument({ title: 'Zweiter Beleg', docDate: '2026-02-10', amountCents: 2500, pages: 1 });

    const docs = selectExportDocuments({ folderId: 1 });
    const bytes = await buildCombinedPdf('Steuer 2026', docs, {});
    const pdf = await PDFDocument.load(bytes);

    // 1 Übersichtsseite + 2 + 1 Belegseiten
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.getTitle()).toContain('Steuer 2026');
  });

  it('verteilt lange Übersichten auf mehrere Seiten', async () => {
    for (let i = 1; i <= 60; i++) {
      await createFiledDocument({
        title: `Beleg ${String(i).padStart(2, '0')}`,
        docDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
        amountCents: i * 100,
      });
    }
    const docs = selectExportDocuments({ folderId: 1 });
    const pdf = await PDFDocument.load(await buildCombinedPdf('Steuer 2026', docs, {}));

    // 60 Belegseiten + mehr als eine Übersichtsseite
    expect(pdf.getPageCount()).toBeGreaterThan(61);
  });

  it('bricht nicht an Zeichen, die Helvetica nicht kennt', async () => {
    await createFiledDocument({ title: '»Süße Grüße« – Teil 1 … 2', docDate: '2026-04-01', amountCents: 100 });
    const docs = selectExportDocuments({ folderId: 1 });
    await expect(buildCombinedPdf('Ordner »Test« – 2026', docs, {})).resolves.toBeInstanceOf(Uint8Array);
  });

  it('überspringt Belege, deren PDF fehlt, statt abzubrechen', async () => {
    const a = await createFiledDocument({ title: 'Vorhanden', docDate: '2026-01-01', pages: 1 });
    const b = await createFiledDocument({ title: 'Verschwunden', docDate: '2026-01-02', pages: 1 });
    const weg = getDb().prepare('SELECT pdf_path FROM documents WHERE id = ?').get(b) as { pdf_path: string };
    fs.unlinkSync(weg.pdf_path);

    const docs = selectExportDocuments({ folderId: 1 });
    const pdf = await PDFDocument.load(await buildCombinedPdf('Steuer 2026', docs, {}));
    // Übersicht + nur die eine noch vorhandene Belegseite
    expect(pdf.getPageCount()).toBe(2);
    expect(a).toBeGreaterThan(0);
  });
});
