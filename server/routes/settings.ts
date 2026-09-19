import { Router, Request, Response } from 'express';
import path from 'node:path';
import { getDb, paths } from '../db.js';

export const settingsRouter = Router();

// GET /api/settings/paths -> Aktive Verzeichnisse zur Anzeige im Frontend
settingsRouter.get('/settings/paths', (req: Request, res: Response) => {
  const scannyHostPath = process.env.SCANNY_HOST_PATH?.trim();

  // Wenn SCANNY_HOST_PATH gesetzt ist (Docker), die Host-Pfade berechnen, sonst Fallback auf lokale Pfade
  const hostScannyDir = scannyHostPath || paths.scannyDir;
  const hostWatchDir = scannyHostPath
    ? `${scannyHostPath.replace(/\/+$/, '')}/Upload`
    : paths.watchDir;
  const hostArchiveDir = scannyHostPath
    ? `${scannyHostPath.replace(/\/+$/, '')}/Archiv`
    : paths.archiveDir;

  res.json({
    dataDir: paths.dataDir,
    scannyDir: paths.scannyDir,
    watchDir: paths.watchDir,
    archiveDir: paths.archiveDir,
    dbPath: paths.dbPath,
    hostScannyDir,
    hostWatchDir,
    hostArchiveDir,
  });
});

// GET /api/settings -> Alle App-Einstellungen abrufen (inkl. default_color_mode)
settingsRouter.get('/settings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const settingsMap: Record<string, string> = {
      default_color_mode: 'bw',
    };
    for (const row of rows) {
      settingsMap[row.key] = row.value;
    }
    res.json(settingsMap);
  } catch (error: any) {
    console.error('Fehler beim Laden der Einstellungen:', error);
    res.status(500).json({ error: 'Einstellungen konnten nicht geladen werden.' });
  }
});

// PATCH /api/settings -> Einstellungen aktualisieren
settingsRouter.patch('/settings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { default_color_mode } = req.body;

    if (default_color_mode !== undefined) {
      if (!['bw', 'gray', 'color'].includes(default_color_mode)) {
        return res.status(400).json({ error: 'Ungültiger Farbmodus. Erlaubt sind: bw, gray, color.' });
      }
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('default_color_mode', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(default_color_mode);
    }

    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const settingsMap: Record<string, string> = {
      default_color_mode: 'bw',
    };
    for (const row of rows) {
      settingsMap[row.key] = row.value;
    }
    res.json(settingsMap);
  } catch (error: any) {
    console.error('Fehler beim Speichern der Einstellungen:', error);
    res.status(500).json({ error: 'Einstellungen konnten nicht gespeichert werden.' });
  }
});

// GET /api/inbox/count -> Anzahl der Belege im Eingang
settingsRouter.get('/inbox/count', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) as count FROM documents WHERE status = 'inbox'")
      .get() as { count: number };
    res.json({ count: row?.count || 0 });
  } catch (error) {
    res.json({ count: 0 });
  }
});
