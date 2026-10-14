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
const { syncDocumentFiles, PARTS_SUFFIX } = await import('./files.js');

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

  // Original liegt als Teil der Dateigruppe direkt neben dem PDF
  const originalPath = path.join(paths.archiveDir, '_Eingang', `${docDate} ${options.title}.jpg`);
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
      for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
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
    // Die Antwort muss merged_pages mitliefern – der Drawer blendet daran den Trennen-Knopf ein
    expect(merged.merged_pages).toBe(2);

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

  it('ergänzt fehlende Metadaten aus den folgenden Seiten', async () => {
    // Mehrseitige Rechnung: Datum steht auf Seite 1, der Betrag erst auf Seite 3
    const seite1 = await createDocument({ title: 'Rechnung Stadtwerke', docDate: '2026-03-14' });
    const seite2 = await createDocument({ title: 'Verbrauchsübersicht', docDate: '2026-03-20' });
    const seite3 = await createDocument({ title: 'Zahlungsaufstellung', docDate: '2026-03-28' });
    const db = getDb();
    db.prepare('UPDATE documents SET doc_date = NULL, amount_cents = NULL WHERE id IN (?, ?)').run(seite2, seite1);
    db.prepare('UPDATE documents SET amount_cents = 49050 WHERE id = ?').run(seite3);
    db.prepare('UPDATE documents SET doc_date = ? WHERE id = ?').run('2026-03-14', seite1);

    const merged = (await mergeDocuments([seite1, seite2, seite3])).body;

    expect(merged.title).toBe('Rechnung Stadtwerke');
    expect(merged.doc_date).toBe('2026-03-14');
    expect(merged.amount_cents).toBe(49050);
    // Der Dateiname richtet sich nach den zusammengeführten Werten
    expect(path.basename(merged.pdf_path)).toBe('2026-03-14 Rechnung Stadtwerke.pdf');
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
    // Der Archiv-Name des ersten Belegs war vom zusammengefügten PDF belegt und muss
    // nach dem Trennen ohne " (2)"-Zusatz zurückkommen
    expect(path.basename(getDoc(a).pdf_path)).toBe('2026-05-04 Teil A.pdf');
    expect(path.basename(getDoc(b).pdf_path)).toBe('2026-05-04 Teil B.pdf');
    // Das zusammengefügte Dokument ist verworfen – seinen Archiv-Namen hat Beleg A zurück
    expect(getDoc(merged.id)).toBeUndefined();
    expect(getDoc(a).pdf_path).toBe(merged.pdf_path);
    // PDF und Original jeder Gruppe liegen wieder nebeneinander, der Teile-Ordner ist weg
    expect(fs.readdirSync(path.join(paths.archiveDir, '_Eingang')).sort()).toEqual([
      '2026-05-04 Teil A.jpg',
      '2026-05-04 Teil A.pdf',
      '2026-05-04 Teil B.jpg',
      '2026-05-04 Teil B.pdf',
    ]);
    expect(fs.existsSync(trashDir()) ? fs.readdirSync(trashDir()) : []).toEqual([]);
  });

  it('lehnt das Trennen bei einem nicht zusammengefügten Beleg ab', async () => {
    const a = await createDocument({ title: 'Normaler Beleg' });
    expect(splitDocument(a).code).toBe(409);
  });
});

describe('Dateigruppen (PDF + Original mit gleichem Namen)', () => {
  const inbox = () => path.join(paths.archiveDir, '_Eingang');
  const list = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

  it('benennt PDF und Original gemeinsam um', async () => {
    const id = await createDocument({ title: 'Alt' });
    getDb().prepare("UPDATE documents SET title = 'Neu' WHERE id = ?").run(id);
    syncDocumentFiles(id);
    expect(list(inbox())).toEqual(['2026-05-04 Neu.jpg', '2026-05-04 Neu.pdf']);
    expect(path.basename(getDoc(id).original_path)).toBe('2026-05-04 Neu.jpg');
  });

  it('benennt bei reiner Groß-/Kleinschreibungs-Änderung ohne (2) um', async () => {
    const id = await createDocument({ title: 'stapeltest' });
    getDb().prepare("UPDATE documents SET title = 'Stapeltest' WHERE id = ?").run(id);
    syncDocumentFiles(id);
    expect(path.basename(getDoc(id).pdf_path)).toBe('2026-05-04 Stapeltest.pdf');
    expect(list(inbox())).toEqual(['2026-05-04 Stapeltest.jpg', '2026-05-04 Stapeltest.pdf']);
  });

  it('weicht bei Namensgleichheit für die ganze Gruppe auf (2) aus', async () => {
    const a = await createDocument({ title: 'Gleich' });
    const b = await createDocument({ title: 'Anders' });
    getDb().prepare("UPDATE documents SET title = 'Gleich' WHERE id = ?").run(b);
    syncDocumentFiles(b);
    expect(path.basename(getDoc(b).pdf_path)).toBe('2026-05-04 Gleich (2).pdf');
    expect(path.basename(getDoc(b).original_path)).toBe('2026-05-04 Gleich (2).jpg');
    expect(path.basename(getDoc(a).pdf_path)).toBe('2026-05-04 Gleich.pdf');
  });

  it('nennt ein PDF-Original "(Original).pdf"', async () => {
    const id = await createDocument({ title: 'Digital' });
    const doc = getDoc(id);
    const pdfOriginal = path.join(inbox(), 'irgendwas.pdf');
    fs.renameSync(doc.original_path, pdfOriginal);
    getDb().prepare('UPDATE documents SET original_path = ? WHERE id = ?').run(pdfOriginal, id);
    syncDocumentFiles(id);
    expect(list(inbox())).toEqual(['2026-05-04 Digital (Original).pdf', '2026-05-04 Digital.pdf']);
  });

  it('legt beim Zusammenfügen die Teile nummeriert in "<Name> (Originale)/"', async () => {
    const a = await createDocument({ title: 'Seite Eins' });
    const b = await createDocument({ title: 'Seite Zwei' });
    const merged = (await mergeDocuments([a, b])).body;

    const partsDir = merged.pdf_path.replace(/\.pdf$/, '') + PARTS_SUFFIX;
    expect(list(partsDir)).toEqual(['01 Seite Eins.jpg', '01 Seite Eins.pdf', '02 Seite Zwei.jpg', '02 Seite Zwei.pdf']);
    expect(getDoc(a).merged_into).toBe(merged.id);
    expect(getDoc(a).original_path).toBe(path.join(partsDir, '01 Seite Eins.jpg'));
    // Teile tauchen NICHT im Papierkorb auf und werden nicht nach 30 Tagen gelöscht
    expect(list(trashDir())).toEqual([]);
    getDb().prepare("UPDATE documents SET deleted_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(a);
    expect(purgeExpiredTrash()).toBe(0);
    expect(getDoc(a)).toBeDefined();
  });

  it('nimmt einen Stapel komplett mit in den Papierkorb und zurück', async () => {
    const a = await createDocument({ title: 'Stapel A' });
    const b = await createDocument({ title: 'Stapel B' });
    const merged = (await mergeDocuments([a, b])).body;

    expect(trashDocument(merged.id).code).toBe(200);
    const trashed = getDoc(merged.id);
    expect(path.dirname(trashed.pdf_path)).toBe(trashDir());
    // Pfade der Teile wurden mitgezogen und stimmen auf der Platte
    expect(fs.existsSync(getDoc(a).pdf_path)).toBe(true);
    expect(fs.existsSync(getDoc(b).original_path)).toBe(true);
    expect(getDoc(a).pdf_path.startsWith(trashDir())).toBe(true);

    expect(restoreDocument(merged.id).code).toBe(200);
    expect(fs.existsSync(getDoc(a).pdf_path)).toBe(true);
    expect(getDoc(a).pdf_path.startsWith(inbox())).toBe(true);
  });

  it('löscht einen Stapel endgültig samt Teilen und Teile-Ordner', async () => {
    const a = await createDocument({ title: 'Weg A' });
    const b = await createDocument({ title: 'Weg B' });
    const merged = (await mergeDocuments([a, b])).body;
    expect(purgeDocument(merged.id).code).toBe(200);
    expect(getDoc(a)).toBeUndefined();
    expect(getDoc(b)).toBeUndefined();
    expect(list(inbox())).toEqual([]);
  });

  it('lässt Belege in Arbeit nicht in den Papierkorb', async () => {
    const id = await createDocument({ title: 'Läuft' });
    getDb().prepare("UPDATE documents SET status = 'processing' WHERE id = ?").run(id);
    expect(trashDocument(id).code).toBe(409);
  });
});
