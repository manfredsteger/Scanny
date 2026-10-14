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
// POST /api/tools/prepare-session
// Ganzen Ordner oder beliebige Dateien hochladen & Seiten extrahieren
// -------------------------------------------------------------
toolsRouter.post(
  '/tools/prepare-session',
  upload.array('files', 200),
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'Keine Dateien hochgeladen.' });
      }

      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sessionPath = path.join(toolsSessionsDir, sessionId);
      fs.mkdirSync(sessionPath, { recursive: true });

      const allPages: SessionPageMeta[] = [];
      let globalDisplayNum = 1;

      for (let fIdx = 0; fIdx < files.length; fIdx++) {
        const file = files[fIdx];
        const fixedName = fixOriginalName(file.originalname);
        const ext = path.extname(fixedName).toLowerCase() || path.extname(file.originalname).toLowerCase();
        const stat = fs.existsSync(file.path) ? fs.statSync(file.path) : null;
        const fileSize = stat ? stat.size : 0;

        // 1. PDF-Dateien
        if (ext === '.pdf') {
          try {
            const pdfBytes = fs.readFileSync(file.path);
            const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
            const pageCount = pdfDoc.getPageCount();

            for (let p = 0; p < pageCount; p++) {
              const page = pdfDoc.getPage(p);
              const { width, height } = page.getSize();
              const pageKey = `p_${fIdx}_${p}`;
              const thumbFilename = `${pageKey}.jpg`;
              const thumbPath = path.join(sessionPath, thumbFilename);

              // Thumbnail via Ghostscript rendern (DPI 100 für scharfe, schnelle Vorschau)
              try {
                await execFileAsync(
                  'gs',
                  [
                    '-q',
                    '-dNOPAUSE',
                    '-dBATCH',
                    '-sDEVICE=jpeg',
                    '-dJPEGQ=85',
                    '-r100',
                    `-dFirstPage=${p + 1}`,
                    `-dLastPage=${p + 1}`,
                    `-sOutputFile=${thumbPath}`,
                    file.path,
                  ],
                  { timeout: 30000 }
                );
              } catch (gsErr) {
                // Fallback: Generiere SVG-Vorschaubild wenn GS fehlschlägt
                const svg = `<svg width="400" height="560" xmlns="http://www.w3.org/2000/svg">
                  <rect width="100%" height="100%" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
                  <text x="50%" y="45%" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#ef4444" font-weight="bold">PDF</text>
                  <text x="50%" y="55%" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#64748b">Seite ${p + 1}</text>
                </svg>`;
                await sharp(Buffer.from(svg)).jpeg().toFile(thumbPath);
              }

              allPages.push({
                id: `${sessionId}_${pageKey}`,
                sourceFileName: fixedName,
                sourceType: 'pdf',
                originalPageIndex: p,
                displayNumber: globalDisplayNum++,
                rotation: 0,
                thumbnailUrl: `/api/tools/thumb/${sessionId}/${thumbFilename}`,
                width: Math.round(width),
                height: Math.round(height),
                sessionId,
                pageKey,
                sourceFilePath: file.path,
                fileSize,
              });
            }
          } catch (pdfErr) {
            console.error(`[Tools] Fehler beim Parsen von PDF ${fixedName}:`, pdfErr);
          }
        }
        // 2. Bildformate (JPG, PNG, WEBP, TIFF, HEIC, GIF, SVG)
        else if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tiff', '.tif', '.bmp', '.gif', '.svg'].includes(ext)) {
          try {
            const pageKey = `p_${fIdx}_0`;
            const thumbFilename = `${pageKey}.jpg`;
            const thumbPath = path.join(sessionPath, thumbFilename);

            const imgMeta = await sharp(file.path).metadata();
            const w = imgMeta.width || 800;
            const h = imgMeta.height || 1100;

            // Thumbnail auf max 700px skalieren
            await sharp(file.path)
              .rotate() // Automatische EXIF-Drehung
              .resize({ width: 700, height: 900, fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toFile(thumbPath);

            allPages.push({
              id: `${sessionId}_${pageKey}`,
              sourceFileName: fixedName,
              sourceType: 'image',
              originalPageIndex: 0,
              displayNumber: globalDisplayNum++,
              rotation: 0,
              thumbnailUrl: `/api/tools/thumb/${sessionId}/${thumbFilename}`,
              width: w,
              height: h,
              sessionId,
              pageKey,
              sourceFilePath: file.path,
              fileSize,
            });
          } catch (imgErr) {
            console.error(`[Tools] Fehler beim Verarbeiten von Bild ${fixedName}:`, imgErr);
          }
        }
        // 3. Text / Markdown / CSV / Office Dokumente
        else {
          try {
            let textPreview = '';
            if (['.txt', '.md', '.csv', '.json', '.log', '.xml', '.html'].includes(ext)) {
              const raw = fs.readFileSync(file.path, 'utf8');
              textPreview = raw.slice(0, 1000);
            } else {
              textPreview = `${fixedName}\n(${ext.toUpperCase().replace('.', '')}-Datei)`;
            }

            const pageKey = `p_${fIdx}_0`;
            const thumbFilename = `${pageKey}.jpg`;
            const thumbPath = path.join(sessionPath, thumbFilename);

            // Stilisierte Kartenvorschau für Text/Dokumente generieren
            const safePreview = textPreview
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .split('\n')
              .slice(0, 18)
              .map((line, idx) => `<tspan x="30" y="${90 + idx * 24}">${line.slice(0, 48)}</tspan>`)
              .join('');

            const svg = `<svg width="500" height="700" xmlns="http://www.w3.org/2000/svg">
              <rect width="100%" height="100%" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2" rx="8"/>
              <rect x="20" y="20" width="460" height="42" fill="#e2e8f0" rx="6"/>
              <text x="35" y="47" font-family="monospace" font-size="16" font-weight="bold" fill="#334155">${fixedName.slice(0, 35)}</text>
              <text font-family="monospace" font-size="13" fill="#475569">
                ${safePreview}
              </text>
            </svg>`;

            await sharp(Buffer.from(svg)).jpeg().toFile(thumbPath);

            allPages.push({
              id: `${sessionId}_${pageKey}`,
              sourceFileName: fixedName,
              sourceType: 'text',
              originalPageIndex: 0,
              displayNumber: globalDisplayNum++,
              rotation: 0,
              thumbnailUrl: `/api/tools/thumb/${sessionId}/${thumbFilename}`,
              width: 500,
              height: 700,
              sessionId,
              pageKey,
              sourceFilePath: file.path,
              textSnippet: textPreview,
              fileSize,
            });
          } catch (docErr) {
            console.error(`[Tools] Fehler bei Text/Doc ${fixedName}:`, docErr);
          }
        }
      }

      // Session-Metadaten speichern
      fs.writeFileSync(
        path.join(sessionPath, 'manifest.json'),
        JSON.stringify({ sessionId, pages: allPages, createdAt: new Date().toISOString() })
      );

      res.json({
        sessionId,
        pages: allPages,
        fileCount: files.length,
        totalPages: allPages.length,
      });
    } catch (err: any) {
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
  const filePath = path.join(toolsSessionsDir, sessionId, filename);

  if (fs.existsSync(filePath)) {
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

    const sessionPath = path.join(toolsSessionsDir, sessionId);
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
      // 3. Quellseite ist Text
      else {
        const a4Width = 595.28;
        const a4Height = 841.89;
        const newPage = finalPdf.addPage([a4Width, a4Height]);
        const textContent = pageMeta.textSnippet || pageMeta.sourceFileName;
        const lines = textContent.split('\n').slice(0, 45);

        newPage.drawText(pageMeta.sourceFileName, {
          x: 40,
          y: a4Height - 50,
          size: 14,
          font: helveticaFont,
          color: rgb(0.1, 0.1, 0.1),
        });

        lines.forEach((line: string, lIdx: number) => {
          newPage.drawText(line.slice(0, 80), {
            x: 40,
            y: a4Height - 80 - lIdx * 15,
            size: 10,
            font: helveticaFont,
            color: rgb(0.2, 0.2, 0.2),
          });
        });
      }
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
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}_Seiten.zip"`);

      const archive = new ZipArchive({ zlib: { level: 8 } });
      archive.pipe(res);

      // Jede Seite mit GS als Bild rendern
      const tempImgDir = path.join(paths.tmpDir, `zip_${Date.now()}`);
      fs.mkdirSync(tempImgDir, { recursive: true });

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
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.pdf"`);
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

    const sessionPath = path.join(toolsSessionsDir, sessionId);
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
        `attachment; filename="${encodeURIComponent(safeBaseName)}.${isPng ? 'png' : 'jpg'}"`
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
      `attachment; filename="${encodeURIComponent(safeBaseName)}.pdf"`
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

      const newSize = fs.existsSync(outPath) ? fs.statSync(outPath).size : originalSize;
      const downloadPath = `/api/tools/download-tmp/${path.basename(outPath)}?name=${encodeURIComponent(safeName)}_komprimiert.pdf`;

      res.json({
        success: true,
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

      const ext = path.extname(file.originalname).toLowerCase();
      let extractedText = '';

      if (ext === '.pdf') {
        const { stdout } = await execFileAsync(
          'gs',
          ['-q', '-sDEVICE=txtwrite', '-o', '-', file.path],
          { timeout: 60000, maxBuffer: 30 * 1024 * 1024 }
        );
        extractedText = stdout;
      } else {
        // Bei reinem Bild Text via OCR / tesseract
        try {
          const { stdout } = await execFileAsync(
            'tesseract',
            [file.path, 'stdout', '-l', 'deu+eng'],
            { timeout: 60000 }
          );
          extractedText = stdout;
        } catch {
          extractedText = 'Kein OCR-Text erkannt oder Tesseract nicht installiert.';
        }
      }

      res.json({
        success: true,
        text: extractedText.trim(),
        characterCount: extractedText.length,
        fileName: file.originalname,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Fehler bei der Textextraktion.' });
    }
  }
);

// -------------------------------------------------------------
// POST /api/tools/redact
// PDF zensieren: Ausgewählte Bereiche unwiderruflich schwärzen
// -------------------------------------------------------------
toolsRouter.post(
  '/tools/redact',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Keine PDF-Datei übermittelt.' });

      const boxesRaw = req.body.boxes;
      const boxes: Array<{ page: number; x: number; y: number; width: number; height: number }> =
        typeof boxesRaw === 'string' ? JSON.parse(boxesRaw) : boxesRaw || [];

      const pdfBytes = fs.readFileSync(file.path);
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

      // Schwarze Rechtecke auf die Seiten einbrennen
      for (const box of boxes) {
        if (box.page >= 0 && box.page < pdfDoc.getPageCount()) {
          const page = pdfDoc.getPage(box.page);
          const { height } = page.getSize();
          // Umrechnen von Top-Left (Browser-Canvas) zu PDF Bottom-Left Koordinaten
          const pdfY = height - box.y - box.height;

          page.drawRectangle({
            x: box.x,
            y: Math.max(0, pdfY),
            width: box.width,
            height: box.height,
            color: rgb(0, 0, 0),
            opacity: 1,
          });
        }
      }

      const redactedBytes = await pdfDoc.save();
      const safeName = sanitizeTitle(path.parse(file.originalname).name);
      const outPath = path.join(paths.tmpDir, `redacted_${Date.now()}_${safeName}.pdf`);
      fs.writeFileSync(outPath, redactedBytes);

      const downloadPath = `/api/tools/download-tmp/${path.basename(outPath)}?name=${encodeURIComponent(safeName)}_zensiert.pdf`;
      res.json({
        success: true,
        downloadUrl: downloadPath,
        tmpFile: path.basename(outPath),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Fehler beim Zensieren der PDF.' });
    }
  }
);

// -------------------------------------------------------------
// GET /api/tools/download-tmp/:filename
// Download von temporären Ergebnisdateien
// -------------------------------------------------------------
toolsRouter.get('/tools/download-tmp/:filename', (req: Request, res: Response) => {
  const { filename } = req.params;
  const filePath = path.join(paths.tmpDir, filename);
  const downloadName = (req.query.name as string) || filename;

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
    return fs.createReadStream(filePath).pipe(res);
  }
  res.status(404).json({ error: 'Datei nicht gefunden oder abgelaufen.' });
});
