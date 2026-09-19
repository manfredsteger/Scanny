import React from 'react';
import { Sparkles, Calendar, Tag, Building2, FileText, Euro, Folder as FolderIcon } from 'lucide-react';
import {
  Folder,
  ScannyDocument,
  DocumentFormData,
  DOCUMENT_TYPE_OPTIONS,
} from '../types';

export type { DocumentFormData };

interface DocumentFormProps {
  document: ScannyDocument;
  folders: Folder[];
  value: DocumentFormData;
  onChange: (data: DocumentFormData) => void;
  disabled?: boolean;
}

function getLocalTodayDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(isoStr?: string | null): string | null {
  if (!isoStr) return null;
  const parts = isoStr.slice(0, 10).split('-');
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return null;
}

export function DocumentForm({
  document,
  folders,
  value,
  onChange,
  disabled = false,
}: DocumentFormProps) {
  const markFieldEdited = (field: string): string[] => {
    if (!value.user_edited.includes(field)) {
      return [...value.user_edited, field];
    }
    return value.user_edited;
  };

  const handleFieldChange = (field: keyof DocumentFormData, newVal: any) => {
    const updatedEdited = markFieldEdited(field as string);
    onChange({
      ...value,
      [field]: newVal,
      user_edited: updatedEdited,
    });
  };

  const handleAmountChange = (raw: string) => {
    const updatedEdited = markFieldEdited('amount_cents');
    let cents: number | null = null;
    const clean = raw.trim().replace(/\s/g, '').replace('€', '');
    if (clean) {
      const standardized = clean.replace(/\./g, '').replace(',', '.');
      const parsedNum = parseFloat(standardized);
      if (!isNaN(parsedNum)) {
        cents = Math.round(parsedNum * 100);
      }
    }

    onChange({
      ...value,
      amount_str: raw,
      amount_cents: cents,
      user_edited: updatedEdited,
    });
  };

  const handleDateChange = (dateStr: string) => {
    const updatedEdited = markFieldEdited('doc_date');
    let autoFolderId = value.folder_id;

    // Nur wenn der Nutzer den Ordner noch nicht manuell gewählt/berührt hat,
    // schlagen wir den Ordner passend zum gewählten Jahr vor
    if (!updatedEdited.includes('folder_id') && dateStr) {
      const year = parseInt(dateStr.slice(0, 4), 10);
      if (!isNaN(year)) {
        const matchingFolder = folders.find(
          (f) => (f.kind === 'steuerjahr' || f.kind === 'jahr') && f.year === year
        );
        if (matchingFolder) {
          autoFolderId = matchingFolder.id;
        }
      }
    }

    onChange({
      ...value,
      doc_date: dateStr,
      folder_id: autoFolderId,
      user_edited: updatedEdited,
    });
  };

  // Heutiges Datum (lokales Datum, kein UTC-Versatz)
  const setTodayDate = () => {
    handleDateChange(getLocalTodayDate());
  };

  // Dateidatum (echtes Datum aus documents.file_date oder Fallback auf created_at)
  const setFileDate = () => {
    const targetDate = document.file_date || (document.created_at ? document.created_at.slice(0, 10) : getLocalTodayDate());
    handleDateChange(targetDate);
  };

  const displayFileDate = formatDisplayDate(document.file_date);
  const fileDateButtonLabel = displayFileDate ? `Dateidatum: ${displayFileDate}` : 'Dateidatum';

  return (
    <div className="space-y-4 text-zinc-900 dark:text-zinc-100 text-sm">
      {/* Dokumenttyp */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <Tag className="w-3.5 h-3.5 text-zinc-500" />
            Dokumenttyp
          </label>
        </div>
        <select
          id="document-form-doc-type"
          value={value.doc_type || ''}
          onChange={(e) => handleFieldChange('doc_type', e.target.value)}
          disabled={disabled}
          className="w-full bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
        >
          <option value="">– noch offen –</option>
          {DOCUMENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Name / Titel */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <FileText className="w-3.5 h-3.5 text-zinc-500" />
            Titel / Name
          </label>
        </div>
        <input
          id="document-form-title"
          type="text"
          value={value.title || ''}
          onChange={(e) => handleFieldChange('title', e.target.value)}
          disabled={disabled}
          placeholder="z. B. Telekom Rechnung März"
          className="w-full bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-all"
        />
      </div>

      {/* Absender */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <Building2 className="w-3.5 h-3.5 text-zinc-500" />
            Absender / Aussteller
          </label>
        </div>
        <input
          id="document-form-sender"
          type="text"
          value={value.sender || ''}
          onChange={(e) => handleFieldChange('sender', e.target.value)}
          disabled={disabled}
          placeholder="z. B. Deutsche Telekom AG"
          className="w-full bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-all"
        />
      </div>

      {/* Dokumentdatum */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <Calendar className="w-3.5 h-3.5 text-zinc-500" />
            Dokumentdatum
          </label>
        </div>

        {/* Schnellknöpfe */}
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          <button
            type="button"
            disabled={true}
            title="Wird in Schritt 3 per OCR automatisch erkannt"
            className="px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 text-zinc-400 cursor-not-allowed opacity-60 text-center truncate"
          >
            Erkannt: –
          </button>
          <button
            type="button"
            id="date-btn-today"
            onClick={setTodayDate}
            disabled={disabled}
            className="px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer text-center font-medium"
          >
            Heute
          </button>
          <button
            type="button"
            id="date-btn-file-date"
            onClick={setFileDate}
            disabled={disabled}
            title={document.file_date ? `Dateidatum: ${document.file_date}` : 'Aus Dateidatum übernehmen'}
            className="px-2 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer text-center font-medium truncate"
          >
            {fileDateButtonLabel}
          </button>
        </div>

        <input
          id="document-form-doc-date"
          type="date"
          value={value.doc_date || ''}
          onChange={(e) => handleDateChange(e.target.value)}
          disabled={disabled}
          className="w-full bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
        />
      </div>

      {/* Betrag */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <Euro className="w-3.5 h-3.5 text-zinc-500" />
            Betrag (optional)
          </label>
        </div>
        <div className="relative">
          <input
            id="document-form-amount"
            type="text"
            value={value.amount_str || ''}
            onChange={(e) => handleAmountChange(e.target.value)}
            disabled={disabled}
            placeholder="0,00"
            className="w-full bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-xl pl-3 pr-8 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-all font-mono"
          />
          <span className="absolute right-3 top-2.5 text-xs text-zinc-400 pointer-events-none">€</span>
        </div>
      </div>

      {/* Zielordner */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            <FolderIcon className="w-3.5 h-3.5 text-zinc-500" />
            Zielordner
          </label>
          {value.folder_id && !value.user_edited.includes('folder_id') && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded-md">
              <Sparkles className="w-3 h-3" />
              Vorschlag
            </span>
          )}
        </div>
        <select
          id="document-form-folder"
          value={value.folder_id ?? ''}
          onChange={(e) => {
            const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
            handleFieldChange('folder_id', val);
          }}
          disabled={disabled}
          className="w-full bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
        >
          <option value="">Erst mal im Eingang lassen</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.kind === 'steuerjahr'
                ? `📁 Steuerjahr ${f.year}`
                : f.kind === 'jahr'
                ? `📁 Jahr ${f.year}`
                : `📁 ${f.name}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
