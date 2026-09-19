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
  error: string | null;
  created_at: string;
  updated_at: string;
}


export interface QueueStats {
  inbox: number;
  queued: number;
  processing: number;
  error: number;
  filed?: number;
}

