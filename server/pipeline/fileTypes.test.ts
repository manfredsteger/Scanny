import { describe, it, expect } from 'vitest';
import { ALLOWED_EXTENSIONS, decodeText, kindForName, looksLikeMarkdown, textRenderMode, titleFromText } from './fileTypes';

describe('decodeText', () => {
  it('liest UTF-8 mit Umlauten', () => {
    expect(decodeText(Buffer.from('Grüße aus München – „gut“', 'utf8'))).toEqual({
      text: 'Grüße aus München – „gut“',
      encoding: 'utf-8',
    });
  });

  it('entfernt die UTF-8-BOM', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Äpfel', 'utf8')]);
    expect(decodeText(bytes).text).toBe('Äpfel');
  });

  it('fällt bei ungültigem UTF-8 auf Windows-1252 zurück (alte Windows-Textdateien)', () => {
    // "Größe 5 €" in Windows-1252: ö = F6, ß = DF, € = 80
    const bytes = Buffer.from([0x47, 0x72, 0xf6, 0xdf, 0x65, 0x20, 0x35, 0x20, 0x80]);
    expect(decodeText(bytes)).toEqual({ text: 'Größe 5 €', encoding: 'windows-1252' });
  });

  it('liest UTF-16 mit BOM', () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Übersicht', 'utf16le')]);
    expect(decodeText(bytes)).toEqual({ text: 'Übersicht', encoding: 'utf-16le' });
  });

  it('vereinheitlicht Zeilenenden', () => {
    expect(decodeText(Buffer.from('a\r\nb\rc\n', 'utf8')).text).toBe('a\nb\nc\n');
  });
});

describe('titleFromText', () => {
  it('nimmt bei Markdown die erste Überschrift, nicht die erste Zeile', () => {
    expect(titleFromText('Stand: 14.10.\n\n## Einkaufsliste **Gilde**\n\n# Später', true)).toBe('Einkaufsliste Gilde');
  });

  it('erkennt Setext-Überschriften', () => {
    expect(titleFromText('Rechnung März\n=============\n\nText', true)).toBe('Rechnung März');
  });

  it('nimmt bei Text die erste nicht-leere Zeile ohne Markdown-Zeichen', () => {
    expect(titleFromText('\n\n- [x] Laminierfolien [kaufen](https://x.de)\nmehr', false)).toBe('Laminierfolien kaufen');
  });

  it('kürzt lange Titel an einer Wortgrenze', () => {
    const title = titleFromText('Wort '.repeat(40), false)!;
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('Wort')).toBe(true);
  });

  it('liefert null bei leerer Datei', () => {
    expect(titleFromText('\n \n---\n', true)).toBeNull();
  });
});

describe('Dateitypen', () => {
  it('nimmt Textdateien an und ordnet die Art zu', () => {
    for (const ext of ['.txt', '.md', '.markdown', '.pdf', '.heic']) expect(ALLOWED_EXTENSIONS.has(ext)).toBe(true);
    expect(ALLOWED_EXTENSIONS.has('.docx')).toBe(false);
    expect(kindForName('Liste.MD')).toBe('text');
    expect(kindForName('scan.pdf')).toBe('pdf');
    expect(kindForName('IMG_1.HEIC')).toBe('image');
  });
});

describe('Markdown in Textdateien erkennen', () => {
  it('erkennt eine .txt im Markdown-Stil (Überschriften + eingerückte Zeilen)', () => {
    const text = '# Vereinsfest – Druckanleitung\nSamstag, 3. Mai\n\n## 00 Spickzettel\nAblauf.pdf - 2 Seiten\n  Druck: A4 hoch\n\n## 01 Einladungen\nEinladung.pdf - 8 Seiten\n';
    expect(looksLikeMarkdown(text)).toBe(true);
    expect(textRenderMode('ANLEITUNG.txt', text)).toBe('md-txt');
  });

  it('erkennt Liste + Fettdruck', () => {
    expect(looksLikeMarkdown('Einkauf\n\n- Papier\n- Kleber\n\n**Wichtig:** bis Freitag')).toBe(true);
  });

  it('hält normale Notizen NICHT für Markdown', () => {
    expect(looksLikeMarkdown('Anruf bei Müller - Rückruf morgen\nTermin 14:00 Uhr\n')).toBe(false);
    expect(looksLikeMarkdown('Kontostand: 1.234,56 €\n* nur ein Sternchen\n')).toBe(false);
    expect(looksLikeMarkdown('# einzelne Raute als Kommentar\nwert=3\n')).toBe(false);
    expect(textRenderMode('notiz.txt', 'Hallo Welt')).toBe('txt');
  });

  it('setzt .md immer als Markdown', () => {
    expect(textRenderMode('liste.md', 'nur Text')).toBe('md');
  });
});
