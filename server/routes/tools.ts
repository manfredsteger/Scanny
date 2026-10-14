import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { ZipArchive } from 'archiver';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import { getDb, paths } from '../db.js';
import { ingestFile } from '../pipeline/ingest.js';
import { documentQueue } from '../pipeline/queue.js';
import { decodeText } from '../pipeline/fileTypes.js';
import { extractPdfText } from '../pipeline/ocr.js';
import { TEXTPDF_PY_PATH } from '../pipeline/processDocument.js';

const execFileAsync = promisify(execFile);

export const toolsRouter = Router();

// Temporäres Arbeitsverzeichnis für Tools-Sitzungen
const toolsSessionsDir = path.join(paths.tmpDir, 'tools_sessions');
if (!fs.existsSync(toolsSessionsDir)) {
  fs.mkdirSync(toolsSessionsDir, { recursive: true });
}

// Multer Storage für Tools
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, paths.tmpDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `tool_up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB pro Datei
    files: 200, // Bis zu 200 Dateien auf einmal (z. B. ganzer Ordner)
  },
});

function fixOriginalName(name: string): string {
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (fixed && !fixed.includes('\ufffd')) {
      return fixed;
    }
  } catch {}
  return name;
}

function sanitizeTitle(raw: string): string {
  return raw
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'Dokument';
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '\'':
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}


/**
 * Pfad aus URL-Teilen sicher auflösen: nur einfache Datei-/Ordnernamen (kein "..", kein "/"),
 * Ergebnis muss innerhalb von baseDir liegen. Express dekodiert %2F in Parametern zu "/" –
 * ohne diese Prüfung ließ sich mit "..%2F..%2Fscanny.db" jede Datei im Container lesen.
 */
function safeJoin(baseDir: string, ...segments: string[]): string | null {
  for (const segment of segments) {
    if (!segment || segment !== path.basename(segment) || segment === '.' || segment === '..') return null;
  }
  const resolved = path.resolve(baseDir, ...segments);
  return resolved.startsWith(path.resolve(baseDir) + path.sep) ? resolved : null;
}

/** Content-Disposition mit korrektem UTF-8-Dateinamen (sonst kommt "Rechnung%20M%C3%BCller.pdf" an). */
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Datei nach dem Ausliefern löschen (Ergebnisse enthalten oft sensible Belege). */
function removeAfter(res: Response, ...files: string[]): void {
  res.on('close', () => {
    for (const f of files) {
      try {
        if (fs.existsSync(f)) fs.rmSync(f, { recursive: true, force: true });
      } catch {}
    }
  });
}

/**
 * Aufräumen: Tool-Sitzungen und Zwischenergebnisse im Temp-Ordner älter als 3 Stunden löschen.
 * Läuft beim Start und stündlich – Temp liegt unter System/ und wandert sonst ins Backup.
 */
const TEMP_MAX_AGE_MS = 3 * 60 * 60 * 1000;
export function cleanupToolsTemp(): number {
  let removed = 0;
  const now = Date.now();
  for (const dir of [paths.tmpDir, toolsSessionsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (full === toolsSessionsDir) continue;
      try {
        if (now - fs.statSync(full).mtimeMs > TEMP_MAX_AGE_MS) {
          fs.rmSync(full, { recursive: true, force: true });
          removed++;
        }
      } catch {}
    }
  }
  if (removed > 0) console.log(`[Tools] ${removed} alte Temp-Einträge aufgeräumt.`);
  return removed;
}
cleanupToolsTemp();
setInterval(cleanupToolsTemp, 60 * 60 * 1000).unref?.();

interface SessionPageMeta {
  id: string;
  sourceFileName: string;
  sourceType: 'pdf' | 'image' | 'text' | 'office';
  originalPageIndex: number;
  displayNumber: number;
  rotation: number;
  thumbnailUrl: string;
  width: number;
  height: number;
  sessionId: string;
  pageKey: string;
  sourceFilePath: string;
  textSnippet?: string;
  fileSize?: number;
}

// -------------------------------------------------------------
// POST /api/tools/prepare-session  (Feld "sessionId" optional: an bestehende Sitzung anhängen)
// Dateien hochladen & Seiten extrahieren. Damit die Werkbank nur zwei Seitenarten kennt (PDF, Bild),
// werden Textdateien hier vollständig mit textpdf.py gesetzt und HEIC in JPG umgewandelt.
// -------------------------------------------------------------
const STUDIO_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.bmp', '.gif']);
const STUDIO_TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.log']);

async function renderPdfThumb(pdfPath: string, pageIndex: number, thumbPath: string): Promise<void> {
  try {
    await execFileAsync(
      'gs',
      ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=jpeg', '-dJPEGQ=85', '-r100',
        `-dFirstPage=${pageIndex + 1}`, `-dLastPage=${pageIndex + 1}`, `-sOutputFile=${thumbPath}`, pdfPath],
      { timeout: 30000 }
    );
  } catch {
    const svg = `<svg width="400" height="560" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#64748b">Seite ${pageIndex + 1}</text></svg>`;
    await sharp(Buffer.from(svg)).jpeg().toFile(thumbPath);
  }
}

toolsRouter.post(
  '/tools/prepare-session',
  upload.array('files', 200),
  async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[]) || [];
    try {
      if (files.length === 0) {
        return res.status(400).json({ error: 'Keine Dateien hochgeladen.' });
      }

      // Bestehende Sitzung fortsetzen (Seiten anhängen) oder neue anlegen
      const requested = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
      const existingPath = requested ? safeJoin(toolsSessionsDir, requested) : null;
      const existingManifest =
        existingPath && fs.existsSync(path.join(existingPath, 'manifest.json'))
          ? JSON.parse(fs.readFileSync(path.join(existingPath, 'manifest.json'), 'utf8'))
          : null;
      const sessionId = existingManifest ? requested : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sessionPath = path.join(toolsSessionsDir, sessionId);
      fs.mkdirSync(sessionPath, { recursive: true });

      const previous: SessionPageMeta[] = existingManifest?.pages || [];
      const fileOffset: number = existingManifest?.fileCount || 0;
      const newPages: SessionPageMeta[] = [];
      const skipped: { name: string; reason: string }[] = [];
      let displayNum = previous.length + 1;

      const addPdfPages = async (pdfPath: string, fileIdx: number, fileName: string, fileSize: number) => {
        const pdfDoc = await PDFDocument.load(fs.readFileSync(pdfPath), { ignoreEncryption: true });
        for (let p = 0; p < pdfDoc.getPageCount(); p++) {
          const { width, height } = pdfDoc.getPage(p).getSize();
          const pageKey = `p_${fileIdx}_${p}`;
          await renderPdfThumb(pdfPath, p, path.join(sessionPath, `${pageKey}.jpg`));
          newPages.push({
            id: `${sessionId}_${pageKey}`, sourceFileName: fileName, sourceType: 'pdf', originalPageIndex: p,
            displayNumber: displayNum++, rotation: 0, thumbnailUrl: `/api/tools/thumb/${sessionId}/${pageKey}.jpg`,
            width: Math.round(width), height: Math.round(height), sessionId, pageKey, sourceFilePath: pdfPath, fileSize,
          });
        }
      };

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileIdx = fileOffset + i;
        const fixedName = fixOriginalName(file.originalname);
        const ext = path.extname(fixedName).toLowerCase() || path.extname(file.originalname).toLowerCase();
        const fileSize = fs.existsSync(file.path) ? fs.statSync(file.path).size : 0;
        // Quelle in den Sitzungsordner: wird mit der Sitzung aufgeräumt
        const stored = path.join(sessionPath, `src_${fileIdx}${ext}`);
        try {
          if (path.basename(fixedName).startsWith('.')) {
            continue; // .DS_Store, ._Datei – macOS-Beiwerk, keine Dokumente
          }
          fs.renameSync(file.path, stored);

          if (ext === '.pdf') {
            await addPdfPages(stored, fileIdx, fixedName, fileSize);
          } else if (ext === '.heic' || ext === '.heif' || STUDIO_IMAGE_EXT.has(ext)) {
            let imagePath = stored;
            if (ext === '.heic' || ext === '.heif') {
              // sharp kann hier kein HEIC lesen → wie in der Pipeline über heif-convert
              imagePath = path.join(sessionPath, `src_${fileIdx}.jpg`);
              await execFileAsync('heif-convert', ['-q', '92', stored, imagePath], { timeout: 120000 });
            }
            const pageKey = `p_${fileIdx}_0`;
            const meta = await sharp(imagePath).rotate().metadata();
            await sharp(imagePath).rotate()
              .resize({ width: 700, height: 900, fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 }).toFile(path.join(sessionPath, `${pageKey}.jpg`));
            newPages.push({
              id: `${sessionId}_${pageKey}`, sourceFileName: fixedName, sourceType: 'image', originalPageIndex: 0,
              displayNumber: displayNum++, rotation: 0, thumbnailUrl: `/api/tools/thumb/${sessionId}/${pageKey}.jpg`,
              width: meta.width || 800, height: meta.height || 1100, sessionId, pageKey, sourceFilePath: imagePath, fileSize,
            });
          } else if (STUDIO_TEXT_EXT.has(ext)) {
            // Vollständig als PDF setzen (Umlaute/Sonderzeichen, mehrere Seiten) statt nur eine Vorschau
            const { text } = decodeText(fs.readFileSync(stored));
            const utf8 = path.join(sessionPath, `src_${fileIdx}.utf8.txt`);
            fs.writeFileSync(utf8, text, 'utf8');
            const pdfPath = path.join(sessionPath, `src_${fileIdx}.pdf`);
            const mode = ext === '.md' || ext === '.markdown' ? 'md' : 'txt';
            await execFileAsync('python3', [TEXTPDF_PY_PATH, utf8, pdfPath, mode, fixedName], { timeout: 60000 });
            await addPdfPages(pdfPath, fileIdx, fixedName, fileSize);
          } else {
            skipped.push({
              name: fixedName,
              reason: ['.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx'].includes(ext)
                ? 'Office-Dateien kann Scanny nicht umwandeln – bitte vorher als PDF speichern.'
                : `Dateityp "${ext || '(keine Endung)'}" wird nicht unterstützt.`,
            });
          }
        } catch (fileErr: any) {
          console.error(`[Tools] ${fixedName} konnte nicht gelesen werden:`, fileErr);
          skipped.push({ name: fixedName, reason: 'Datei konnte nicht gelesen werden (beschädigt oder unbekanntes Format).' });
        } finally {
          try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          } catch {}
        }
      }

      const allPages = [...previous, ...newPages];
      fs.writeFileSync(
        path.join(sessionPath, 'manifest.json'),
        JSON.stringify({ sessionId, pages: allPages, fileCount: fileOffset + files.length, createdAt: new Date().toISOString() })
      );
      if (skipped.length > 0) console.log(`[Tools] Übersprungen: ${skipped.map((x) => x.name).join(', ')}`);

      // Server-Pfade bleiben auf dem Server
      const publicPages = (list: SessionPageMeta[]) => list.map(({ sourceFilePath, ...rest }) => rest);
      res.json({
        sessionId,
        pages: publicPages(newPages),
        allPages: publicPages(allPages),
        skipped,
        fileCount: files.length,
        totalPages: newPages.length,
      });
    } catch (err: any) {
      for (const f of files) {
        try {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        } catch {}
      }
      console.error('[Tools] Fehler beim Vorbereiten der Sitzung:', err);
      res.status(500).json({ error: err?.message || 'Fehler beim Analysieren der Dateien.' });
    }
  }
);

// -------------------------------------------------------------
// GET /api/tools/thumb/:sessionId/:filename
// Miniaturansicht einer Seite ausliefern
// -------------------------------------------------------------
toolsRouter.get('/tools/thumb/:sessionId/:filename', (req: Request, res: Response) => {
  const { sessionId, filename } = req.params;
  const filePath = safeJoin(toolsSessionsDir, sessionId, filename);

  if (filePath && fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return fs.createReadStream(filePath).pipe(res);
  }

  // Fallback: 1x1 transparenter Pixel
  res.status(404).end();
});

// -------------------------------------------------------------
// POST /api/tools/assemble
// Seiten neu anordnen, drehen, nummerieren, komprimieren und
// entweder als Datei herunterladen oder direkt an Scanny übergeben!
// -------------------------------------------------------------
toolsRouter.post('/tools/assemble', async (req: Request, res: Response) => {
  try {
    const {
      sessionId,
      title = 'Zusammengeführtes_Dokument',
      pages, // Array von { pageKey, rotation, include }
      pageNumbering, // { enabled, position, format, startFrom, fontSize }
      compression = 'none', // 'none' | 'light' | 'medium' | 'high'
      targetFormat = 'pdf', // 'pdf' | 'images_zip' | 'text'
      destination = 'download', // 'download' | 'scanny'
      folderId = null,
    } = req.body;

    if (!sessionId || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Keine Seiten zum Zusammenfügen angegeben.' });
    }

    const sessionPath = safeJoin(toolsSessionsDir, String(sessionId));
    if (!sessionPath) return res.status(400).json({ error: 'Ungültige Sitzung.' });
    const manifestPath = path.join(sessionPath, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: 'Sitzung abgelaufen oder nicht gefunden.' });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifestPagesMap = new Map<string, SessionPageMeta>();
    for (const p of manifest.pages) {
      manifestPagesMap.set(p.pageKey, p);
    }

    const safeTitle = sanitizeTitle(title);
    const finalPdf = await PDFDocument.create();
    const helveticaFont = await finalPdf.embedFont(StandardFonts.Helvetica);

    // Filter aktive Seiten
    const activePages = pages.filter((p: any) => p.include !== false);
    if (activePages.length === 0) {
      return res.status(400).json({ error: 'Mindestens eine Seite muss ausgewählt bleiben.' });
    }

    // Cache geladene Quell-PDFs für Performance
    const loadedPdfs = new Map<string, PDFDocument>();

    for (let i = 0; i < activePages.length; i++) {
      const pageReq = activePages[i];
      const pageMeta = manifestPagesMap.get(pageReq.pageKey);
      if (!pageMeta || !fs.existsSync(pageMeta.sourceFilePath)) continue;

      const userRotation = ((pageReq.rotation || 0) % 360 + 360) % 360;

      // 1. Quellseite ist PDF
      if (pageMeta.sourceType === 'pdf') {
        let srcPdf = loadedPdfs.get(pageMeta.sourceFilePath);
        if (!srcPdf) {
          const bytes = fs.readFileSync(pageMeta.sourceFilePath);
          srcPdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
          loadedPdfs.set(pageMeta.sourceFilePath, srcPdf);
        }

        const [copiedPage] = await finalPdf.copyPages(srcPdf, [pageMeta.originalPageIndex]);
        const currentRot = copiedPage.getRotation().angle;
        copiedPage.setRotation(degrees((currentRot + userRotation) % 360));
        finalPdf.addPage(copiedPage);
      }
      // 2. Quellseite ist Bild
      else if (pageMeta.sourceType === 'image') {
        let sharpImg = sharp(pageMeta.sourceFilePath).rotate();
        if (userRotation !== 0) {
          sharpImg = sharpImg.rotate(userRotation);
        }
        const imgBuffer = await sharpImg.jpeg({ quality: 92 }).toBuffer();
        const embeddedImg = await finalPdf.embedJpg(imgBuffer);
        const imgDims = embeddedImg.scale(1.0);

        // Standard DIN A4 (595.28 x 841.89 pt) oder Originalgröße
        const a4Width = 595.28;
        const a4Height = 841.89;

        // Skalierung proportional in A4 einpassen mit 20pt Rand
        const margin = 20;
        const maxW = a4Width - margin * 2;
        const maxH = a4Height - margin * 2;
        const scale = Math.min(maxW / imgDims.width, maxH / imgDims.height, 1.0);

        const drawW = imgDims.width * scale;
        const drawH = imgDims.height * scale;
        const posX = margin + (maxW - drawW) / 2;
        const posY = margin + (maxH - drawH) / 2;

        const newPage = finalPdf.addPage([a4Width, a4Height]);
        newPage.drawImage(embeddedImg, {
          x: posX,
          y: posY,
          width: drawW,
          height: drawH,
        });
      }
      // (Textdateien werden schon beim Einlesen als PDF gesetzt – es gibt nur PDF- und Bildseiten)
    }

    // Seitenzahlen einfügen (falls gewünscht)
    if (pageNumbering && pageNumbering.enabled) {
      const total = finalPdf.getPageCount();
      const startFrom = typeof pageNumbering.startFrom === 'number' ? pageNumbering.startFrom : 1;
      const fontSize = pageNumbering.fontSize || 10;
      const pos = pageNumbering.position || 'bottom-center';
      const fmt = pageNumbering.format || 'page_x_of_y';

      for (let pIdx = 0; pIdx < total; pIdx++) {
        const p = finalPdf.getPage(pIdx);
        const { width, height } = p.getSize();
        const currentNum = startFrom + pIdx;

        let numText = `Seite ${currentNum} von ${total}`;
        if (fmt === 'page_x') numText = `Seite ${currentNum}`;
        if (fmt === 'just_x') numText = `${currentNum}`;

        const textWidth = helveticaFont.widthOfTextAtSize(numText, fontSize);
        let x = (width - textWidth) / 2;
        let y = 25;

        if (pos === 'bottom-left') {
          x = 35;
          y = 25;
        } else if (pos === 'bottom-right') {
          x = width - textWidth - 35;
          y = 25;
        } else if (pos === 'top-center') {
          x = (width - textWidth) / 2;
          y = height - 30;
        } else if (pos === 'top-right') {
          x = width - textWidth - 35;
          y = height - 30;
        }

        p.drawText(numText, {
          x,
          y,
          size: fontSize,
          font: helveticaFont,
          color: rgb(0.3, 0.3, 0.3),
        });
      }
    }

    // PDF speichern
    let assembledPdfBytes = await finalPdf.save();
    let finalOutputPath = path.join(paths.tmpDir, `assemble_${Date.now()}_${safeTitle}.pdf`);
    fs.writeFileSync(finalOutputPath, assembledPdfBytes);

    // Optionale Komprimierung via Ghostscript
    if (compression && compression !== 'none') {
      const compressedPath = path.join(paths.tmpDir, `comp_${Date.now()}_${safeTitle}.pdf`);
      let gsSetting = '/ebook'; // Medium 150 DPI
      if (compression === 'light') gsSetting = '/printer'; // Light 300 DPI
      if (compression === 'high') gsSetting = '/screen'; // High 72 DPI

      try {
        await execFileAsync(
          'gs',
          [
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            `-dPDFSETTINGS=${gsSetting}`,
            '-dNOPAUSE',
            '-dQUIET',
            '-dBATCH',
            `-sOutputFile=${compressedPath}`,
            finalOutputPath,
          ],
          { timeout: 45000 }
        );

        if (fs.existsSync(compressedPath) && fs.statSync(compressedPath).size < fs.statSync(finalOutputPath).size) {
          try {
            fs.unlinkSync(finalOutputPath);
          } catch {}
          finalOutputPath = compressedPath;
        }
      } catch (compErr) {
        console.warn('[Tools] Komprimierung fehlgeschlagen, verwende Original:', compErr);
      }
    }

    // -------------------------------------------------------------
    // Ziel A: In Scanny übernehmen (an Posteingang übergeben)
    // -------------------------------------------------------------
    if (destination === 'scanny') {
      const docId = await ingestFile({
        sourcePath: finalOutputPath,
        source: 'upload',
        originalName: `${safeTitle}.pdf`,
        clientLastModified: Date.now(),
      });

      // Falls direkt ein Ordner gewählt wurde, gleich zuordnen
      if (folderId && typeof folderId === 'number') {
        const db = getDb();
        db.prepare('UPDATE documents SET folder_id = ?, title = ? WHERE id = ?').run(
          folderId,
          safeTitle,
          docId
        );
      }

      return res.status(201).json({
        success: true,
        mode: 'scanny',
        docId,
        title: safeTitle,
        message: 'Dokument wurde erfolgreich an Scanny übergeben!',
      });
    }

    // -------------------------------------------------------------
    // Ziel B: Lokal herunterladen als ZIP (Bilder aller Seiten)
    // -------------------------------------------------------------
    if (targetFormat === 'images_zip') {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', attachment(`${safeTitle}_Seiten.zip`));

      const archive = new ZipArchive({ zlib: { level: 8 } });
      archive.pipe(res);

      // Jede Seite mit GS als Bild rendern
      const tempImgDir = path.join(paths.tmpDir, `zip_${Date.now()}`);
      fs.mkdirSync(tempImgDir, { recursive: true });
      removeAfter(res, tempImgDir, finalOutputPath);

      try {
        await execFileAsync(
          'gs',
          [
            '-q',
            '-dNOPAUSE',
            '-dBATCH',
            '-sDEVICE=jpeg',
            '-dJPEGQ=90',
            '-r150',
            `-sOutputFile=${path.join(tempImgDir, 'seite_%03d.jpg')}`,
            finalOutputPath,
          ],
          { timeout: 60000 }
        );

        const imgFiles = fs.readdirSync(tempImgDir).sort();
        for (const imgName of imgFiles) {
          archive.file(path.join(tempImgDir, imgName), { name: imgName });
        }
      } catch (zipErr) {
        console.error('[Tools] Fehler beim Erstellen der Bilder-Zip:', zipErr);
      }

      archive.finalize();
      return;
    }

    // -------------------------------------------------------------
    // Ziel C: Lokal herunterladen als PDF
    // -------------------------------------------------------------
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachment(`${safeTitle}.pdf`));
    removeAfter(res, finalOutputPath);
    return fs.createReadStream(finalOutputPath).pipe(res);
  } catch (err: any) {
    console.error('[Tools] Fehler bei assemble:', err);
    res.status(500).json({ error: err?.message || 'Fehler beim Zusammenfügen des Dokuments.' });
  }
});

// -------------------------------------------------------------
// POST /api/tools/export-single-page
// Einzelne Dokumentseite hochauflösend als JPG, PNG oder PDF exportieren
// -------------------------------------------------------------
toolsRouter.post('/tools/export-single-page', async (req: Request, res: Response) => {
  try {
    const {
      sessionId,
      pageKey,
      format = 'jpg', // 'jpg' | 'png' | 'pdf'
      rotation = 0,
      title = 'Seite',
      pageNumber = 1,
    } = req.body;

    if (!sessionId || !pageKey) {
      return res.status(400).json({ error: 'sessionId und pageKey sind erforderlich.' });
    }

    const sessionPath = safeJoin(toolsSessionsDir, String(sessionId));
    if (!sessionPath) return res.status(400).json({ error: 'Ungültige Sitzung.' });
    const manifestPath = path.join(sessionPath, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: 'Sitzung abgelaufen oder nicht gefunden.' });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const pageMeta = manifest.pages?.find((p: any) => p.pageKey === pageKey);

    if (!pageMeta || !fs.existsSync(pageMeta.sourceFilePath)) {
      return res.status(404).json({ error: 'Quellseite nicht gefunden.' });
    }

    const cleanTitle = sanitizeTitle(title);
    const safeBaseName = `${cleanTitle}_Seite_${pageNumber}`;
    const userRotation = ((rotation || 0) % 360 + 360) % 360;

    // A) Export als JPG oder PNG
    if (format === 'jpg' || format === 'png') {
      const isPng = format === 'png';
      let imageBuffer: Buffer;

      if (pageMeta.sourceType === 'pdf') {
        const tempOut = path.join(
          paths.tmpDir,
          `page_render_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${isPng ? 'png' : 'jpg'}`
        );
        const device = isPng ? 'png16m' : 'jpeg';
        const extraArgs = isPng ? [] : ['-dJPEGQ=95'];

        await execFileAsync(
          'gs',
          [
            '-q',
            '-dNOPAUSE',
            '-dBATCH',
            `-sDEVICE=${device}`,
            '-r200',
            ...extraArgs,
            `-dFirstPage=${pageMeta.originalPageIndex + 1}`,
            `-dLastPage=${pageMeta.originalPageIndex + 1}`,
            `-sOutputFile=${tempOut}`,
            pageMeta.sourceFilePath,
          ],
          { timeout: 30000 }
        );

        if (!fs.existsSync(tempOut)) {
          throw new Error('Fehler beim Rendern der Seite.');
        }

        let sharpInstance = sharp(tempOut);
        if (userRotation !== 0) {
          sharpInstance = sharpInstance.rotate(userRotation);
        }

        imageBuffer = isPng
          ? await sharpInstance.png({ compressionLevel: 8 }).toBuffer()
          : await sharpInstance.jpeg({ quality: 95 }).toBuffer();

        try {
          fs.unlinkSync(tempOut);
        } catch {}
      } else if (pageMeta.sourceType === 'image') {
        let sharpInstance = sharp(pageMeta.sourceFilePath).rotate();
        if (userRotation !== 0) {
          sharpInstance = sharpInstance.rotate(userRotation);
        }
        imageBuffer = isPng
          ? await sharpInstance.png({ compressionLevel: 8 }).toBuffer()
          : await sharpInstance.jpeg({ quality: 95 }).toBuffer();
      } else {
        const textContent = pageMeta.textSnippet || pageMeta.sourceFileName;
        const svg = `
          <svg width="800" height="1130" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#ffffff" />
            <text x="50" y="80" font-family="sans-serif" font-size="24" font-weight="bold" fill="#111827">${escapeXml(pageMeta.sourceFileName)}</text>
            <text x="50" y="130" font-family="monospace" font-size="14" fill="#374151">
              ${escapeXml(textContent).slice(0, 500)}
            </text>
          </svg>
        `;
        let sharpInstance = sharp(Buffer.from(svg));
        if (userRotation !== 0) {
          sharpInstance = sharpInstance.rotate(userRotation);
        }
        imageBuffer = isPng
          ? await sharpInstance.png().toBuffer()
          : await sharpInstance.jpeg({ quality: 95 }).toBuffer();
      }

      res.setHeader('Content-Type', isPng ? 'image/png' : 'image/jpeg');
      res.setHeader(
        'Content-Disposition',
        attachment(`${safeBaseName}.${isPng ? 'png' : 'jpg'}`)
      );
      return res.send(imageBuffer);
    }

    // B) Export als Einzelseiten-PDF
    const singlePdf = await PDFDocument.create();
    if (pageMeta.sourceType === 'pdf') {
      const bytes = fs.readFileSync(pageMeta.sourceFilePath);
      const srcPdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const [copiedPage] = await singlePdf.copyPages(srcPdf, [pageMeta.originalPageIndex]);
      const currentRot = copiedPage.getRotation().angle;
      copiedPage.setRotation(degrees((currentRot + userRotation) % 360));
      singlePdf.addPage(copiedPage);
    } else {
      let sharpImg = sharp(pageMeta.sourceFilePath).rotate();
      if (userRotation !== 0) {
        sharpImg = sharpImg.rotate(userRotation);
      }
      const imgBuffer = await sharpImg.jpeg({ quality: 95 }).toBuffer();
      const embeddedImg = await singlePdf.embedJpg(imgBuffer);
      const { width, height } = embeddedImg.scale(1.0);
      const p = singlePdf.addPage([width, height]);
      p.drawImage(embeddedImg, { x: 0, y: 0, width, height });
    }

    const pdfBytes = await singlePdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      attachment(`${safeBaseName}.pdf`)
    );
    return res.send(Buffer.from(pdfBytes));
  } catch (err: any) {
    console.error('[Tools] Fehler beim Einzelseiten-Export:', err);
    res.status(500).json({ error: err?.message || 'Fehler beim Exportieren der Einzelseite.' });
  }
});


// -------------------------------------------------------------
// POST /api/tools/quick-compress
// Einzelnes PDF direkt komprimieren
// -------------------------------------------------------------
toolsRouter.post(
  '/tools/quick-compress',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Keine PDF-Datei übermittelt.' });

      const level = req.body.level || 'medium'; // light, medium, high
      let gsSetting = '/ebook';
      if (level === 'light') gsSetting = '/printer';
      if (level === 'high') gsSetting = '/screen';

      const originalSize = fs.statSync(file.path).size;
      const safeName = sanitizeTitle(path.parse(file.originalname).name);
      const outPath = path.join(paths.tmpDir, `comp_${Date.now()}_${safeName}.pdf`);

      await execFileAsync(
        'gs',
        [
          '-sDEVICE=pdfwrite',
          '-dCompatibilityLevel=1.4',
          `-dPDFSETTINGS=${gsSetting}`,
          '-dNOPAUSE',
          '-dQUIET',
          '-dBATCH',
          `-sOutputFile=${outPath}`,
          file.path,
        ],
        { timeout: 45000 }
      );

      let newSize = fs.existsSync(outPath) ? fs.statSync(outPath).size : originalSize;
      // Wird es nicht kleiner, das Original zurückgeben – und das auch so sagen
      const improved = newSize < originalSize;
      if (!improved) {
        fs.copyFileSync(file.path, outPath);
        newSize = originalSize;
      }
      try {
        fs.unlinkSync(file.path);
      } catch {}
      const downloadPath = `/api/tools/download-tmp/${path.basename(outPath)}?name=${encodeURIComponent(safeName)}_komprimiert.pdf`;

      res.json({
        success: true,
        improved,
        originalSize,
        newSize,
        savedPercent: Math.max(0, Math.round(((originalSize - newSize) / originalSize) * 100)),
        downloadUrl: downloadPath,
        tmpFile: path.basename(outPath),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Fehler beim Komprimieren.' });
    }
  }
);

// -------------------------------------------------------------
// POST /api/tools/extract-text
// Text via Ghostscript extrahieren (OCR / txtwrite)
// -------------------------------------------------------------
toolsRouter.post(
  '/tools/extract-text',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Keine Datei übermittelt.' });

      const ext = path.extname(fixOriginalName(file.originalname)).toLowerCase();
      let extractedText = '';
      let method = '';
      const cleanup: string[] = [file.path];
      try {
        if (ext === '.pdf') {
          // 1. Vorhandene Textebene (pdfminer: Umlaute auch bei eingebetteten Schriften korrekt)
          const pageCount = (await PDFDocument.load(fs.readFileSync(file.path), { ignoreEncryption: true })).getPageCount();
          extractedText = (await extractPdfText(file.path, 1, pageCount)).trim();
          method = 'Textebene';
          // 2. Keine Textebene (eingescannt): echte OCR mit ocrmypdf; bringt sie nichts, bleibt die Textebene
          const layerText = extractedText;
          if (!layerText.replace(/\s/g, '')) {
            const sidecar = `${file.path}.txt`;
            const ocrOut = `${file.path}.ocr.pdf`;
            cleanup.push(sidecar, ocrOut);
            await execFileAsync('ocrmypdf', ['--skip-text', '-l', 'deu', '--sidecar', sidecar, file.path, ocrOut], {
              timeout: 300000,
              maxBuffer: 20 * 1024 * 1024,
            });
            extractedText = fs.existsSync(sidecar)
              ? fs.readFileSync(sidecar, 'utf8').replace(/\[OCR skipped on page\(s\) [^\]]*\]/g, '').replace(/\f/g, '\n\n').trim()
              : '';
            method = 'Texterkennung (OCR)';
            if (!extractedText) {
              extractedText = layerText;
              method = 'Textebene';
            }
          }
        } else if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp', '.heic', '.heif'].includes(ext)) {
          let imagePath = file.path;
          if (ext === '.heic' || ext === '.heif') {
            imagePath = `${file.path}.jpg`;
            cleanup.push(imagePath);
            await execFileAsync('heif-convert', ['-q', '92', file.path, imagePath], { timeout: 120000 });
          }
          // Nur Deutsch: mit deu+eng gehen Umlaute verloren (siehe ocr.ts)
          const { stdout } = await execFileAsync('tesseract', [imagePath, 'stdout', '-l', 'deu'], {
            timeout: 120000,
            maxBuffer: 20 * 1024 * 1024,
          });
          extractedText = stdout.trim();
          method = 'Texterkennung (OCR)';
        } else {
          return res.status(400).json({ error: `Dateityp "${ext || '(keine Endung)'}" wird nicht unterstützt (PDF oder Bild).` });
        }
      } finally {
        for (const f of cleanup) {
          try {
            if (fs.existsSync(f)) fs.unlinkSync(f);
          } catch {}
        }
      }

      res.json({
        success: true,
        text: extractedText,
        characterCount: extractedText.length,
        method,
        fileName: fixOriginalName(file.originalname),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Fehler bei der Textextraktion.' });
    }
  }
);

// -------------------------------------------------------------
// GET /api/tools/download-tmp/:filename
// Download von temporären Ergebnisdateien
// -------------------------------------------------------------
toolsRouter.get('/tools/download-tmp/:filename', (req: Request, res: Response) => {
  const { filename } = req.params;
  const filePath = safeJoin(paths.tmpDir, filename);
  const downloadName = (req.query.name as string) || filename;

  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachment(downloadName));
    return fs.createReadStream(filePath).pipe(res);
  }
  res.status(404).json({ error: 'Datei nicht gefunden oder abgelaufen.' });
});
