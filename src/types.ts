export type FolderKind = 'steuerjahr' | 'jahr' | 'frei';

export interface Folder {
  id: number;
  name: string;
  kind: FolderKind;
  year: number | null;
  color: string | null;
  sort: number;
  created_at: string;
  document_count: number;
}

export type ActiveView =
  | { type: 'dashboard' }
  | { type: 'inbox' }
  | { type: 'folder'; folderId: number }
  | { type: 'search' }
  | { type: 'settings' };

export interface SystemHealth {
  ok: boolean;
  version: string;
  app: string;
  tools: {
    ocrmypdf: boolean;
    tesseract: boolean;
    python?: boolean;
    python3: boolean;
    opencv: boolean;
    'heif-convert'?: boolean;
    'scan.py'?: boolean;
    [key: string]: boolean | undefined;
  };
}

export interface AppSettings {
  default_color_mode: 'bw' | 'gray' | 'color';
  [key: string]: string | undefined;
}

export interface SystemPaths {
  dataDir: string;
  scannyDir: string;
  watchDir: string;
  archiveDir: string;
  dbPath: string;
  hostScannyDir?: string;
  hostWatchDir?: string;
  hostArchiveDir?: string;
}

export const COLOR_PRESETS = [
  { label: 'Blau', value: '#3b82f6', bgClass: 'bg-blue-500' },
  { label: 'Smaragdgrün', value: '#10b981', bgClass: 'bg-emerald-500' },
  { label: 'Bernstein', value: '#f59e0b', bgClass: 'bg-amber-500' },
  { label: 'Violett', value: '#8b5cf6', bgClass: 'bg-violet-500' },
  { label: 'Rosenrot', value: '#f43f5e', bgClass: 'bg-rose-500' },
  { label: 'Schiefergrau', value: '#64748b', bgClass: 'bg-slate-500' },
];

export type DocumentStatus = 'queued' | 'processing' | 'inbox' | 'filed' | 'error';
export type DocumentSource = 'folder' | 'upload';

export type DocumentTypeKey =
  | 'rechnung'
  | 'quittung'
  | 'kontoauszug'
  | 'vertrag'
  | 'bescheid'
  | 'lohnabrechnung'
  | 'spendenquittung'
  | 'versicherung'
  | 'brief'
  | 'sonstiges';

export const DOCUMENT_TYPE_MAP: Record<DocumentTypeKey, string> = {
  rechnung: 'Rechnung',
  quittung: 'Quittung/Kassenbon',
  kontoauszug: 'Kontoauszug',
  vertrag: 'Vertrag',
  bescheid: 'Bescheid',
  lohnabrechnung: 'Lohnabrechnung',
  spendenquittung: 'Spendenquittung',
  versicherung: 'Versicherung',
  brief: 'Brief',
  sonstiges: 'Sonstiges',
};

export const DOCUMENT_TYPE_OPTIONS: { key: DocumentTypeKey; label: string }[] = [
  { key: 'rechnung', label: 'Rechnung' },
  { key: 'quittung', label: 'Quittung/Kassenbon' },
  { key: 'kontoauszug', label: 'Kontoauszug' },
  { key: 'vertrag', label: 'Vertrag' },
  { key: 'bescheid', label: 'Bescheid' },
  { key: 'lohnabrechnung', label: 'Lohnabrechnung' },
  { key: 'spendenquittung', label: 'Spendenquittung' },
  { key: 'versicherung', label: 'Versicherung' },
  { key: 'brief', label: 'Brief' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function formatDocumentType(key: string | null | undefined): string {
  if (!key) return '';
  const lower = key.toLowerCase().trim();
  if (lower in DOCUMENT_TYPE_MAP) {
    return DOCUMENT_TYPE_MAP[lower as DocumentTypeKey];
  }
  for (const [k, label] of Object.entries(DOCUMENT_TYPE_MAP)) {
    if (label.toLowerCase() === lower) return label;
  }
  return key;
}

export interface DocumentFormData {
  title: string;
  sender: string;
  doc_type: string;
  doc_date: string;
  amount_cents: number | null;
  amount_str: string;
  folder_id: number | null;
  user_edited: string[];
}

export interface ScannyDocument {
  id: number;
  status: DocumentStatus;
  source: DocumentSource;
  import_batch: string | null;
  folder_id: number | null;
  folder_name?: string | null;
  folder_kind?: FolderKind | null;
  folder_color?: string | null;
  title: string | null;
  doc_date: string | null;
  file_date: string | null;
  sha256: string | null;
  duplicate_of_id?: number | null;
  duplicate_of_title?: string | null;
  amount_cents: number | null;
  sender: string | null;
  doc_type: string | null;
  user_edited: string | null;
  original_name: string;
  original_path: string | null;
  pdf_path: string | null;
  thumb_path: string | null;
  page_count: number;
  color_mode: 'bw' | 'gray' | 'color';
  rotation?: number;
  corners?: string | null;
  detected?: number | boolean | null;
  ocr_text: string | null;
  extraction?: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Ergebnis der automatischen Erkennung (documents.extraction, JSON). Spans = [start, end] im ocr_text. */
export interface DocumentExtraction {
  type: string;
  typeConfidence: number;
  typeRunnerUp: string | null;
  typeFallback: boolean;
  date: string | null;
  dateSpan: [number, number] | null;
  amountCents: number | null;
  amountSpan: [number, number] | null;
  sender: string | null;
  senderSpan: [number, number] | null;
  title: string | null;
  confidence: number;
  layout: string | null;
}

/** Formularfeld, dessen Fundstelle im Text hervorgehoben werden soll. */
export type HighlightField = 'doc_date' | 'amount_cents' | 'sender' | null;

export function parseExtraction(doc: Pick<ScannyDocument, 'extraction'> | null | undefined): DocumentExtraction | null {
  if (!doc?.extraction) return null;
  try {
    const parsed = JSON.parse(doc.extraction);
    return parsed && typeof parsed === 'object' ? (parsed as DocumentExtraction) : null;
  } catch {
    return null;
  }
}

export function highlightSpan(
  extraction: DocumentExtraction | null,
  field: HighlightField
): [number, number] | null {
  if (!extraction || !field) return null;
  if (field === 'doc_date') return extraction.dateSpan;
  if (field === 'amount_cents') return extraction.amountSpan;
  if (field === 'sender') return extraction.senderSpan;
  return null;
}

/** Ordner-Vorschlag zum Datum: zuerst Steuerjahr-Ordner des Jahres, sonst Jahr-Ordner. */
export function suggestFolderId(folders: Folder[], isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const year = parseInt(isoDate.slice(0, 4), 10);
  if (isNaN(year)) return null;
  const steuer = folders.find((f) => f.kind === 'steuerjahr' && f.year === year);
  if (steuer) return steuer.id;
  const jahr = folders.find((f) => f.kind === 'jahr' && f.year === year);
  return jahr ? jahr.id : null;
}

export function formatCentsDe(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


export interface QueueStats {
  inbox: number;
  queued: number;
  processing: number;
  error: number;
  filed?: number;
}


/** Treffer aus GET /api/search. snippet enthält \u0001…\u0002 als Markierung. */
export interface SearchHit {
  id: number;
  title: string | null;
  original_name: string;
  doc_date: string | null;
  doc_type: string | null;
  sender: string | null;
  amount_cents: number | null;
  status: DocumentStatus;
  folder_id: number | null;
  folder_name: string | null;
  folder_kind: FolderKind | null;
  folder_color: string | null;
  page_count: number;
  updated_at: string;
  snippet: string | null;
  rank: number;
}

/** Farbige Chips je Dokumenttyp (Tailwind-Klassen). */
export const DOCUMENT_TYPE_CHIP: Record<string, string> = {
  rechnung: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900',
  quittung: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
  kontoauszug: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
  vertrag: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900',
  bescheid: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900',
  lohnabrechnung: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-900',
  spendenquittung: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/50 dark:text-pink-300 dark:border-pink-900',
  versicherung: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900',
  brief: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800',
  sonstiges: 'bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-300 dark:border-zinc-800',
};

export function typeChipClass(type: string | null | undefined): string {
  return DOCUMENT_TYPE_CHIP[(type || 'sonstiges').toLowerCase()] || DOCUMENT_TYPE_CHIP.sonstiges;
}

/** "2026-08-14" -> "14.08.2026" (ohne Zeitzonen-Umrechnung) */
export function formatIsoDateDe(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export function formatEuro(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export const GERMAN_MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
