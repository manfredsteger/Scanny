import React from 'react';
import { Inbox, AlertCircle, FolderCheck, Euro, ArrowRight, FileText, Loader2 } from 'lucide-react';
import {
  Folder,
  ScannyDocument,
  formatDocumentType,
  formatEuro,
  formatIsoDateDe,
  typeChipClass,
} from '../types';

interface DashboardViewProps {
  documents: ScannyDocument[];
  folders: Folder[];
  onOpenInbox: () => void;
  onOpenFolder: (folderId: number) => void;
  onSelectDocument: (doc: ScannyDocument) => void;
}

/** Jahr eines Dokuments: Belegdatum, sonst Erfassungsdatum */
function docYear(doc: ScannyDocument): number {
  return parseInt((doc.doc_date || doc.created_at || '').slice(0, 4), 10);
}

export function DashboardView({ documents, folders, onOpenInbox, onOpenFolder, onSelectDocument }: DashboardViewProps) {
  const year = new Date().getFullYear();
  // wie die Sidebar: alles, was noch nicht abgelegt ist (inkl. Fehler und laufender Aufbereitung)
  const inbox = documents.filter((d) => d.status !== 'filed');
  const processing = documents.filter((d) => d.status === 'queued' || d.status === 'processing').length;
  const errors = documents.filter((d) => d.status === 'error');
  const filedThisYear = documents.filter((d) => d.status === 'filed' && docYear(d) === year);

  // Summe Beträge im aktuellen Steuerjahr: Inhalt des Steuerjahr-Ordners, sonst alle abgelegten Belege des Jahres
  const taxFolder = folders.find((f) => f.kind === 'steuerjahr' && f.year === year);
  const taxDocs = taxFolder
    ? documents.filter((d) => d.status === 'filed' && d.folder_id === taxFolder.id)
    : filedThisYear;
  const taxSum = taxDocs.reduce((sum, d) => sum + (d.amount_cents || 0), 0);

  const recent = [...documents]
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '') || b.id - a.id)
    .slice(0, 8);

  const tile =
    'rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 text-left shadow-xs transition-colors';

  return (
    <div id="dashboard-view" className="p-6 md:p-8 max-w-6xl mx-auto space-y-8">
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Übersicht</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">Stand deiner Belege auf einen Blick.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          id="dash-tile-inbox"
          onClick={onOpenInbox}
          className={`${tile} hover:border-blue-400 dark:hover:border-blue-600 cursor-pointer`}
        >
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <Inbox className="w-4 h-4 text-blue-500" /> Im Eingang
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
          <p className="mt-3 text-3xl font-bold text-zinc-900 dark:text-white">{inbox.length}</p>
          <p className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
            {processing > 0 ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> {processing} in Aufbereitung
              </>
            ) : (
              'warten auf Prüfung'
            )}
          </p>
        </button>

        {errors.length > 0 && (
          <button
            type="button"
            id="dash-tile-errors"
            onClick={onOpenInbox}
            className={`${tile} border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/30 hover:border-red-400 cursor-pointer`}
          >
            <div className="flex items-center justify-between text-red-600 dark:text-red-400 text-xs font-semibold">
              <span className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> Fehler
              </span>
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
            <p className="mt-3 text-3xl font-bold text-red-700 dark:text-red-300">{errors.length}</p>
            <p className="text-[11px] text-red-500/80 mt-1">Aufbereitung fehlgeschlagen</p>
          </button>
        )}

        <div id="dash-tile-filed" className={tile}>
          <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 text-xs font-semibold">
            <FolderCheck className="w-4 h-4 text-emerald-500" /> Dieses Jahr abgelegt
          </div>
          <p className="mt-3 text-3xl font-bold text-zinc-900 dark:text-white">{filedThisYear.length}</p>
          <p className="text-[11px] text-zinc-400 mt-1">Belege aus {year}</p>
        </div>

        <button
          type="button"
          id="dash-tile-taxsum"
          onClick={() => taxFolder && onOpenFolder(taxFolder.id)}
          disabled={!taxFolder}
          className={`${tile} ${taxFolder ? 'hover:border-blue-400 dark:hover:border-blue-600 cursor-pointer' : 'cursor-default'}`}
        >
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <Euro className="w-4 h-4 text-amber-500" /> Steuerjahr {year}
            </span>
            {taxFolder && <ArrowRight className="w-3.5 h-3.5" />}
          </div>
          <p className="mt-3 text-3xl font-bold text-zinc-900 dark:text-white font-mono tracking-tight">
            {formatEuro(taxSum)}
          </p>
          <p className="text-[11px] text-zinc-400 mt-1">
            {taxFolder ? `Summe in »${taxFolder.name}« (${taxDocs.length} Belege)` : `Summe aller abgelegten Belege ${year}`}
          </p>
        </button>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
          Zuletzt erfasst
        </h3>
        {recent.length === 0 ? (
          <div
            id="dash-empty"
            className="text-center py-12 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/30 px-6"
          >
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3">
              <Inbox className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-white">Noch keine Belege erfasst</h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-md mx-auto leading-relaxed">
              Zieh Fotos oder PDFs einfach ins Fenster – oder leg sie in den Ordner{' '}
              <code className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded font-mono text-[11px]">
                Scanny/Upload
              </code>{' '}
              auf deinem Mac. Scanny richtet sie gerade, erkennt den Text und schlägt Titel, Datum und Ordner vor.
            </p>
            <button
              type="button"
              id="dash-empty-open-inbox"
              onClick={onOpenInbox}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              Zum Eingang <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <ul id="dash-recent" className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            {recent.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => onSelectDocument(doc)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60 cursor-pointer"
                >
                  <div className="w-8 h-10 rounded-md bg-zinc-100 dark:bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
                    {doc.thumb_path ? (
                      <img
                        src={`/api/documents/${doc.id}/thumb?v=${encodeURIComponent(doc.updated_at || '')}`}
                        alt=""
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <FileText className="w-4 h-4 text-zinc-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {doc.title || doc.original_name}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {doc.sender || '–'} · {doc.folder_name || (doc.status === 'filed' ? 'Ordner' : 'Eingang')}
                    </p>
                  </div>
                  {doc.doc_type && (
                    <span className={`hidden sm:inline text-[11px] font-medium px-2 py-0.5 rounded-md border ${typeChipClass(doc.doc_type)}`}>
                      {formatDocumentType(doc.doc_type)}
                    </span>
                  )}
                  <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400 w-24 text-right shrink-0">
                    {formatEuro(doc.amount_cents)}
                  </span>
                  <span className="text-xs font-mono text-zinc-400 w-20 text-right shrink-0">
                    {formatIsoDateDe(doc.doc_date)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
