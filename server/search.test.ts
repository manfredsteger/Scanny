import { describe, it, expect } from 'vitest';
import { buildFtsQuery } from './search.js';

describe('buildFtsQuery', () => {
  it('quotet jedes Wort als Präfix-Phrase', () => {
    expect(buildFtsQuery('Stadtwerke 4711')).toBe('"Stadtwerke"* "4711"*');
  });

  it('entschärft Sonderzeichen und Operatoren', () => {
    expect(buildFtsQuery('Müller-Lüdenscheid')).toBe('"Müller-Lüdenscheid"*');
    expect(buildFtsQuery('a:b (x AND "y"')).toBe('"a:b"* "(x"* "AND"* "y"*');
  });

  it('liefert für leere Eingaben einen gültigen Ausdruck', () => {
    expect(buildFtsQuery('   ')).toBe('""');
    expect(buildFtsQuery('"')).toBe('""');
  });
});
