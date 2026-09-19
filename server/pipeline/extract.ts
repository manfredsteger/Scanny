import { classify, ClassifyResult } from './classify.js';
import { buildTitle } from './title.js';

/**
 * Regelbasierte Metadaten-Erkennung aus dem OCR-Text (rein lokal).
 * Zu jedem Wert wird die Fundstelle im Text (span = [start, end]) mitgeliefert,
 * damit die UI sie im Tab "Text" hervorheben kann.
 */

export type Span = [number, number];

export interface ExtractResult {
  date: string | null;
  dateSpan: Span | null;
  dateConfidence: number;
  amountCents: number | null;
  amountSpan: Span | null;
  amountConfidence: number;
  sender: string | null;
  senderSpan: Span | null;
  senderConfidence: number;
  title: string | null;
  confidence: number;
}

export interface Detection extends ExtractResult {
  type: string;
  typeConfidence: number;
  typeRunnerUp: string | null;
  typeFallback: boolean;
  layout: string | null;
}

interface Line {
  text: string;
  start: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  for (const raw of text.split('\n')) {
    lines.push({ text: raw, start: pos });
    pos += raw.length + 1;
  }
  return lines;
}

function lineIndexAt(lines: Line[], offset: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Datum
// ---------------------------------------------------------------------------

const MONTH_NAMES_RE =
  'Jan(?:uar|\\.)?|Feb(?:ruar|\\.)?|M(?:ä|ae|a)rz|Mrz\\.?|Apr(?:il|\\.)?|Mai|Jun(?:i|\\.)?|Jul(?:i|\\.)?|Aug(?:ust|\\.)?|Sep(?:t(?:ember)?)?\\.?|Okt(?:ober|\\.)?|Nov(?:ember|\\.)?|Dez(?:ember|\\.)?';

const MONTH_BY_PREFIX: Record<string, number> = {
  jan: 1, feb: 2, mär: 3, mae: 3, mar: 3, mrz: 3, apr: 4, mai: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12,
};

const DATE_PATTERNS: { re: RegExp; parse: (m: RegExpExecArray) => [number, number, number] | null }[] = [
  {
    // 15.03.2024, 15.03.24, 5. 3. 2024
    re: /(?<!\d)(\d{1,2}) ?\. ?(\d{1,2}) ?\. ?(\d{4}|\d{2})(?![\d])/g,
    parse: (m) => [expandYear(m[3]), parseInt(m[2], 10), parseInt(m[1], 10)],
  },
  {
    // 15. März 2024, 3. Sept. 2026
    re: new RegExp(`(?<!\\d)(\\d{1,2})\\.?\\s*(${MONTH_NAMES_RE})\\s*(\\d{4})(?!\\d)`, 'giu'),
    parse: (m) => {
      const key = m[2].toLowerCase().replace('.', '').slice(0, 3);
      const month = MONTH_BY_PREFIX[key];
      return month ? [parseInt(m[3], 10), month, parseInt(m[1], 10)] : null;
    },
  },
  {
    // 2024-03-15
    re: /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g,
    parse: (m) => [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)],
  },
];

function expandYear(y: string): number {
  if (y.length === 4) return parseInt(y, 10);
  const yy = parseInt(y, 10);
  const nowYY = new Date().getFullYear() % 100;
  return yy <= nowYY + 1 ? 2000 + yy : 1900 + yy;
}

function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isPlausibleDate(iso: string, now: Date): boolean {
  const max = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const maxIso = toIso(max.getFullYear(), max.getMonth() + 1, max.getDate())!;
  return iso >= '2000-01-01' && iso <= maxIso;
}

const DATE_POSITIVE_RE =
  /(?:rechnungs|beleg|ausstellungs|auszugs|bescheid|brief)?datum|(?<![\p{L}])vom(?![\p{L}])|(?<![\p{L}])den(?![\p{L}])/iu;
const DATE_NEGATIVE_RE =
  /f(?:ä|a)llig|zahlbar|geburt|geb\.|g(?:ü|u)ltig|liefer|leistung|zeitraum|(?<![\p{L}])bis(?![\p{L}])|valuta|buchung|kunde\s*seit|seit/iu;

interface DateCandidate {
  iso: string;
  span: Span;
  positive: boolean;
  negative: boolean;
}

export function findDates(text: string, now = new Date()): DateCandidate[] {
  const lines = splitLines(text);
  const found: DateCandidate[] = [];
  const taken: Span[] = [];

  for (const { re, parse } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      const parts = parse(m);
      if (!parts) continue;
      const iso = toIso(parts[0], parts[1], parts[2]);
      if (!iso || !isPlausibleDate(iso, now)) continue;
      taken.push([start, end]);

      // Kontext: Text davor in derselben Zeile; steht das Datum am Zeilenanfang,
      // auch die vorherige Zeile (Beschriftung über dem Wert)
      const li = lineIndexAt(lines, start);
      let before = text.slice(lines[li].start, start);
      if (before.trim() === '' && li > 0) before = lines[li - 1].text;
      const near = before.slice(-40);
      const negative = DATE_NEGATIVE_RE.test(near.slice(-30));
      const positive = !negative && DATE_POSITIVE_RE.test(near);
      found.push({ iso, span: [start, end], positive, negative });
    }
  }
  return found.sort((a, b) => a.span[0] - b.span[0]);
}

export function extractDate(
  text: string,
  now = new Date()
): { date: string | null; span: Span | null; confidence: number } {
  const candidates = findDates(text, now);
  if (candidates.length === 0) return { date: null, span: null, confidence: 0 };

  const positive = candidates.find((c) => c.positive);
  if (positive) return { date: positive.iso, span: positive.span, confidence: 0.9 };

  // Nicht das früheste Datum nehmen, sondern das erste in den oberen 40 % des Textes
  const limit = text.length * 0.4;
  const top = candidates.find((c) => !c.negative && c.span[0] <= limit);
  if (top) return { date: top.iso, span: top.span, confidence: 0.6 };

  const anyNonNeg = candidates.find((c) => !c.negative);
  if (anyNonNeg) return { date: anyNonNeg.iso, span: anyNonNeg.span, confidence: 0.4 };

  return { date: candidates[0].iso, span: candidates[0].span, confidence: 0.3 };
}

// ---------------------------------------------------------------------------
// Betrag
// ---------------------------------------------------------------------------

// Deutsches Format: 1.234,56 | 12,50 (Tausender nur mit Punkt oder geschütztem/schmalem Leerzeichen,
// sonst würde "Menge 3" + "119,00" zu 3.119,00)
const MONEY_DE_RE = /(?<![\d.,])(\d{1,3}(?:[.\u00a0\u202f]\d{3})+|\d+),(\d{2})(?![\d])(?!\s*%)/g;
// Auf Summenzeilen auch OCR-/Bon-Schreibweise 12.50 zulassen
const MONEY_DOT_RE = /(?<![\d.,])(\d+)\.(\d{2})(?![\d.,])(?!\s*%)/g;

const AMOUNT_TIERS: { re: RegExp; confidence: number }[] = [
  {
    re: /zu\s*zahlen|zahlbetrag|rechnungsbetrag|endbetrag|gesamtbetrag|auszahlungsbetrag|gesamtsumme|bruttobetrag/i,
    confidence: 0.9,
  },
  { re: /gesamt|summe|total|betrag/i, confidence: 0.8 },
  { re: /brutto/i, confidence: 0.6 },
];
const AMOUNT_EXCLUDE_RE =
  /netto|zwischensumme|teilsumme|mwst|ust\.?(?![\p{L}])|steuer|rabatt|r(?:ü|u)ckgeld|gegeben|skonto|anzahlung/iu;

interface Money {
  cents: number;
  span: Span;
}

function moneyIn(segment: string, offset: number, allowDot: boolean): Money[] {
  const out: Money[] = [];
  for (const re of allowDot ? [MONEY_DE_RE, MONEY_DOT_RE] : [MONEY_DE_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(segment))) {
      const start = offset + m.index;
      const end = start + m[0].length;
      if (out.some((o) => start < o.span[1] && end > o.span[0])) continue;
      const euros = parseInt(m[1].replace(/[.\u00a0\u202f]/g, ''), 10);
      out.push({ cents: euros * 100 + parseInt(m[2], 10), span: [start, end] });
    }
  }
  return out.sort((a, b) => a.span[0] - b.span[0]);
}

export function extractAmount(text: string): { cents: number | null; span: Span | null; confidence: number } {
  const lines = splitLines(text);
  let best: { tier: number; money: Money } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tier = AMOUNT_TIERS.findIndex((t) => t.re.test(line.text));
    if (tier < 0) continue;
    const excluded = AMOUNT_EXCLUDE_RE.test(line.text) && !/brutto/i.test(line.text);
    if (excluded) continue;

    let amounts = moneyIn(line.text, line.start, true);
    // Beschriftung und Wert in getrennten Zeilen (nur bei kurzer Beschriftung, keine Tabellenköpfe)
    if (amounts.length === 0 && i + 1 < lines.length && line.text.trim().length <= 25) {
      amounts = moneyIn(lines[i + 1].text, lines[i + 1].start, true).slice(0, 1);
    }
    if (amounts.length === 0) continue;
    const money = amounts[amounts.length - 1];

    if (
      !best ||
      tier < best.tier ||
      (tier === best.tier && money.cents > best.money.cents)
    ) {
      best = { tier, money };
    }
  }

  if (best) {
    return { cents: best.money.cents, span: best.money.span, confidence: AMOUNT_TIERS[best.tier].confidence };
  }

  // Fallback: größter Betrag mit € / EUR direkt davor oder danach
  let fallback: Money | null = null;
  for (const money of moneyIn(text, 0, false)) {
    const around = text.slice(Math.max(0, money.span[0] - 4), money.span[1] + 4);
    if (!/€|EUR/i.test(around)) continue;
    if (!fallback || money.cents > fallback.cents) fallback = money;
  }
  if (fallback) return { cents: fallback.cents, span: fallback.span, confidence: 0.4 };

  return { cents: null, span: null, confidence: 0 };
}

// ---------------------------------------------------------------------------
// Absender
// ---------------------------------------------------------------------------

const COMPANY_RE =
  /(?<![\p{L}])(?:GmbH|gGmbH|mbH|AG|SE|KG|KGaA|OHG|GbR|UG|e\.\s?K\.?|e\.\s?V\.?|Ltd|Inc|Bank|Sparkasse|Volksbank|Raiffeisenbank|Versicherung|Stadtwerke|Finanzamt|Krankenkasse|AOK|Apotheke|Markt|Center)(?![\p{L}])/iu;
const SENDER_SKIP_RE =
  /(?:^|\s)(?:tel|telefon|fon|fax|e-?mail|mail|www\.|http|iban|bic|ust|steuer-?nr|steuernummer|seite\s*\d|kunden-?nr|kundennummer|rechnungs-?nr|datum)(?![\p{L}])|@/iu;
const RECIPIENT_RE = /^(?:herrn?|frau|firma|an|z\.\s?hd\.?)(?![\p{L}])/iu;
const PLZ_RE = /(?<!\d)\d{5}\s+\p{L}/u;
const STREET_RE = /(?:stra(?:ß|ss)e|str\.|weg|platz|allee|gasse|ring|damm|ufer|chaussee)\s*\d/iu;
const DOC_WORD_RE =
  /^(?:rechnung|kassenbon|kassenbeleg|quittung|kontoauszug|lohnabrechnung|verdienstabrechnung|gehaltsabrechnung|beleg|bon|gutschrift|angebot|bescheid|vertrag|mahnung|position|artikel)(?![\p{L}])/iu;
const ANY_DATE_RE = /(?<!\d)\d{1,2}\s?\.\s?\d{1,2}\s?\.\s?\d{2,4}(?!\d)/;

function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) || []).length;
}

function acceptableSenderPart(part: string): boolean {
  const t = part.trim();
  if (letterCount(t) < 3) return false;
  if ((t.match(/\d/g) || []).length > letterCount(t)) return false;
  if (ANY_DATE_RE.test(t)) return false;
  if (RECIPIENT_RE.test(t)) return false;
  if (PLZ_RE.test(t) || STREET_RE.test(t)) return false;
  if (SENDER_SKIP_RE.test(t)) return false;
  if (DOC_WORD_RE.test(t)) return false;
  return true;
}

function cleanSender(s: string): string {
  let out = s.replace(/\s+/g, ' ').replace(/^[^\p{L}\d]+|[^\p{L}\d.)]+$/gu, '').trim();
  if (out.length > 60) out = out.slice(0, 60).trim();
  return out;
}

export function extractSender(text: string): { sender: string | null; span: Span | null; confidence: number } {
  const lines = splitLines(text).filter((l) => l.text.trim() !== '').slice(0, 15);
  let firstAcceptable: { sender: string; span: Span } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Absenderzeile über dem Adressfenster: "Muster GmbH · Musterstr. 1 · 12345 Ort"
    const firstPart = line.text.split(/\s[·•|]\s|\s-\s|,\s/)[0];
    if (!acceptableSenderPart(firstPart)) continue;

    const offsetInLine = line.text.indexOf(firstPart.trim());
    const sender = cleanSender(firstPart);
    if (letterCount(sender) < 3) continue;
    const span: Span = [line.start + offsetInLine, line.start + offsetInLine + firstPart.trim().length];

    if (COMPANY_RE.test(sender)) {
      return { sender, span, confidence: 0.8 };
    }
    if (!firstAcceptable && i < 8) firstAcceptable = { sender, span };
  }

  if (firstAcceptable) return { ...firstAcceptable, confidence: 0.4 };
  return { sender: null, span: null, confidence: 0 };
}

// ---------------------------------------------------------------------------
// Gesamt
// ---------------------------------------------------------------------------

export function extractMetadata(text: string, type: string | null = null, now = new Date()): ExtractResult {
  const date = extractDate(text, now);
  const amount = extractAmount(text);
  const sender = extractSender(text);
  const title = buildTitle(type, sender.sender, date.date) || null;

  const confidences = [date.confidence, amount.confidence, sender.confidence].filter((c) => c > 0);
  const confidence = confidences.length
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
    : 0;

  return {
    date: date.date,
    dateSpan: date.span,
    dateConfidence: date.confidence,
    amountCents: amount.cents,
    amountSpan: amount.span,
    amountConfidence: amount.confidence,
    sender: sender.sender,
    senderSpan: sender.span,
    senderConfidence: sender.confidence,
    title,
    confidence,
  };
}

/** Typ + Metadaten in einem Schritt (wird nach der OCR aufgerufen). */
export function detectDocument(text: string, layout: string | null = null, now = new Date()): Detection {
  const amount = extractAmount(text);
  const cls: ClassifyResult = classify(text, { hasAmount: amount.cents !== null, layout });
  const meta = extractMetadata(text, cls.type, now);
  // Kontoauszüge haben keinen einzelnen "Betrag" (nur Buchungen und Salden)
  if (cls.type === 'kontoauszug') {
    meta.amountCents = null;
    meta.amountSpan = null;
    meta.amountConfidence = 0;
  }
  return {
    ...meta,
    type: cls.type,
    typeConfidence: cls.confidence,
    typeRunnerUp: cls.runnerUp,
    typeFallback: cls.fallback,
    layout,
  };
}
