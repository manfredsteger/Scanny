import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, paths } from '../db.js';
import { ingestFile } from '../pipeline/ingest.js';
import { documentQueue } from '../pipeline/queue.js';

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
        GROUP BY status
      `)
      .all() as { status: string; count: number }[];

    const stats = {
      inbox: 0,
      queued: 0,
      processing: 0,
      error: 0,
      filed: 0,
    };

    for (const row of rows) {
      if (row.status in stats) {
        (stats as any)[row.status] = row.count;
      }
    }

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
    const { status, folder_id, batch } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];

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
          WHERE dup.sha256 = d.sha256 AND dup.id < d.id AND d.sha256 IS NOT NULL
          ORDER BY dup.id ASC
          LIMIT 1
        ) as duplicate_of_id,
        (
          SELECT COALESCE(dup.title, dup.original_name)
          FROM documents dup
          WHERE dup.sha256 = d.sha256 AND dup.id < d.id AND d.sha256 IS NOT NULL
          ORDER BY dup.id ASC
          LIMIT 1
        ) as duplicate_of_title
      FROM documents d
      LEFT JOIN folders f ON d.folder_id = f.id
      ${whereClause}
      ORDER BY d.id DESC
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
            WHERE dup.sha256 = d.sha256 AND dup.id < d.id AND d.sha256 IS NOT NULL
            ORDER BY dup.id ASC
            LIMIT 1
          ) as duplicate_of_id,
          (
            SELECT COALESCE(dup.title, dup.original_name)
            FROM documents dup
            WHERE dup.sha256 = d.sha256 AND dup.id < d.id AND d.sha256 IS NOT NULL
            ORDER BY dup.id ASC
            LIMIT 1
          ) as duplicate_of_title
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
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(scanPath);
  } catch (error: any) {
    console.error('Fehler beim Ausliefern des aufbereiteten Bildes:', error);
    res.status(500).json({ error: 'Aufbereitetes Bild konnte nicht ausgeliefert werden.' });
  }
});

// PATCH /api/documents/:id -> Metadaten aktualisieren (Titel, Datum, Absender, Typ, Ordner, Betrag, Farbmodus, Drehung)
documentsRouter.patch('/documents/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Dokument nicht gefunden.' });
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
    } = req.body;

    const finalTitle = title !== undefined ? title : existing.title;
    const finalDocDate = doc_date !== undefined ? doc_date : existing.doc_date;
    const finalAmountCents = amount_cents !== undefined ? amount_cents : existing.amount_cents;
    const finalSender = sender !== undefined ? sender : existing.sender;
    const finalDocType = doc_type !== undefined ? doc_type : existing.doc_type;
    const finalUserEdited = user_edited !== undefined ? user_edited : existing.user_edited;
    const finalColorMode = color_mode !== undefined ? color_mode : existing.color_mode;
    const finalRotation = rotation !== undefined ? rotation : existing.rotation;
    const finalCorners = corners !== undefined ? (typeof corners === 'string' ? corners : JSON.stringify(corners)) : existing.corners;

    let finalFolderId = existing.folder_id;
    if (folder_id !== undefined) {
      if (folder_id === null || folder_id === '') {
        finalFolderId = null;
      } else {
        const folderIdNum = parseInt(folder_id, 10);
        if (isNaN(folderIdNum)) {
          return res.status(400).json({ error: 'Ungültige folder_id.' });
        }
        // Ordner-Existenz prüfen
        const folderExists = db.prepare('SELECT id FROM folders WHERE id = ?').get(folderIdNum);
        if (!folderExists) {
          return res.status(400).json({ error: `Zielordner ${folderIdNum} existiert nicht.` });
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
      id
    );

    // Falls Farbmodus, Drehung oder Ecken geändert wurden oder reprocess angefordert wurde,
    // Bild neu aufbereiten (asynchron über Queue)
    const needsReprocessing =
      Boolean(reprocess) ||
      (color_mode !== undefined && color_mode !== existing.color_mode) ||
      (rotation !== undefined && rotation !== existing.rotation) ||
      (corners !== undefined && corners !== existing.corners);

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
          f.color as folder_color
        FROM documents d
        LEFT JOIN folders f ON d.folder_id = f.id
        WHERE d.id = ?
      `)
      .get(id);

    res.json(updated);
  } catch (error: any) {
    console.error('Fehler beim Aktualisieren des Dokuments:', error);
    res.status(500).json({ error: 'Dokument konnte nicht aktualisiert werden.' });
  }
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

// DELETE /api/documents/:id -> Hart löschen inkl. Dateien
documentsRouter.delete('/documents/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Dokument-ID.' });
    }

    const db = getDb();
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
    if (!doc) {
      return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    }

    // Physikalische Dateien löschen
    const workScanPng = path.join(paths.workDir, `${id}.png`);
    const workScanJpg = path.join(paths.workDir, `${id}.jpg`);
    const filesToDelete = [doc.original_path, doc.thumb_path, doc.pdf_path, workScanPng, workScanJpg].filter(Boolean);
    for (const filePath of filesToDelete) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fErr) {
        console.warn(`[Dokumente] Konnte Datei ${filePath} nicht löschen:`, fErr);
      }
    }

    // Aus DB löschen
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);

    res.json({ ok: true, message: `Dokument ${id} gelöscht.` });
  } catch (error: any) {
    console.error('Fehler beim Löschen des Dokuments:', error);
    res.status(500).json({ error: 'Dokument konnte nicht gelöscht werden.' });
  }
});
