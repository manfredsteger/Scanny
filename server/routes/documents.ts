import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { getDb, paths } from '../db.js';
import { ingestFile } from '../pipeline/ingest.js';
import { documentQueue } from '../pipeline/queue.js';
import { ensureWorkImage, runScanPy } from '../pipeline/processDocument.js';
import { moveOrCopySync, planArchivePdf } from '../pipeline/ocr.js';
import { mergeDocuments, splitDocument } from '../pipeline/merge.js';
import { purgeDocument, restoreDocument, TRASH_RETENTION_DAYS, trashDocument } from '../pipeline/trash.js';
import { buildFtsQuery, SNIPPET_END, SNIPPET_START } from '../search.js';

export const documentsRouter = Router();

// Multer-Konfiguration mit Zwischenspeicherung in DATA_DIR/tmp
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(paths.tmpDir)) {
      fs.mkdirSync(paths.tmpDir, { recursive: true });
    }
    cb(null, paths.tmpDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, safeName);
  },
});

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.pdf']);

function fixOriginalName(name: string): string {
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (fixed && !fixed.includes('\ufffd')) {
      return fixed;
    }
  } catch {}
  return name;
}

const upload = multer({
  storage,
  limits: {
    fileSize: 60 * 1024 * 1024, // 60 MB pro Datei
  },
});

// Middleware-Wrapper für Multer mit sauberer JSON-Fehlerbehandlung
const handleFileUpload = (req: Request, res: Response, next: () => void) => {
  upload.array('files')(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Fehler beim Datei-Upload.' });
    }
    next();
  });
};

// POST /api/upload -> Mehrere Belege hochladen per Drag & Drop
documentsRouter.post('/upload', handleFileUpload, async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Keine Dateien übermittelt.' });
    }

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ids: number[] = [];
    const rejected: { name: string; reason: string }[] = [];

    const lastModifiedRaw = req.body.lastModified;
    const lastModifiedList = Array.isArray(lastModifiedRaw)
      ? lastModifiedRaw
      : lastModifiedRaw !== undefined
      ? [lastModifiedRaw]
      : [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fixedName = fixOriginalName(file.originalname);
      const ext = path.extname(fixedName).toLowerCase() || path.extname(file.originalname).toLowerCase();

      // Ungültige Dateitypen überspringen, gültige trotzdem annehmen
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch {}
        rejected.push({
          name: fixedName,
          reason: `Dateiendung "${ext}" nicht unterstützt. Erlaubt: JPG, PNG, HEIC, PDF.`,
        });
        continue;
      }

      const clientLastModified = lastModifiedList[i] || null;
      const docId = await ingestFile({
        sourcePath: file.path,
        source: 'upload',
        originalName: fixedName,
        importBatch: batchId,
        clientLastModified,
      });
      ids.push(docId);
    }

    if (ids.length === 0 && rejected.length > 0) {
      return res.status(400).json({
        error: 'Keine der hochgeladenen Dateien wird unterstützt.',
        batchId,
        ids: [],
        count: 0,
        rejected,
      });
    }

    res.status(201).json({
      batchId,
      ids,
      count: ids.length,
      rejected,
    });
  } catch (error: any) {
    console.error('Fehler beim Verarbeiten des Datei-Uploads:', error);
    res.status(500).json({ error: error?.message || 'Interner Serverfehler beim Upload.' });
  }
});


// GET /api/stats -> Statusübersicht der Warteschlange
documentsRouter.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(`
        SELECT status, COUNT(*) as count
        FROM documents
        WHERE deleted_at IS NULL
        GROUP BY status
      `)
      .all() as { status: string; count: number }[];

    const stats = {
      inbox: 0,
      queued: 0,
      processing: 0,
      error: 0,
      filed: 0,
      trash: 0,
    };

    for (const row of rows) {
      if (row.status in stats) {
        (stats as any)[row.status] = row.count;
      }
    }

    const trashRow = db
      .prepare('SELECT COUNT(*) as count FROM documents WHERE deleted_at IS NOT NULL')
      .get() as { count: number };
    stats.trash = trashRow?.count || 0;

    res.json(stats);
  } catch (error: any) {
    console.error('Fehler beim Abrufen der Statistiken:', error);
    res.status(500).json({ error: 'Statistiken konnten nicht geladen werden.' });
  }
});

// GET /api/documents -> Liste der Dokumente, gefiltert nach status und folder_id
documentsRouter.get('/documents', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, folder_id, batch, q } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];

    // Standard: nur nicht gelöschte Belege. ?deleted=1 zeigt ausschließlich den Papierkorb.
    const wantsTrash = req.query.deleted === '1' || req.query.deleted === 'true';
    conditions.push(wantsTrash ? 'd.deleted_at IS NOT NULL' : 'd.deleted_at IS NULL');

    if (q && typeof q === 'string' && q.trim()) {
      const cleanQ = q.trim();
      const ftsTerm = buildFtsQuery(cleanQ);
      const likeTerm = `%${cleanQ}%`;
      conditions.push(`(
        d.id IN (SELECT rowid FROM documents_fts WHERE documents_fts MATCH ?)
        OR d.title LIKE ?
        OR d.sender LIKE ?
        OR d.ocr_text LIKE ?
      )`);
      params.push(ftsTerm, likeTerm, likeTerm, likeTerm);
    }

    if (status && typeof status === 'string') {
      const statusList = status.split(',').map((s) => s.trim());
      if (statusList.length === 1) {
        conditions.push('d.status = ?');
        params.push(statusList[0]);
      } else {
        const placeholders = statusList.map(() => '?').join(',');
        conditions.push(`d.status IN (${placeholders})`);
        params.push(...statusList);
      }
    }

    if (folder_id !== undefined && typeof folder_id === 'string') {
      if (folder_id === 'null' || folder_id === '') {
        conditions.push('d.folder_id IS NULL');
      } else {
        const fId = parseInt(folder_id, 10);
        if (!isNaN(fId)) {
          conditions.push('d.folder_id = ?');
          params.push(fId);
        }
      }
    }

    if (batch && typeof batch === 'string') {
      conditions.push('d.import_batch = ?');
      params.push(batch);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        d.*,
        f.name as folder_name,
        f.kind as folder_kind,
        f.color as folder_color,
        (
          SELECT dup.id
          FROM documents dup
          WHERE dup.sha256 = d.sha256 AND dup.id < d.id AND d.sha256 IS NOT NULL AND dup.deleted_at IS NULL
          ORDER BY dup.id ASC
          LIMIT 1
        ) as duplicate_of_id,
        (
          SELECT COALESCE(dup.title, dup.original_name)
          FROM documents dup
          WHERE dup.sha256 = d.sha256 AND dup.id < d.id AND d.sha256 IS NOT NULL AND dup.deleted_at IS NULL
          ORDER BY dup.id ASC
          LIMIT 1
        ) as duplicate_of_title,
        (SELECT COUNT(*) FROM document_pages p WHERE p.document_id = d.id) as merged_pages
      FROM documents d
      LEFT JOIN folders f ON d.folder_id = f.id
      ${whereClause}
      ORDER BY ${wantsTrash ? 'd.deleted_at DESC, d.id DESC' : 'd.id DESC'}
    `;

    const documents = db.prepare(sql).all(...params);
    res.json(documents);
  } catch (error: any) {
    console.error('Fehler beim Laden der Dokumente:', error);
    res.status(500).json({ error: 'Dokumente konnten nicht geladen werden.' });
  }
});

// GET /api/documents/:id -> Einzeldokument abrufen
documentsRouter.get('/documents/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    }

    const db = getDb();
    const doc = db
      .prepare(`
        SELECT
          d.*,
          f.name as folder_name,
          f.kind as folder_kind,
          f.color as folder_color,
          (
            SELECT dup.id
            FROM documents dup
            WHERE dup.sha256 = d.sha256 AND dup.id < d.id AND d.sha256 IS NOT NULL AND dup.deleted_at IS NULL
            ORDER BY dup.id ASC
            LIMIT 1
          ) as duplicate_of_id,
          (
            SELECT COALESCE(dup.title, dup.original_name)
            FROM documents dup
            WHERE dup.sha256 = d.sha256 AND dup.id < d.id AND d.sha256 IS NOT NULL AND dup.deleted_at IS NULL
            ORDER BY dup.id ASC
            LIMIT 1
          ) as duplicate_of_title,
          (SELECT COUNT(*) FROM document_pages p WHERE p.document_id = d.id) as merged_pages
        FROM documents d
        LEFT JOIN folders f ON d.folder_id = f.id
        WHERE d.id = ?
      `)
      .get(id);

    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    }

    res.json(doc);
  } catch (error: any) {
    console.error('Fehler beim Abrufen des Dokuments:', error);
    res.status(500).json({ error: 'Dokument konnte nicht geladen werden.' });
  }
});

// GET /api/documents/:id/thumb -> Vorschaubild (webp) ausliefern
documentsRouter.get('/documents/:id/thumb', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    }

    const db = getDb();
    const doc = db.prepare('SELECT thumb_path FROM documents WHERE id = ?').get(id) as { thumb_path: string | null } | undefined;

    if (!doc || !doc.thumb_path || !fs.existsSync(doc.thumb_path)) {
      return res.status(404).json({ error: 'Kein Vorschaubild verfügbar.' });
    }

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(doc.thumb_path);
  } catch (error: any) {
    console.error('Fehler beim Ausliefern des Thumbnails:', error);
    res.status(500).json({ error: 'Thumbnail konnte nicht geladen werden.' });
  }
});

// GET /api/documents/:id/original -> Originaldatei zur Vorschau/Download ausliefern
documentsRouter.get('/documents/:id/original', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    }

    const db = getDb();
    const doc = db
      .prepare('SELECT original_name, original_path FROM documents WHERE id = ?')
      .get(id) as { original_name: string; original_path: string | null } | undefined;

    if (!doc || !doc.original_path || !fs.existsSync(doc.original_path)) {
      return res.status(404).json({ error: 'Originaldatei nicht gefunden.' });
    }

    const ext = path.extname(doc.original_path).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.pdf') contentType = 'application/pdf';
    else if (['.jpg', '.jpeg'].includes(ext)) contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';
    else if (['.heic', '.heif'].includes(ext)) contentType = 'image/heic';
    else if (ext === '.webp') contentType = 'image/webp';

    const filename = doc.original_name || 'dokument';
    const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`);
    res.sendFile(doc.original_path);
  } catch (error: any) {
    console.error('Fehler beim Ausliefern der Originaldatei:', error);
    res.status(500).json({ error: 'Originaldatei konnte nicht ausgeliefert werden.' });
  }
});

// GET /api/documents/:id/scan -> Aufbereitetes PNG zur Vorschau ausliefern
documentsRouter.get('/documents/:id/scan', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    }

    const scanPath = path.join(paths.workDir, `${id}.png`);
    if (!fs.existsSync(scanPath)) {
      return res.status(404).json({ error: 'Kein aufbereitetes Bild vorhanden.' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(scanPath);
  } catch (error: any) {
    console.error('Fehler beim Ausliefern des aufbereiteten Bildes:', error);
    res.status(500).json({ error: 'Aufbereitetes Bild konnte nicht ausgeliefert werden.' });
  }
});

// GET /api/search?q=...&folder_id=...&doc_type=... -> Volltextsuche mit bm25-Ranking und Textausschnitt
documentsRouter.get('/search', (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) return res.json([]);

    const conditions = ['documents_fts MATCH ?', 'd.deleted_at IS NULL'];
    const params: any[] = [buildFtsQuery(q)];

    const folderId = typeof req.query.folder_id === 'string' ? req.query.folder_id : '';
    if (folderId === 'inbox') {
      conditions.push('d.folder_id IS NULL');
    } else if (folderId && !isNaN(parseInt(folderId, 10))) {
      conditions.push('d.folder_id = ?');
      params.push(parseInt(folderId, 10));
    }
    const docType = typeof req.query.doc_type === 'string' ? req.query.doc_type : '';
    if (docType) {
      conditions.push('d.doc_type = ?');
      params.push(docType);
    }

    const rows = getDb()
      .prepare(
        `SELECT
           d.id, d.title, d.original_name, d.doc_date, d.doc_type, d.sender, d.amount_cents,
           d.status, d.folder_id, d.page_count, d.updated_at,
           f.name AS folder_name, f.kind AS folder_kind, f.color AS folder_color,
           snippet(documents_fts, -1, ?, ?, ' … ', 14) AS snippet,
           bm25(documents_fts, 10.0, 5.0, 1.0) AS rank
         FROM documents_fts
         JOIN documents d ON d.id = documents_fts.rowid
         LEFT JOIN folders f ON f.id = d.folder_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY rank
         LIMIT 100`
      )
      .all(SNIPPET_START, SNIPPET_END, ...params);

    res.json(rows);
  } catch (error: any) {
    console.error('Fehler bei der Suche:', error);
    res.status(500).json({ error: 'Suche fehlgeschlagen.' });
  }
});

// GET /api/documents/:id/pdf -> Liefert das durchsuchbare PDF/A inline für die Vorschau im Browser
documentsRouter.get('/documents/:id/pdf', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    }

    const db = getDb();
    const doc = db
      .prepare('SELECT id, title, original_name, pdf_path FROM documents WHERE id = ?')
      .get(id) as any;

    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    }

    if (!doc.pdf_path || !fs.existsSync(doc.pdf_path)) {
      return res.status(404).json({ error: 'Kein PDF vorhanden oder wird noch erzeugt.' });
    }

    const filename = path.basename(doc.pdf_path);
    const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(doc.pdf_path);
  } catch (error: any) {
    console.error('Fehler beim Ausliefern des PDFs:', error);
    res.status(500).json({ error: 'PDF konnte nicht ausgeliefert werden.' });
  }
});

/** Ecken aus dem Request prüfen: 4 Punkte [[x,y],…] mit endlichen Zahlen. */
function parseCorners(raw: any): { corners: [number, number][] | null; error?: string } {
  if (raw === null) return { corners: null };
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { corners: null, error: 'Ecken sind kein gültiges JSON.' };
    }
  }
  if (!Array.isArray(value) || value.length !== 4) {
    return { corners: null, error: 'Es müssen genau 4 Ecken übergeben werden.' };
  }
  const points: [number, number][] = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length !== 2) {
      return { corners: null, error: 'Jede Ecke muss aus zwei Zahlen bestehen.' };
    }
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!isFinite(x) || !isFinite(y) || x < 0 || y < 0) {
      return { corners: null, error: 'Ecken enthalten ungültige Koordinaten.' };
    }
    points.push([x, y]);
  }
  return { corners: points };
}

// GET /api/documents/:id/work-meta -> Maße des (gedrehten) Arbeitsbildes + gespeicherte Ecken für den Editor
documentsRouter.get('/documents/:id/work-meta', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });

    const doc = getDb()
      .prepare('SELECT corners, rotation, color_mode, detected FROM documents WHERE id = ?')
      .get(id) as any;
    if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden.' });

    const workPath = await ensureWorkImage(id);
    if (!workPath) {
      return res.status(409).json({ error: 'Für dieses Dokument gibt es kein bearbeitbares Bild (z. B. PDF).' });
    }

    const meta = await sharp(workPath).metadata();
    const rotation = (((doc.rotation || 0) % 360) + 360) % 360;
    const swap = rotation === 90 || rotation === 270;
    let corners: any = null;
    if (doc.corners) {
      try {
        corners = JSON.parse(doc.corners);
      } catch {
        corners = null;
      }
    }

    res.json({
      // Maße im Koordinatensystem der Ecken (= bereits gedrehtes Arbeitsbild, Regel 8)
      width: swap ? meta.height : meta.width,
      height: swap ? meta.width : meta.height,
      rotation,
      color_mode: doc.color_mode || 'bw',
      corners,
      detected: doc.detected,
    });
  } catch (error: any) {
    console.error('Fehler beim Laden der Arbeitsbild-Maße:', error);
    res.status(500).json({ error: 'Arbeitsbild konnte nicht gelesen werden.' });
  }
});

// POST /api/documents/:id/detect -> Ecken automatisch erkennen (scan.py --detect-only)
documentsRouter.post('/documents/:id/detect', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });

    const doc = getDb().prepare('SELECT rotation FROM documents WHERE id = ?').get(id) as any;
    if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden.' });

    const workPath = await ensureWorkImage(id);
    if (!workPath) {
      return res.status(409).json({ error: 'Für dieses Dokument gibt es kein bearbeitbares Bild (z. B. PDF).' });
    }

    // Drehung aus dem Request erlaubt die Erkennung im Editor vor dem Speichern
    const rotationRaw = Number(req.body?.rotation);
    const rotation = [0, 90, 180, 270].includes(rotationRaw) ? rotationRaw : doc.rotation || 0;

    const result = await runScanPy({ inputPath: workPath, rotation, detectOnly: true });
    if (!result.ok) {
      return res.status(500).json({ error: result.error || 'Ecken konnten nicht erkannt werden.' });
    }
    res.json({
      corners: result.corners,
      detected: Boolean(result.detected),
      width: result.width,
      height: result.height,
    });
  } catch (error: any) {
    console.error('Fehler bei der Eckenerkennung:', error);
    res.status(500).json({ error: error?.message || 'Ecken konnten nicht erkannt werden.' });
  }
});

// POST /api/documents/:id/reprocess { corners?, rotation?, color_mode? } -> neu aufbereiten
documentsRouter.post('/documents/:id/reprocess', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });

  const doc = getDb().prepare('SELECT original_path FROM documents WHERE id = ?').get(id) as any;
  if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
  if (!doc.original_path) {
    return res
      .status(409)
      .json({ error: 'Für dieses Dokument gibt es kein Original (z. B. zusammengefügte Belege).' });
  }
  if ((doc.original_path || '').toLowerCase().endsWith('.pdf')) {
    return res.status(409).json({ error: 'PDF-Dokumente können nicht neu aufbereitet werden.' });
  }

  const { corners, rotation, color_mode } = req.body || {};
  const patch: any = { reprocess: true };

  if (corners !== undefined) {
    const parsed = parseCorners(corners);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    patch.corners = parsed.corners;
  }
  if (rotation !== undefined) {
    if (![0, 90, 180, 270].includes(Number(rotation))) {
      return res.status(400).json({ error: 'Drehung muss 0, 90, 180 oder 270 sein.' });
    }
    patch.rotation = Number(rotation);
  }
  if (color_mode !== undefined) {
    if (!['bw', 'gray', 'color'].includes(color_mode)) {
      return res.status(400).json({ error: 'Farbmodus muss bw, gray oder color sein.' });
    }
    patch.color_mode = color_mode;
  }

  const result = patchDocument(id, patch);
  res.status(result.code).json(result.body);
});

// GET /api/documents/:id/work-preview -> DATA_DIR/work/<id>.jpg (gedreht), max. 1600 px, Cache-Control no-cache
documentsRouter.get('/documents/:id/work-preview', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    }

    const workPath = (await ensureWorkImage(id)) || path.join(paths.workDir, `${id}.jpg`);
    if (!fs.existsSync(workPath)) {
      return res.status(404).json({ error: 'Arbeitsbild nicht gefunden.' });
    }

    // Gedreht ausliefern (gleiches Koordinatensystem wie die Ecken, Regel 8).
    // ?rotation= erlaubt die Vorschau im Editor vor dem Speichern.
    const doc = getDb().prepare('SELECT rotation FROM documents WHERE id = ?').get(id) as any;
    const rotationRaw = Number(req.query.rotation);
    const rotation = [0, 90, 180, 270].includes(rotationRaw)
      ? rotationRaw
      : (((doc?.rotation || 0) % 360) + 360) % 360;

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache');

    const buffer = await sharp(workPath)
      .rotate(rotation)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return res.send(buffer);
  } catch (error: any) {
    console.error('Fehler beim Ausliefern des Arbeitsbildes:', error);
    res.status(500).json({ error: 'Arbeitsbild konnte nicht ausgeliefert werden.' });
  }
});

// PATCH /api/documents/:id -> Metadaten aktualisieren (Titel, Datum, Absender, Typ, Ordner, Betrag, Farbmodus, Drehung)
export interface PatchResult {
  code: number;
  body: any;
}

/**
 * Kern von PATCH /api/documents/:id – auch von /file, /unfile und /file-bulk genutzt,
 * damit es nur EINE Stelle gibt, die Ordner/Status/Archiv-PDF ändert.
 */
export function patchDocument(id: number, input: any): PatchResult {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
    if (!existing) {
      return { code: 404, body: { error: 'Dokument nicht gefunden.' } };
    }
    if (existing.deleted_at) {
      return {
        code: 409,
        body: { error: 'Dokument liegt im Papierkorb. Bitte zuerst wiederherstellen.' },
      };
    }

    const {
      title,
      doc_date,
      amount_cents,
      sender,
      doc_type,
      folder_id,
      user_edited,
      status,
      color_mode,
      rotation,
      corners,
      reprocess,
    } = input || {};

    const finalTitle = title !== undefined ? title : existing.title;
    const finalDocDate = doc_date !== undefined ? doc_date : existing.doc_date;
    const finalAmountCents = amount_cents !== undefined ? amount_cents : existing.amount_cents;
    const finalSender = sender !== undefined ? sender : existing.sender;
    const finalDocType = doc_type !== undefined ? doc_type : existing.doc_type;
    const finalUserEdited = user_edited !== undefined ? user_edited : existing.user_edited;
    const finalColorMode = color_mode !== undefined ? color_mode : existing.color_mode;
    const finalRotation = rotation !== undefined ? rotation : existing.rotation;
    const rotationChanged = rotation !== undefined && rotation !== existing.rotation;

    // Drehen nach der ersten Aufbereitung: Ändert sich rotation, corners auf NULL setzen (neu erkennen),
    // außer der Client schickt im selben Request neue corners mit.
    let finalCorners: string | null = existing.corners;
    if (corners !== undefined) {
      finalCorners = corners === null ? null : (typeof corners === 'string' ? corners : JSON.stringify(corners));
    } else if (rotationChanged) {
      finalCorners = null;
    }

    let finalFolderId = existing.folder_id;
    if (folder_id !== undefined) {
      if (folder_id === null || folder_id === '') {
        finalFolderId = null;
      } else {
        const folderIdNum = parseInt(folder_id, 10);
        if (isNaN(folderIdNum)) {
          return { code: 400, body: { error: 'Ungültige folder_id.' } };
        }
        // Ordner-Existenz prüfen
        const folderExists = db.prepare('SELECT id FROM folders WHERE id = ?').get(folderIdNum);
        if (!folderExists) {
          return { code: 400, body: { error: `Zielordner ${folderIdNum} existiert nicht.` } };
        }
        finalFolderId = folderIdNum;
      }
    }

    // Status nur bei 'inbox' <-> 'filed' ableiten.
    // Bei 'queued', 'processing' und 'error' bleibt der Status unverändert, folder_id wird trotzdem gespeichert.
    let finalStatus = existing.status;
    if (existing.status === 'inbox' || existing.status === 'filed') {
      finalStatus = finalFolderId !== null ? 'filed' : 'inbox';
    }

    // DATEISYSTEM ZUERST (Regel 7): Archiv-PDF an Ordner/Titel/Datum anpassen, erst danach die DB
    let finalPdfPath = existing.pdf_path;
    if (folder_id !== undefined || title !== undefined || doc_date !== undefined) {
      try {
        const target = planArchivePdf({
          title: finalTitle,
          doc_date: finalDocDate,
          folder_id: finalFolderId,
          pdf_path: existing.pdf_path,
          original_name: existing.original_name,
          created_at: existing.created_at,
        });
        if (target && target !== existing.pdf_path) {
          moveOrCopySync(existing.pdf_path, target);
          finalPdfPath = target;
        }
      } catch (fsErr: any) {
        console.error(`Archiv-PDF von Dokument ${id} konnte nicht verschoben werden:`, fsErr);
        return {
          code: 500,
          body: { error: `Archiv-PDF konnte nicht verschoben werden: ${fsErr?.message || fsErr}` },
        };
      }
    }

    const rollbackPdf = () => {
      if (finalPdfPath !== existing.pdf_path && finalPdfPath && existing.pdf_path) {
        try {
          moveOrCopySync(finalPdfPath, existing.pdf_path);
        } catch (rbErr) {
          console.error(`Archiv-PDF von Dokument ${id} konnte nicht zurückverschoben werden:`, rbErr);
        }
      }
    };

    try {
    db.prepare(`
      UPDATE documents
      SET title = ?,
          doc_date = ?,
          amount_cents = ?,
          sender = ?,
          doc_type = ?,
          folder_id = ?,
          user_edited = ?,
          status = ?,
          color_mode = ?,
          rotation = ?,
          corners = ?,
          pdf_path = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(
      finalTitle,
      finalDocDate,
      finalAmountCents,
      finalSender,
      finalDocType,
      finalFolderId,
      finalUserEdited,
      finalStatus,
      finalColorMode,
      finalRotation,
      finalCorners,
      finalPdfPath,
      id
    );
    } catch (dbErr) {
      rollbackPdf();
      throw dbErr;
    }

    // Falls Farbmodus, Drehung oder Ecken geändert wurden oder reprocess angefordert wurde,
    // Bild neu aufbereiten (asynchron über Queue)
    const needsReprocessing =
      Boolean(reprocess) ||
      (color_mode !== undefined && color_mode !== existing.color_mode) ||
      rotationChanged ||
      finalCorners !== existing.corners;

    if (needsReprocessing && existing.original_path && !existing.original_path.toLowerCase().endsWith('.pdf')) {
      db.prepare(`
        UPDATE documents
        SET status = 'queued',
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?
      `).run(id);
      documentQueue.enqueue(id);
    }

    const updated = db
      .prepare(`
        SELECT
          d.*,
          f.name as folder_name,
          f.kind as folder_kind,
          f.color as folder_color,
          (SELECT COUNT(*) FROM document_pages p WHERE p.document_id = d.id) as merged_pages
        FROM documents d
        LEFT JOIN folders f ON d.folder_id = f.id
        WHERE d.id = ?
      `)
      .get(id);

    return { code: 200, body: updated };
  } catch (error: any) {
    console.error('Fehler beim Aktualisieren des Dokuments:', error);
    return { code: 500, body: { error: 'Dokument konnte nicht aktualisiert werden.' } };
  }
}

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) ? null : id;
}

/** user_edited um ein Feld ergänzen (JSON-Array-String). */
function withEditedField(raw: string | null, field: string): string {
  let list: string[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!list.includes(field)) list.push(field);
  return JSON.stringify(list);
}

function fileDocument(id: number, folderId: number | null): PatchResult {
  const existing = getDb().prepare('SELECT user_edited FROM documents WHERE id = ?').get(id) as
    | { user_edited: string | null }
    | undefined;
  if (!existing) return { code: 404, body: { error: 'Dokument nicht gefunden.' } };
  return patchDocument(id, {
    folder_id: folderId,
    user_edited: withEditedField(existing.user_edited, 'folder_id'),
  });
}

documentsRouter.patch('/documents/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
  const result = patchDocument(id, req.body);
  res.status(result.code).json(result.body);
});

// POST /api/documents/:id/file { folder_id } -> in Ordner ablegen (PDF wandert nach Archiv/<Ordner>/)
documentsRouter.post('/documents/:id/file', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
  const folderId = req.body?.folder_id;
  if (folderId === undefined || folderId === null || folderId === '') {
    return res.status(400).json({ error: 'Bitte einen Zielordner angeben (folder_id).' });
  }
  const result = fileDocument(id, folderId);
  res.status(result.code).json(result.body);
});

// POST /api/documents/:id/unfile -> zurück in den Eingang (PDF wandert nach Archiv/_Eingang/)
documentsRouter.post('/documents/:id/unfile', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
  const result = fileDocument(id, null);
  res.status(result.code).json(result.body);
});

// POST /api/documents/file-bulk { ids: number[], folder_id: number | null } -> Mehrfachauswahl verschieben
documentsRouter.post('/documents/file-bulk', (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v: any) => parseInt(v, 10)).filter((v: number) => !isNaN(v)) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'Keine Dokumente ausgewählt.' });
  const folderId = req.body?.folder_id ?? null;
  const results = ids.map((id: number) => {
    const r = fileDocument(id, folderId);
    return { id, ok: r.code === 200, error: r.code === 200 ? undefined : r.body?.error };
  });
  const failed = results.filter((r: { ok: boolean }) => !r.ok);
  res.status(failed.length === results.length ? 400 : 200).json({ results, moved: results.length - failed.length });
});

// POST /api/documents/:id/retry -> Fehlerhafte Dokumente wieder einreihen
documentsRouter.post('/documents/:id/retry', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    }

    const db = getDb();
    const doc = db.prepare('SELECT id, status FROM documents WHERE id = ?').get(id) as any;
    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    }

    // Nur erlauben wenn status === 'error', sonst 409 Conflict
    if (doc.status !== 'error') {
      return res.status(409).json({
        error: `Dokument befindet sich im Status "${doc.status}". Nur fehlgeschlagene Dokumente (error) können erneut eingereiht werden.`,
      });
    }

    db.prepare(`
      UPDATE documents
      SET status = 'queued',
          error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(id);

    documentQueue.enqueue(id);

    res.json({ ok: true, id, message: 'Dokument wieder in die Warteschlange eingereiht.' });
  } catch (error: any) {
    console.error('Fehler beim Wiederholen des Dokuments:', error);
    res.status(500).json({ error: 'Dokument konnte nicht erneut eingereiht werden.' });
  }
});

// POST /api/documents/merge { ids: number[] } -> Belege zu einem Dokument zusammenfügen
documentsRouter.post('/documents/merge', async (req: Request, res: Response) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((v: any) => parseInt(v, 10)).filter((v: number) => !isNaN(v))
      : [];
    const result = await mergeDocuments(ids);
    res.status(result.code).json(result.body);
  } catch (error: any) {
    console.error('Fehler beim Zusammenfügen:', error);
    res.status(500).json({ error: error?.message || 'Belege konnten nicht zusammengefügt werden.' });
  }
});

// POST /api/documents/:id/add-page { source_id } -> einen Beleg aus dem Eingang anhängen.
// Läuft über dasselbe Zusammenfügen: das Ergebnis ist ein NEUES Dokument mit den Metadaten und dem
// Ablageort des Ziels, damit "Seiten wieder trennen" auch hier beide Belege zurückholen kann.
documentsRouter.post('/documents/:id/add-page', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });

    const sourceId = parseInt(req.body?.source_id, 10);
    if (isNaN(sourceId)) return res.status(400).json({ error: 'Bitte einen Beleg zum Anhängen angeben (source_id).' });
    if (sourceId === id) return res.status(400).json({ error: 'Ein Beleg kann nicht an sich selbst angehängt werden.' });

    const result = await mergeDocuments([id, sourceId]);
    res.status(result.code).json(result.body);
  } catch (error: any) {
    console.error('Fehler beim Anhängen einer Seite:', error);
    res.status(500).json({ error: error?.message || 'Seite konnte nicht angehängt werden.' });
  }
});

// POST /api/documents/:id/split -> zusammengefügtes Dokument wieder in Einzelbelege trennen
documentsRouter.post('/documents/:id/split', (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    const result = splitDocument(id);
    res.status(result.code).json(result.body);
  } catch (error: any) {
    console.error('Fehler beim Trennen des Dokuments:', error);
    res.status(500).json({ error: error?.message || 'Dokument konnte nicht getrennt werden.' });
  }
});

// GET /api/documents/:id/pages -> Herkunft der Seiten eines zusammengefügten Dokuments
documentsRouter.get('/documents/:id/pages', (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });

    const rows = getDb()
      .prepare(`
        SELECT p.page_no, p.source_document_id,
               s.title AS source_title, s.original_name AS source_original_name,
               s.page_count AS source_page_count, s.deleted_at AS source_deleted_at
        FROM document_pages p
        LEFT JOIN documents s ON s.id = p.source_document_id
        WHERE p.document_id = ?
        ORDER BY p.page_no ASC
      `)
      .all(id);

    res.json(rows);
  } catch (error: any) {
    console.error('Fehler beim Laden der Seitenherkunft:', error);
    res.status(500).json({ error: 'Seiten konnten nicht geladen werden.' });
  }
});

// POST /api/documents/:id/restore -> Beleg aus dem Papierkorb zurückholen
documentsRouter.post('/documents/:id/restore', (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    const result = restoreDocument(id);
    res.status(result.code).json(result.body);
  } catch (error: any) {
    console.error('Fehler beim Wiederherstellen des Dokuments:', error);
    res.status(500).json({ error: 'Dokument konnte nicht wiederhergestellt werden.' });
  }
});

// DELETE /api/documents/:id/purge -> endgültig löschen (Original, PDF, Vorschau, Arbeitsdateien)
documentsRouter.delete('/documents/:id/purge', (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    const result = purgeDocument(id);
    res.status(result.code).json(result.body);
  } catch (error: any) {
    console.error('Fehler beim endgültigen Löschen des Dokuments:', error);
    res.status(500).json({ error: 'Dokument konnte nicht endgültig gelöscht werden.' });
  }
});

// DELETE /api/documents/:id -> in den Papierkorb legen (PDF wandert nach Archiv/_Papierkorb/).
// Endgültig gelöscht wird erst über /purge oder automatisch nach TRASH_RETENTION_DAYS Tagen.
documentsRouter.delete('/documents/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    }

    const result = trashDocument(id);
    if (result.code !== 200) return res.status(result.code).json(result.body);

    res.json({
      ok: true,
      id,
      message: `Dokument ${id} in den Papierkorb verschoben (Löschung nach ${TRASH_RETENTION_DAYS} Tagen).`,
    });
  } catch (error: any) {
    console.error('Fehler beim Löschen des Dokuments:', error);
    res.status(500).json({ error: 'Dokument konnte nicht gelöscht werden.' });
  }
});
