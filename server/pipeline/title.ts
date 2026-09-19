/**
 * Titel-Vorschlag aus Typ + Absender (+ Monat bei wiederkehrenden Typen).
 * Reines TypeScript ohne Imports: wird vom Server (extract.ts) UND vom Frontend
 * (DocumentForm, Neuberechnung bei Typ-/Absender-Änderung) verwendet.
 */

export const TITLE_TYPE_LABELS: Record<string, string> = {
  rechnung: 'Rechnung',
  quittung: 'Quittung',
  kontoauszug: 'Kontoauszug',
  vertrag: 'Vertrag',
  bescheid: 'Bescheid',
  lohnabrechnung: 'Lohnabrechnung',
  spendenquittung: 'Spendenquittung',
  versicherung: 'Versicherung',
  brief: 'Brief',
  sonstiges: 'Dokument',
};

/** Typen, die monatlich wiederkehren: Titel bekommt "<Monat> <Jahr>". */
const RECURRING_TYPES = new Set(['kontoauszug', 'lohnabrechnung']);

export const GERMAN_MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

const LEGAL_SUFFIX_RE =
  /[\s,]+(?:GmbH\s*&\s*Co\.?\s*(?:KGaA|KG|OHG)|GmbH|gGmbH|mbH|AG|SE|KGaA|KG|OHG|GbR|UG(?:\s*\(haftungsbeschränkt\))?|e\.\s?K\.?|e\.\s?V\.?|Ltd\.?|Inc\.?|S\.?A\.?|B\.?V\.?)\s*$/i;

/**
 * Kürzt einen Absender für den Titel: Rechtsform weg, VERSALIEN-Wörter in Normalschreibung.
 * "BAUHAUS GmbH & Co. KG" -> "Bauhaus"
 */
export function shortSender(sender: string | null | undefined): string {
  if (!sender) return '';
  let s = sender.trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(LEGAL_SUFFIX_RE, '').trim();
    if (next === s || next.length < 2) break;
    s = next;
  }
  s = s
    .split(/\s+/)
    .map((w) =>
      w.length > 3 && w === w.toUpperCase() && /[A-ZÄÖÜ]/.test(w)
        ? w.charAt(0) + w.slice(1).toLowerCase()
        : w
    )
    .join(' ');
  if (s.length > 40) s = s.slice(0, 40).trim();
  return s;
}

function formatDateDe(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Baut den Titel-Vorschlag. Liefert '' wenn es nichts Sinnvolles vorzuschlagen gibt
 * (dann behält der Aufrufer den bisherigen Titel).
 *   buildTitle('rechnung', 'Bauhaus GmbH', '2026-03-02')    -> "Rechnung Bauhaus"
 *   buildTitle('kontoauszug', 'Sparkasse', '2026-03-31')    -> "Kontoauszug Sparkasse März 2026"
 *   buildTitle('lohnabrechnung', null, '2026-02-28')        -> "Lohnabrechnung Februar 2026"
 *   buildTitle('rechnung', null, '2026-03-02')              -> "Rechnung 02.03.2026"
 */
export function buildTitle(
  type: string | null | undefined,
  sender: string | null | undefined,
  isoDate: string | null | undefined
): string {
  if (!type) return '';
  const label = TITLE_TYPE_LABELS[type] || TITLE_TYPE_LABELS.sonstiges;
  const name = shortSender(sender);
  const validDate = isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : null;

  if (type === 'sonstiges' && !name && !validDate) return '';

  const parts = [label];
  if (name) parts.push(name);

  if (RECURRING_TYPES.has(type) && validDate) {
    const month = parseInt(validDate.slice(5, 7), 10);
    parts.push(`${GERMAN_MONTHS[month - 1]} ${validDate.slice(0, 4)}`);
  } else if (!name && validDate) {
    parts.push(formatDateDe(validDate));
  }

  return parts.join(' ');
}
