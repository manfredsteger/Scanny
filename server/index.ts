import express from 'express';
import path from 'node:path';
import { ensureDirectories, getDb, paths } from './db.js';
import { healthRouter } from './routes/health.js';
import { foldersRouter } from './routes/folders.js';
import { settingsRouter } from './routes/settings.js';
import { documentsRouter } from './routes/documents.js';
import { exportRouter } from './routes/export.js';
import { initQueue } from './pipeline/queue.js';
import { startWatcher } from './pipeline/watcher.js';
import { startTrashCleanup } from './pipeline/trash.js';
import { SCAN_PY_PATH } from './pipeline/processDocument.js';
import fs from 'node:fs';

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProduction = process.env.NODE_ENV === 'production';

  // Verzeichnisse und Datenbank initialisieren
  ensureDirectories();
  getDb();

  // Warteschlange und Ordner-Überwachung initialisieren
  initQueue();
  startWatcher();
  startTrashCleanup();

  // JSON Body Parser für API-Anfragen
  app.use(express.json());

  // API-Routen registrieren
  app.use('/api', healthRouter);
  app.use('/api', foldersRouter);
  app.use('/api', settingsRouter);
  app.use('/api', documentsRouter);
  app.use('/api', exportRouter);

  // Unbekannte API-Pfade vor dem SPA-Fallback abfangen
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Unbekannter API-Pfad' });
  });

  // Fehler-Middleware: Für /api immer JSON ausliefern (400 bei Syntaxfehler/JSON, sonst 500)
  app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'Ungültiges JSON' });
    }
    console.error('[Scanny API Fehler]', err);
    return res.status(500).json({ error: err?.message || 'Interner Serverfehler' });
  });

  // Frontend-Auslieferung
  if (!isProduction) {
    // WICHTIG: Dynamischer Import von Vite, damit Vite in Produktion
    // nicht als Top-Level-Abhängigkeit geladen werden muss!
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Scanny] Server läuft auf Port ${PORT} (Modus: ${isProduction ? 'Produktion' : 'Entwicklung'})`);
    console.log(`[Scanny] Basisverzeichnisse:`);
    console.log(`         DATA_DIR:   ${paths.dataDir}`);
    console.log(`         SCANNY_DIR: ${paths.scannyDir}`);
    console.log(`         Upload:     ${paths.watchDir}`);
    console.log(`         Archiv:     ${paths.archiveDir}`);
    if (fs.existsSync(SCAN_PY_PATH)) {
      console.log(`[Scanny] Pipeline scan.py gefunden: ${SCAN_PY_PATH}`);
    } else {
      console.warn(`[Scanny] WARNUNG: Pipeline scan.py NICHT gefunden unter: ${SCAN_PY_PATH}`);
    }
  });
}

startServer().catch((err) => {
  console.error('[Scanny] Schwerwiegender Fehler beim Starten des Servers:', err);
  process.exit(1);
});
