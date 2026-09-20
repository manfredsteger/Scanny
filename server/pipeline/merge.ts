import path from 'node:path';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { getDb, paths } from '../db.js';
import { archiveDirForFolder, determineArchivePdfPath, localDateString } from './ocr.js';
import { purgeDocument, restoreDocument, trashDocument } from './trash.js';

export interface MergeResult {
  code: number;
  body: any;
}

/** Trenner zwischen den OCR-Texten der einzelnen Quelldokumente. */
function pageSeparator(pageNo: number): string {
  return `\n\n----- Seite ${pageNo} -----\n\n`;
}

interface SourceDoc {
  id: number;
  status: string;
  title: string | null;
  original_name: string | null;
  pdf_path: string | null;
  ocr_text: string | null;
  deleted_at: string | null;
  [key: string]: any;
}

/** Lädt die Quelldokumente in der übergebenen Reihenfolge und prüft, ob sie zusammenfügbar sind. */
function loadSources(ids: number[]): { docs?: SourceDoc[]; error?: { code: number; message: string } } {
  const db = getDb();
  const docs: SourceDoc[] = [];

  for (const id of ids) {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as SourceDoc | undefined;
    if (!doc) return { error: { code: 404, message: `Dokument ${id} wurde nicht gefunden.` } };
    if (doc.deleted_at) {
      return { error: { code: 409, message: `»${doc.title || doc.original_name}« liegt im Papierkorb.` } };
    }
    if (doc.status !== 'inbox' && doc.status !== 'filed') {
      return {
        error: {
          code: 409,
          message: `»${doc.title || doc.original_name}« ist noch nicht fertig aufbereitet (Status "${doc.status}").`,
        },
      };
    }
    if (!doc.pdf_path || !fs.existsSync(doc.pdf_path)) {
      return { error: { code: 409, message: `Für »${doc.title || doc.original_name}« gibt es noch kein PDF.` } };
    }
    docs.push(doc);
  }

  return { docs };
}

/**
 * Fügt mehrere Belege in der übergebenen Reihenfolge zu EINEM neuen Dokument zusammen:
 * - PDFs werden mit pdf-lib aneinandergehängt, OCR-Texte mit Seitentrenner verbunden.
 * - Metadaten (Titel, Datum, Betrag, Absender, Typ, Ordner) kommen vom ERSTEN Dokument.
 * - Die Quelldokumente wandern in den Papierkorb, ihre Herkunft steht in document_pages,
 *   damit "Seiten wieder trennen" sie zurückholen kann.
 * Dateisystem zuerst, dann DB (Regel 7); bei einem Fehler werden die Quellen wieder hergestellt.
 */
export async function mergeDocuments(ids: number[]): Promise<MergeResult> {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    return { code: 400, body: { error: 'Ein Beleg wurde mehrfach ausgewählt.' } };
  }
  if (ids.length < 2) {
    return { code: 400, body: { error: 'Bitte mindestens zwei Belege auswählen.' } };
  }

  const loaded = loadSources(ids);
  if (loaded.error) return { code: loaded.error.code, body: { error: loaded.error.message } };
  const docs = loaded.docs!;
  const base = docs[0];

  // 1. PDFs im Speicher zusammenfügen
  let mergedBytes: Uint8Array;
  let mergedPageCount = 0;
  try {
    const merged = await PDFDocument.create();
    for (const doc of docs) {
      const bytes = fs.readFileSync(doc.pdf_path!);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) merged.addPage(page);
    }
    mergedPageCount = merged.getPageCount();
    mergedBytes = await merged.save();
  } catch (err: any) {
    console.error('[Zusammenfügen] PDFs konnten nicht verbunden werden:', err);
    return { code: 500, body: { error: `PDFs konnten nicht verbunden werden: ${err?.message || err}` } };
  }

  // 2. OCR-Texte verbinden (Seiten ohne Text werden übersprungen, die Nummerierung bleibt erhalten)
  const ocrParts: string[] = [];
  docs.forEach((doc, index) => {
    const text = (doc.ocr_text || '').trim();
    if (!text) return;
    ocrParts.push(index === 0 ? text : pageSeparator(index + 1) + text);
  });
  const mergedOcrText = ocrParts.join('').trim() || null;

  // 3. Quellen in den Papierkorb legen – erst danach ist der Dateiname im Archiv wieder frei
  const trashed: number[] = [];
  const rollbackSources = () => {
    for (const id of trashed) {
      try {
        restoreDocument(id);
      } catch (err) {
        console.error(`[Zusammenfügen] Rücknahme für Dokument ${id} fehlgeschlagen:`, err);
      }
    }
  };

  for (const doc of docs) {
    const res = trashDocument(doc.id);
    if (res.code !== 200) {
      rollbackSources();
      return { code: res.code, body: res.body };
    }
    trashed.push(doc.id);
  }

  // 4. Zusammengefügtes PDF ins Archiv schreiben (Ordner und Name wie beim ersten Beleg)
  const targetDir = archiveDirForFolder(base.folder_id);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const dateStr =
    base.doc_date && /^\d{4}-\d{2}-\d{2}$/.test(String(base.doc_date).trim())
      ? String(base.doc_date).trim()
      : localDateString(base.created_at);
  const titleToUse =
    (base.title && base.title.trim()) || (base.original_name ? path.parse(base.original_name).name : 'Beleg');
  const targetPdf = determineArchivePdfPath(targetDir, dateStr, titleToUse, null);

  try {
    fs.writeFileSync(targetPdf, mergedBytes);
  } catch (err: any) {
    console.error('[Zusammenfügen] Zusammengefügtes PDF konnte nicht geschrieben werden:', err);
    rollbackSources();
    return { code: 500, body: { error: `PDF konnte nicht gespeichert werden: ${err?.message || err}` } };
  }

  // 5. Neues Dokument anlegen und die Herkunft der Seiten festhalten
  const db = getDb();
  let newId: number;
  try {
    newId = db.transaction(() => {
      const info = db
        .prepare(`
          INSERT INTO documents (
            status, source, import_batch, folder_id, title, doc_date, amount_cents, sender, doc_type,
            user_edited, original_name, original_path, pdf_path, thumb_path, page_count, color_mode,
            corners, rotation, ocr_text, extraction, detected, file_date, sha256, error,
            created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, NULL, ?, NULL, ?, ?,
            NULL, 0, ?, ?, NULL, ?, NULL, NULL,
            ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          )
        `)
        .run(
          base.status,
          base.source,
          base.import_batch,
          base.folder_id,
          base.title,
          base.doc_date,
          base.amount_cents,
          base.sender,
          base.doc_type,
          base.user_edited,
          base.original_name,
          targetPdf,
          mergedPageCount,
          base.color_mode || 'bw',
          mergedOcrText,
          base.extraction,
          base.file_date,
          base.created_at
        );

      const id = Number(info.lastInsertRowid);
      const insertPage = db.prepare(
        'INSERT INTO document_pages (document_id, page_no, source_document_id) VALUES (?, ?, ?)'
      );
      docs.forEach((doc, index) => insertPage.run(id, index + 1, doc.id));
      return id;
    })();
  } catch (dbErr: any) {
    console.error('[Zusammenfügen] Datenbankeintrag konnte nicht angelegt werden:', dbErr);
    try {
      fs.unlinkSync(targetPdf);
    } catch {}
    rollbackSources();
    return { code: 500, body: { error: `Zusammengefügtes Dokument konnte nicht gespeichert werden: ${dbErr?.message || dbErr}` } };
  }

  // 6. Vorschaubild des ersten Belegs übernehmen (Kopie – das Original bleibt im Papierkorb nutzbar)
  try {
    if (base.thumb_path && fs.existsSync(base.thumb_path)) {
      if (!fs.existsSync(paths.thumbsDir)) fs.mkdirSync(paths.thumbsDir, { recursive: true });
      const newThumb = path.join(paths.thumbsDir, `${newId}.webp`);
      fs.copyFileSync(base.thumb_path, newThumb);
      db.prepare('UPDATE documents SET thumb_path = ? WHERE id = ?').run(newThumb, newId);
    }
  } catch (thumbErr) {
    console.warn(`[Zusammenfügen] Vorschaubild für Dokument ${newId} konnte nicht übernommen werden:`, thumbErr);
  }

  console.log(
    `[Zusammenfügen] Dokumente ${ids.join(', ')} zu Dokument ${newId} verbunden (${mergedPageCount} PDF-Seite(n)).`
  );

  const created = db
    .prepare(`
      SELECT d.*, f.name as folder_name, f.kind as folder_kind, f.color as folder_color
      FROM documents d LEFT JOIN folders f ON d.folder_id = f.id
      WHERE d.id = ?
    `)
    .get(newId);

  return { code: 201, body: created };
}

/**
 * Trennt ein zusammengefügtes Dokument wieder auf: Die Quelldokumente werden aus dem Papierkorb
 * zurückgeholt, das zusammengefügte Dokument wird endgültig gelöscht.
 */
export function splitDocument(id: number): MergeResult {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  if (!doc) return { code: 404, body: { error: 'Dokument nicht gefunden.' } };

  const pages = db
    .prepare('SELECT page_no, source_document_id FROM document_pages WHERE document_id = ? ORDER BY page_no ASC')
    .all(id) as { page_no: number; source_document_id: number | null }[];

  if (pages.length === 0) {
    return { code: 409, body: { error: 'Dieses Dokument wurde nicht aus mehreren Belegen zusammengefügt.' } };
  }

  const available = pages.filter((p) => p.source_document_id !== null);
  if (available.length === 0) {
    return {
      code: 409,
      body: { error: 'Die ursprünglichen Belege wurden bereits endgültig gelöscht und lassen sich nicht mehr trennen.' },
    };
  }

  const restored: number[] = [];
  const failed: { id: number; error: string }[] = [];

  for (const page of available) {
    const sourceId = page.source_document_id!;
    const source = db.prepare('SELECT deleted_at FROM documents WHERE id = ?').get(sourceId) as
      | { deleted_at: string | null }
      | undefined;
    if (!source) {
      failed.push({ id: sourceId, error: 'Beleg existiert nicht mehr.' });
      continue;
    }
    if (!source.deleted_at) {
      // Wurde schon vorher von Hand wiederhergestellt
      restored.push(sourceId);
      continue;
    }
    const res = restoreDocument(sourceId);
    if (res.code === 200) restored.push(sourceId);
    else failed.push({ id: sourceId, error: res.body?.error || 'Wiederherstellen fehlgeschlagen.' });
  }

  if (restored.length === 0) {
    return { code: 500, body: { error: 'Kein einziger Beleg konnte wiederhergestellt werden.', failed } };
  }

  // Erst wenn mindestens ein Beleg zurück ist, das zusammengefügte Dokument verwerfen
  purgeDocument(id);

  const missing = pages.length - available.length;
  console.log(`[Trennen] Dokument ${id} aufgeteilt in ${restored.join(', ')}.`);

  return {
    code: 200,
    body: {
      ok: true,
      restored,
      failed,
      missing,
      message:
        `${restored.length} ${restored.length === 1 ? 'Beleg' : 'Belege'} wiederhergestellt.` +
        (missing > 0 ? ` ${missing} Seite(n) waren endgültig gelöscht und fehlen.` : ''),
    },
  };
}
