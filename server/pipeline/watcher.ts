import chokidar from 'chokidar';
import path from 'node:path';
import fs from 'node:fs';
import { paths } from '../db.js';
import { ingestFile } from './ingest.js';

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.pdf']);
const loggedIgnoredFiles = new Set<string>();
const activeIngestFiles = new Set<string>();

export function startWatcher(): ReturnType<typeof chokidar.watch> {
  const watchDir = paths.watchDir;

  if (!fs.existsSync(watchDir)) {
    fs.mkdirSync(watchDir, { recursive: true });
  }

  const usePolling = process.env.WATCH_POLLING === 'true';

  const watcher = chokidar.watch(watchDir, {
    depth: 0,
    ignoreInitial: false,
    usePolling,
    interval: 2000,
    binaryInterval: 2000,
    awaitWriteFinish: {
      stabilityThreshold: 3000,
      pollInterval: 500,
    },
    ignored: (filePath: string, stats?: fs.Stats) => {
      const base = path.basename(filePath);

      // Watch-Verzeichnis selbst nicht ignorieren
      if (filePath === watchDir) {
        return false;
      }

      // Unterordner ignorieren
      if (stats?.isDirectory()) {
        return true;
      }

      // Systemdateien (z. B. .DS_Store, ._*) ignorieren
      if (base.startsWith('.')) {
        return true;
      }

      // Temporäre Download-Dateien ignorieren
      if (/\.(tmp|part|download|crdownload)$/i.test(base)) {
        return true;
      }

      return false;
    },
  });

  watcher.on('add', async (filePath: string) => {
    try {
      if (filePath === watchDir) {
        return;
      }

      const base = path.basename(filePath);
      if (base.startsWith('.')) {
        return;
      }

      // Wenn die Datei bereits im Ingest ist, nicht noch einmal anstoßen
      if (activeIngestFiles.has(filePath)) {
        return;
      }

      // Prüfen, ob die Datei noch existiert
      if (!fs.existsSync(filePath)) {
        return;
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        if (!loggedIgnoredFiles.has(filePath)) {
          loggedIgnoredFiles.add(filePath);
          console.log(`[Watcher] Ignoriere Datei mit nicht unterstützter Endung: "${base}"`);
        }
        return;
      }

      activeIngestFiles.add(filePath);
      console.log(`[Watcher] Neue Beleg-Datei im Upload-Ordner erkannt: "${base}"`);

      await ingestFile({
        sourcePath: filePath,
        source: 'folder',
        originalName: base,
      });
    } catch (err) {
      console.error(`[Watcher] Fehler bei Beleg-Übernahme von "${filePath}":`, err);
    } finally {
      activeIngestFiles.delete(filePath);
    }
  });

  watcher.on('error', (err) => {
    console.error('[Watcher] Dateisystem-Überwachungsfehler:', err);
  });

  console.log(`[Watcher] Überwache Upload-Ordner: ${watchDir} (Polling: ${usePolling ? 'aktiv' : 'inaktiv'})`);
  return watcher;
}
