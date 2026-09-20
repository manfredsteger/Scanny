import React, { useState } from 'react';
import {
  Trash2,
  RotateCcw,
  FileText,
  Loader2,
  Clock,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  ScannyDocument,
  TRASH_RETENTION_DAYS,
  formatDocumentType,
  formatEuro,
  formatIsoDateDe,
  typeChipClass,
} from '../types';
import { DeleteConfirmModal } from './DeleteConfirmModal';

interface TrashViewProps {
  documents: ScannyDocument[];
  onRestore: (id: number) => Promise<void>;
  onPurge: (id: number) => Promise<void>;
  onSelectDocument: (doc: ScannyDocument) => void;
}

/** Verbleibende Tage bis zum automatischen endgültigen Löschen. */
function daysLeft(deletedAt: string | null | undefined): number | null {
  if (!deletedAt) return null;
  const deleted = new Date(deletedAt);
  if (isNaN(deleted.getTime())) return null;
  const elapsedDays = (Date.now() - deleted.getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - elapsedDays));
}

export function TrashView({ documents, onRestore, onPurge, onSelectDocument }: TrashViewProps) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<ScannyDocument | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRestore = async (doc: ScannyDocument) => {
    setBusyId(doc.id);
    setError(null);
    try {
      await onRestore(doc.id);
      setMessage(`»${doc.title || doc.original_name}« wurde wiederhergestellt.`);
    } catch (err: any) {
      setError(err?.message || 'Wiederherstellen fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async () => {
    if (!purgeTarget) return;
    setIsPurging(true);
    setError(null);
    try {
      await onPurge(purgeTarget.id);
      setMessage(`»${purgeTarget.title || purgeTarget.original_name}« wurde endgültig gelöscht.`);
      setPurgeTarget(null);
    } catch (err: any) {
      setError(err?.message || 'Endgültiges Löschen fehlgeschlagen.');
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div id="trash-view" className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Kopf */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-2.5">
              Papierkorb
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-semibold">
                {documents.length}
              </span>
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              Gelöschte Belege werden nach {TRASH_RETENTION_DAYS} Tagen automatisch endgültig entfernt.
            </p>
          </div>
        </div>
      </div>

      {(message || error) && (
        <div
          className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
            error
              ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300'
              : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {error ? (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{error || message}</span>
        </div>
      )}

      {documents.length === 0 ? (
        <div className="py-16 text-center border border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/30 p-8">
          <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
            <Trash2 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Papierkorb ist leer</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto mt-1">
            Gelöschte Belege landen hier und lassen sich {TRASH_RETENTION_DAYS} Tage lang zurückholen.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
          {documents.map((doc) => {
            const remaining = daysLeft(doc.deleted_at);
            const isBusy = busyId === doc.id;
            return (
              <div
                key={doc.id}
                id={`trash-row-${doc.id}`}
                className="flex items-center gap-3.5 p-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onSelectDocument(doc)}
                  className="w-12 h-16 rounded-lg bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer"
                  title="Beleg ansehen"
                >
                  {doc.thumb_path ? (
                    <img
                      src={`/api/documents/${doc.id}/thumb?v=${encodeURIComponent(doc.updated_at || '')}`}
                      alt=""
                      className="w-full h-full object-cover object-top"
                    />
                  ) : (
                    <FileText className="w-5 h-5 text-zinc-400" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onSelectDocument(doc)}
                  className="flex-1 min-w-0 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {doc.title || doc.original_name}
                    </p>
                    {doc.doc_type && (
                      <span
                        className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${typeChipClass(doc.doc_type)}`}
                      >
                        {formatDocumentType(doc.doc_type)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                    {doc.original_name}
                    {doc.doc_date ? ` • ${formatIsoDateDe(doc.doc_date)}` : ''}
                    {doc.amount_cents !== null ? ` • ${formatEuro(doc.amount_cents)}` : ''}
                    {doc.page_count > 1 ? ` • ${doc.page_count} Seiten` : ''}
                  </p>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1 mt-1">
                    <Clock className="w-3 h-3 shrink-0" />
                    {remaining === null
                      ? 'Im Papierkorb'
                      : remaining === 0
                      ? 'Wird beim nächsten Aufräumen gelöscht'
                      : `Noch ${remaining} ${remaining === 1 ? 'Tag' : 'Tage'} im Papierkorb`}
                  </p>
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    id={`trash-restore-${doc.id}`}
                    disabled={isBusy}
                    onClick={() => handleRestore(doc)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    Wiederherstellen
                  </button>
                  <button
                    type="button"
                    id={`trash-purge-${doc.id}`}
                    disabled={isBusy}
                    onClick={() => setPurgeTarget(doc)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Endgültig löschen
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DeleteConfirmModal
        isOpen={Boolean(purgeTarget)}
        title="Endgültig löschen"
        message={`»${purgeTarget?.title || purgeTarget?.original_name}« wird unwiderruflich gelöscht – samt Originaldatei, PDF und Vorschau. Das lässt sich nicht rückgängig machen.`}
        confirmText="Unwiderruflich löschen"
        isDeleting={isPurging}
        onConfirm={handlePurge}
        onCancel={() => setPurgeTarget(null)}
      />
    </div>
  );
}
