import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

// Testumgebung auf ein temporäres Verzeichnis zeigen lassen, BEVOR db.ts geladen wird
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scanny-test-'));
process.env.DATA_DIR = path.join(tmpRoot, 'data');
process.env.SCANNY_DIR = path.join(tmpRoot, 'scanny');
process.env.WATCH_DIR = path.join(tmpRoot, 'scanny', 'Upload');
process.env.ARCHIVE_DIR = path.join(tmpRoot, 'scanny', 'Archiv');

const { getDb, paths } = await import('../db.js');
const { trashDocument, restoreDocument, purgeDocument, purgeExpiredTrash, trashDir, TRASH_DIR_NAME } =
  await import('./trash.js');
const { mergeDocuments, splitDocument } = await import('./merge.js');

async function writePdf(target: string, pageCount: number): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) pdf.addPage([595, 842]);
  fs.writeFileSync(target, await pdf.save());
}

interface TestDocOptions {
  title: string;
  docDate?: string;
  pageCount?: number;
  ocrText?: string | null;
  status?: 'inbox' | 'filed';
}

/** Legt einen Beleg mit echtem Archiv-PDF an und liefert seine ID. */
async function createDocument(options: TestDocOptions): Promise<number> {
  const db = getDb();
  const pageCount = options.pageCount ?? 1;
  const docDate = options.docDate ?? '2026-05-04';

  const info = db
    .prepare(`
      INSERT INTO documents (status, source, original_name, title, doc_date, page_count, ocr_text, color_mode)
      VALUES (?, 'upload', ?, ?, ?, ?, ?, 'bw')
    `)
    .run(options.status ?? 'inbox', `${options.title}.jpg`, options.title, docDate, pageCount, options.ocrText ?? null);

  const id = Number(info.lastInsertRowid);
  const pdfPath = path.join(paths.archiveDir, '_Eingang', `${docDate} ${options.title}.pdf`);
  await writePdf(pdfPath, pageCount);

  const originalPath = path.join(paths.originalsDir, `${id}.jpg`);
  fs.mkdirSync(paths.originalsDir, { recursive: true });
  fs.writeFileSync(originalPath, 'nicht wirklich ein Bild');

  db.prepare('UPDATE documents SET pdf_path = ?, original_path = ? WHERE id = ?').run(pdfPath, originalPath, id);
  return id;
}

function getDoc(id: number): any {
  return getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM document_pages').run();
  db.prepare('DELETE FROM documents').run();
  for (const dir of [path.join(paths.archiveDir, '_Eingang'), trashDir()]) {
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, entry));
    }
  }
});

describe('Papierkorb', () => {
  it('legt einen Beleg weich ab und verschiebt das PDF nach _Papierkorb', async () => {
    const id = await createDocument({ title: 'Stromrechnung' });
    const before = getDoc(id);

    const result = trashDocument(id);

    expect(result.code).toBe(200);
    const after = getDoc(id);
    expect(after.deleted_at).toBeTruthy();
    expect(fs.existsSync(before.pdf_path)).toBe(false);
    expect(after.pdf_path.includes(`${path.sep}${TRASH_DIR_NAME}${path.sep}`)).toBe(true);
    expect(fs.existsSync(after.pdf_path)).toBe(true);
    // Original bleibt erhalten, damit Wiederherstellen möglich ist
    expect(fs.existsSync(after.original_path)).toBe(true);
  });

  it('holt einen Beleg aus dem Papierkorb zurück ins Archiv', async () => {
    const id = await createDocument({ title: 'Kontoauszug' });
    trashDocument(id);

    const result = restoreDocument(id);

    expect(result.code).toBe(200);
    const doc = getDoc(id);
    expect(doc.deleted_at).toBeNull();
    expect(doc.status).toBe('inbox');
    expect(doc.pdf_path.includes(TRASH_DIR_NAME)).toBe(false);
    expect(fs.existsSync(doc.pdf_path)).toBe(true);
  });

  it('lehnt Wiederherstellen ab, wenn der Beleg gar nicht im Papierkorb liegt', async () => {
    const id = await createDocument({ title: 'Quittung' });
    expect(restoreDocument(id).code).toBe(409);
  });

  it('löscht endgültig samt Original, PDF und Datenbankeintrag', async () => {
    const id = await createDocument({ title: 'Vertrag' });
    trashDocument(id);
    const doc = getDoc(id);

    const result = purgeDocument(id);

    expect(result.code).toBe(200);
    expect(getDoc(id)).toBeUndefined();
    expect(fs.existsSync(doc.pdf_path)).toBe(false);
    expect(fs.existsSync(doc.original_path)).toBe(false);
  });

  it('räumt nur Belege auf, die länger als 30 Tage im Papierkorb liegen', async () => {
    const alt = await createDocument({ title: 'Alter Beleg' });
    const neu = await createDocument({ title: 'Neuer Beleg' });
    trashDocument(alt);
    trashDocument(neu);

    getDb()
      .prepare("UPDATE documents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-31 days') WHERE id = ?")
      .run(alt);

    const purged = purgeExpiredTrash();

    expect(purged).toBe(1);
    expect(getDoc(alt)).toBeUndefined();
    expect(getDoc(neu)).toBeDefined();
  });
});

describe('Zusammenfügen und Trennen', () => {
  it('fügt Belege zu einem Dokument zusammen und legt die Quellen in den Papierkorb', async () => {
    const a = await createDocument({ title: 'Rechnung Seite 1', pageCount: 2, ocrText: 'Erster Text' });
    const b = await createDocument({ title: 'Rechnung Seite 2', pageCount: 1, ocrText: 'Zweiter Text' });

    const result = await mergeDocuments([a, b]);

    expect(result.code).toBe(201);
    const merged = result.body;
    expect(merged.page_count).toBe(3);
    expect(merged.title).toBe('Rechnung Seite 1');
    expect(merged.ocr_text).toContain('Erster Text');
    expect(merged.ocr_text).toContain('----- Seite 2 -----');
    expect(merged.ocr_text).toContain('Zweiter Text');
    expect(fs.existsSync(merged.pdf_path)).toBe(true);

    // Quellen liegen im Papierkorb, ihre Reihenfolge ist festgehalten
    expect(getDoc(a).deleted_at).toBeTruthy();
    expect(getDoc(b).deleted_at).toBeTruthy();
    const pages = getDb()
      .prepare('SELECT page_no, source_document_id FROM document_pages WHERE document_id = ? ORDER BY page_no')
      .all(merged.id) as { page_no: number; source_document_id: number }[];
    expect(pages).toEqual([
      { page_no: 1, source_document_id: a },
      { page_no: 2, source_document_id: b },
    ]);
  });

  it('lehnt das Zusammenfügen bei weniger als zwei Belegen ab', async () => {
    const a = await createDocument({ title: 'Einzelbeleg' });
    expect((await mergeDocuments([a])).code).toBe(400);
    expect((await mergeDocuments([a, a])).code).toBe(400);
  });

  it('trennt ein zusammengefügtes Dokument wieder in die Einzelbelege', async () => {
    const a = await createDocument({ title: 'Teil A' });
    const b = await createDocument({ title: 'Teil B' });
    const merged = (await mergeDocuments([a, b])).body;

    const result = splitDocument(merged.id);

    expect(result.code).toBe(200);
    expect(result.body.restored).toEqual([a, b]);
    expect(getDoc(a).deleted_at).toBeNull();
    expect(getDoc(b).deleted_at).toBeNull();
    expect(fs.existsSync(getDoc(a).pdf_path)).toBe(true);
    // Das zusammengefügte Dokument ist verworfen
    expect(getDoc(merged.id)).toBeUndefined();
    expect(fs.existsSync(merged.pdf_path)).toBe(false);
  });

  it('lehnt das Trennen bei einem nicht zusammengefügten Beleg ab', async () => {
    const a = await createDocument({ title: 'Normaler Beleg' });
    expect(splitDocument(a).code).toBe(409);
  });
});
