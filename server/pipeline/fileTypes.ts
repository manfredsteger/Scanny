import path from 'node:path';

/** Bild-Endungen: werden mit scan.py aufbereitet und per OCR erkannt. */
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif']);
/** Textdateien: werden zu einem PDF gesetzt, der Quelltext bleibt bearbeitbar. */
export const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);
/** Alles, was Scanny annimmt (Upload-Ordner UND Web-Upload). */
export const ALLOWED_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, '.pdf', ...TEXT_EXTENSIONS]);

/** Größere Textdateien sind keine Belege mehr – das PDF würde hunderte Seiten lang. */
export const MAX_TEXT_BYTES = 1024 * 1024;

export type DocumentKind = 'image' | 'pdf' | 'text';

export function kindForName(name: string): DocumentKind {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'image';
}

export function isMarkdownName(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return ext === '.md' || ext === '.markdown';
}

/**
 * Textdatei-Bytes nach UTF-8 dekodieren: BOM (UTF-8/UTF-16) → striktes UTF-8 → Windows-1252
 * (ältere Windows-Textdateien). Zeilenenden werden auf \n vereinheitlicht.
 */
export function decodeText(bytes: Buffer): { text: string; encoding: string } {
  let text: string;
  let encoding: string;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    text = new TextDecoder('utf-8').decode(bytes.subarray(3));
    encoding = 'utf-8';
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    encoding = 'utf-16le';
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
    encoding = 'utf-16be';
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      encoding = 'utf-8';
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes);
      encoding = 'windows-1252';
    }
  }
  return { text: text.replace(/\r\n?/g, '\n'), encoding };
}

/**
 * Titel aus einer Textdatei: erste Markdown-Überschrift, sonst erste nicht-leere Zeile
 * (ohne Markdown-Zeichen), höchstens 80 Zeichen. null, wenn nichts Brauchbares drinsteht.
 */
export function titleFromText(text: string, markdown: boolean): string | null {
  const lines = text.split('\n').map((l) => l.trim());
  let candidate: string | undefined;
  if (markdown) {
    candidate = lines.find((l) => /^#{1,6}\s+\S/.test(l));
    // Setext-Überschrift: Zeile, gefolgt von === oder ---
    if (!candidate) {
      const idx = lines.findIndex((l, i) => l && /^(=+|-+)$/.test(lines[i + 1] || ''));
      if (idx >= 0) candidate = lines[idx];
    }
  }
  if (!candidate) candidate = lines.find((l) => l.length > 0 && !/^(-{3,}|\*{3,}|_{3,}|```.*)$/.test(l));
  if (!candidate) return null;
  const clean = candidate
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '')
    .replace(/^>\s*/, '')
    .replace(/[*_`~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  return clean.length > 80 ? clean.slice(0, 80).replace(/\s+\S*$/, '').trim() : clean;
}
