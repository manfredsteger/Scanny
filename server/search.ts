/**
 * FTS5-Suchausdruck aus einer Nutzereingabe bauen: jedes Wort als Phrase mit Präfixsuche
 * ("wort"*), damit Sonderzeichen wie - : ( ) und Operatoren wie AND/OR keinen Syntaxfehler auslösen.
 */
export function buildFtsQuery(input: string): string {
  return (
    input
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/"/g, ''))
      .filter(Boolean)
      .map((w) => `"${w}"*`)
      .join(' ') || '""'
  );
}

/** Markierungen für snippet(): Steuerzeichen, damit das Frontend ohne HTML-Parsing markieren kann. */
export const SNIPPET_START = '\u0001';
export const SNIPPET_END = '\u0002';
