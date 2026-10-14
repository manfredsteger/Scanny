import fs from 'node:fs';
import path from 'node:path';
import { paths } from './db.js';

/**
 * Server-Ausgaben zusätzlich in System/Logs/scanny-YYYY-MM-DD.log schreiben.
 * `docker logs` geht bei jedem Neuaufbau des Containers verloren – die Datei bleibt (14 Tage).
 */
const KEEP_DAYS = 14;
const logDir = path.join(paths.dataDir, 'Logs');

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function format(args: unknown[]): string {
  return args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
}

export function startFileLogging(): void {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(logDir)) {
      const full = path.join(logDir, f);
      if (/^scanny-\d{4}-\d{2}-\d{2}\.log$/.test(f) && fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {
    return; // ohne Logdatei weiterlaufen
  }

  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        const line = `${new Date().toISOString()} ${level === 'log' ? 'INFO ' : level.toUpperCase().padEnd(5)} ${format(args)}\n`;
        fs.appendFileSync(path.join(logDir, `scanny-${today()}.log`), line);
      } catch {}
    };
  }
}
