import { CLASSIFY_RULES, KeywordRule } from './classifyRules.js';

/**
 * Punktbasierte Dokumenttyp-Erkennung aus dem OCR-Text (rein lokal, regelbasiert).
 * Stichwörter und Gewichte stehen in classifyRules.ts.
 */

export interface ClassifyOptions {
  /** Wurde ein Betrag erkannt? (Bonus für Rechnung) */
  hasAmount?: boolean;
  /** scan.py-Layout: "fit" = schmaler Beleg (Bonus für Quittung) */
  layout?: string | null;
}

export interface ClassifyResult {
  type: string;
  confidence: number;
  /** Bester Kandidat, falls er nicht selbst gewählt wurde bzw. zweitbester Typ */
  runnerUp: string | null;
  /** true, wenn wegen zu geringer Sicherheit auf "sonstiges" ausgewichen wurde */
  fallback: boolean;
  scores: Record<string, number>;
}

/** Unterhalb dieser Sicherheit wird "sonstiges" vorgeschlagen. */
export const MIN_CONFIDENCE = 0.4;
/** Ab dieser Sicherheit gilt die Erkennung als "sicher". */
export const SURE_CONFIDENCE = 0.7;

const FUZZY_CHARS: Record<string, string> = {
  g: '[gq9]',
  q: '[qg]',
  l: '[l1I|]',
  i: '[i1l|!]',
  o: '[o0]',
  ü: '(?:ü|u|ii|ue)',
  ä: '(?:ä|a|ae)',
  ö: '(?:ö|o|oe)',
  ß: '(?:ß|ss|B)',
  m: '(?:m|rn)',
};

/** Baut aus einem Stichwort einen OCR-toleranten regulären Ausdruck. */
export function fuzzyPattern(word: string, whole = false): RegExp {
  let src = '';
  for (const ch of word.toLowerCase()) {
    if (ch === ' ' || ch === '-') {
      src += '[\\s\\-.]*';
    } else if (ch === '.') {
      src += '\\.?';
    } else if (FUZZY_CHARS[ch]) {
      src += FUZZY_CHARS[ch];
    } else {
      src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (whole) {
    src = `(?<![\\p{L}\\d])${src}(?![\\p{L}\\d])`;
  }
  return new RegExp(src, 'iu');
}

const patternCache = new Map<KeywordRule, RegExp>();
function patternFor(rule: KeywordRule): RegExp {
  let re = patternCache.get(rule);
  if (!re) {
    re = fuzzyPattern(rule.word, rule.whole);
    patternCache.set(rule, re);
  }
  return re;
}

export function scoreTypes(text: string, opts: ClassifyOptions = {}): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [type, rule] of Object.entries(CLASSIFY_RULES)) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (patternFor(kw).test(text)) score += kw.weight;
    }
    if (score > 0 && opts.hasAmount && rule.amountBonus) score += rule.amountBonus;
    if (opts.layout === 'fit' && rule.narrowBonus) score += rule.narrowBonus;
    scores[type] = score;
  }
  return scores;
}

export function classify(text: string | null | undefined, opts: ClassifyOptions = {}): ClassifyResult {
  const scores = scoreTypes(text || '', opts);
  const ranked = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return { type: 'sonstiges', confidence: 0, runnerUp: null, fallback: true, scores };
  }

  const [bestType, top] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  // Absolute Stärke (mehr Punkte = sicherer) × Abstand zum Zweitplatzierten
  const absolute = 1 - Math.exp(-top / 4);
  const margin = (top - second) / top;
  const confidence = Math.round(absolute * (0.5 + 0.5 * margin) * 100) / 100;

  if (confidence < MIN_CONFIDENCE) {
    return { type: 'sonstiges', confidence, runnerUp: bestType, fallback: true, scores };
  }
  return {
    type: bestType,
    confidence,
    runnerUp: ranked[1]?.[0] ?? null,
    fallback: false,
    scores,
  };
}
