import React, { useEffect, useMemo, useState } from 'react';
import { Download, X, FileArchive, FileSpreadsheet, FileText, Check, AlertCircle } from 'lucide-react';
import { Folder, ScannyDocument, formatEuro, formatIsoDateDe } from '../types';

interface ExportDialogProps {
  isOpen: boolean;
  folder: Folder;
  /** Alle abgelegten Belege dieses Ordners. */
  documents: ScannyDocument[];
  /** Im Ordner markierte Belege (leer = keine Auswahl). */
  selectedIds: number[];
  onClose: () => void;
}

type ExportFormat = 'zip' | 'csv' | 'pdf';

const FORMAT_INFO: { key: ExportFormat; label: string; hint: string; icon: typeof FileArchive }[] = [
  {
    key: 'zip',
    label: 'ZIP mit allen PDFs',
    hint: 'Dateinamen wie im Archiv, Übersicht als CSV liegt bei',
    icon: FileArchive,
  },
  {
    key: 'csv',
    label: 'Übersicht als CSV',
    hint: 'Semikolon-getrennt, öffnet sich direkt in Excel oder Numbers',
    icon: FileSpreadsheet,
  },
  {
    key: 'pdf',
    label: 'Ein Sammel-PDF',
    hint: 'Übersichtsseite mit Summe, danach alle Belege nach Datum',
    icon: FileText,
  },
];

export function ExportDialog({ isOpen, folder, documents, selectedIds, onClose }: ExportDialogProps) {
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [formats, setFormats] = useState<Record<ExportFormat, boolean>>({ zip: true, csv: true, pdf: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setScope(selectedIds.length > 0 ? 'selected' : 'all');
    setFrom('');
    setTo('');
    setFormats({ zip: true, csv: true, pdf: false });
    setError(null);
    setDone(false);
  }, [isOpen, selectedIds.length]);

  // Zeitraum des Ordners als Orientierung
  const dates = useMemo(
    () => documents.map((d) => d.doc_date).filter((d): d is string => Boolean(d)).sort(),
    [documents]
  );

  // Dieselbe Auswahl wie der Server: Zeitraum auf das Belegdatum, Belege ohne Datum fallen
  // bei gesetztem Zeitraum heraus.
  const selection = useMemo(() => {
    let docs = documents;
    if (scope === 'selected') docs = docs.filter((d) => selectedIds.includes(d.id));
    if (from) docs = docs.filter((d) => Boolean(d.doc_date) && d.doc_date! >= from);
    if (to) docs = docs.filter((d) => Boolean(d.doc_date) && d.doc_date! <= to);
    return docs;
  }, [documents, scope, selectedIds, from, to]);

  const sum = selection.reduce((acc, d) => acc + (d.amount_cents || 0), 0);
  const chosenFormats = FORMAT_INFO.filter((f) => formats[f.key]).map((f) => f.key);
  const dateRangeInvalid = Boolean(from && to && from > to);

  if (!isOpen) return null;

  const buildUrl = (format: ExportFormat) => {
    const params = new URLSearchParams({ format });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (scope === 'selected') params.set('ids', selectedIds.join(','));
    return `/api/folders/${folder.id}/export?${params.toString()}`;
  };

  const handleExport = async () => {
    if (chosenFormats.length === 0 || selection.length === 0 || dateRangeInvalid) return;
    setBusy(true);
    setError(null);
    try {
      for (const format of chosenFormats) {
        // Direkter Download über einen Link: Der Browser schreibt den Datenstrom auf die
        // Platte, das ZIP muss nicht erst komplett in den Arbeitsspeicher.
        const a = document.createElement('a');
        a.href = buildUrl(format);
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Kurze Pause, sonst verschluckt der Browser den zweiten Download
        if (chosenFormats.length > 1) await new Promise((r) => setTimeout(r, 900));
      }
      setDone(true);
      setTimeout(() => setDone(false), 4000);
    } catch (err: any) {
      setError(err?.message || 'Export fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-200';

  return (
    <div
      id="export-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
    >
      <div
        className="w-full max-w-lg max-h-[90vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
      >
        {/* Kopf */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/60 dark:bg-zinc-800/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Download className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id="export-dialog-title" className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                Exportieren
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{folder.name}</p>
            </div>
          </div>
          <button
            type="button"
            id="export-dialog-close"
            onClick={onClose}
            disabled={busy}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
            title="Schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Umfang */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Umfang</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                id="export-scope-all"
                onClick={() => setScope('all')}
                className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                  scope === 'all'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
              >
                Ganzer Ordner ({documents.length})
              </button>
              <button
                type="button"
                id="export-scope-selected"
                disabled={selectedIds.length === 0}
                onClick={() => setScope('selected')}
                title={selectedIds.length === 0 ? 'Zuerst Belege in der Liste markieren' : undefined}
                className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  scope === 'selected'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
              >
                Nur markierte ({selectedIds.length})
              </button>
            </div>
          </div>

          {/* Zeitraum */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Zeitraum
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="date"
                id="export-from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={`${inputClass} flex-1`}
                aria-label="Von"
              />
              <span className="text-xs text-zinc-400">bis</span>
              <input
                type="date"
                id="export-to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={`${inputClass} flex-1`}
                aria-label="Bis"
              />
              {(from || to) && (
                <button
                  type="button"
                  id="export-clear-period"
                  onClick={() => {
                    setFrom('');
                    setTo('');
                  }}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  title="Zeitraum zurücksetzen"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {from || to
                ? 'Belege ohne Belegdatum bleiben bei gesetztem Zeitraum außen vor.'
                : dates.length > 0
                ? `Leer lassen = ganzer Ordner (${formatIsoDateDe(dates[0])} bis ${formatIsoDateDe(dates[dates.length - 1])}).`
                : 'Leer lassen = ganzer Ordner.'}
            </p>
            {dateRangeInvalid && (
              <p className="text-[11px] text-red-600 dark:text-red-400">
                Das Startdatum liegt nach dem Enddatum.
              </p>
            )}
          </div>

          {/* Formate */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Formate</h3>
            <div className="space-y-2">
              {FORMAT_INFO.map(({ key, label, hint, icon: Icon }) => (
                <label
                  key={key}
                  htmlFor={`export-format-${key}`}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    formats[key]
                      ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/40'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    id={`export-format-${key}`}
                    checked={formats[key]}
                    onChange={(e) => setFormats((prev) => ({ ...prev, [key]: e.target.checked }))}
                    className="mt-0.5 w-4 h-4 accent-blue-600 cursor-pointer"
                  />
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${formats[key] ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`} />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-100">{label}</span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Zusammenfassung */}
          <div
            id="export-summary"
            className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300"
          >
            {selection.length === 0 ? (
              <span className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Für diese Auswahl gibt es keine Belege.
              </span>
            ) : (
              <>
                <span className="font-semibold">
                  {selection.length} {selection.length === 1 ? 'Beleg' : 'Belege'}
                </span>
                {sum !== 0 && <> · Summe <span className="font-mono">{formatEuro(sum)}</span></>}
                {chosenFormats.length > 1 && (
                  <span className="block text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                    {chosenFormats.length} Dateien werden nacheinander heruntergeladen.
                  </span>
                )}
              </>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex items-start gap-2.5 text-red-700 dark:text-red-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Fuß */}
        <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-800/50 flex items-center justify-between gap-3">
          {done ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
              <Check className="w-4 h-4" />
              Download gestartet
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              id="export-dialog-cancel"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-xs font-medium rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              Schließen
            </button>
            <button
              type="button"
              id="export-dialog-confirm"
              onClick={handleExport}
              disabled={busy || chosenFormats.length === 0 || selection.length === 0 || dateRangeInvalid}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              {busy ? 'Wird erzeugt…' : 'Exportieren'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
