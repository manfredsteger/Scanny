import React, { useEffect, useMemo, useState } from 'react';
import { X, Layers, Loader2, GripVertical, AlertCircle, ArrowUp, ArrowDown, FileText } from 'lucide-react';
import { ScannyDocument, formatIsoDateDe } from '../types';

interface MergeDialogProps {
  isOpen: boolean;
  documents: ScannyDocument[];
  onClose: () => void;
  /** Wird nach erfolgreichem Zusammenfügen mit dem neuen Dokument aufgerufen. */
  onMerged: (merged: ScannyDocument) => void;
}

/**
 * Dialog zum Zusammenfügen mehrerer Belege zu einem Dokument.
 * Reihenfolge per Drag & Drop (Standard: Erfassungszeit aufsteigend), zusätzlich Pfeiltasten
 * für Tastatur und Touch. Metadaten des ERSTEN Belegs gelten für das Ergebnis.
 */
export function MergeDialog({ isOpen, documents, onClose, onMerged }: MergeDialogProps) {
  const initialOrder = useMemo(
    () =>
      [...documents].sort(
        (a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id - b.id
      ),
    [documents]
  );

  const [order, setOrder] = useState<ScannyDocument[]>(initialOrder);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrder(initialOrder);
    setError(null);
    setDragIndex(null);
    setOverIndex(null);
  }, [initialOrder, isOpen]);

  if (!isOpen) return null;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleMerge = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/documents/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: order.map((d) => d.id) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Zusammenfügen fehlgeschlagen.');
      onMerged(data as ScannyDocument);
    } catch (err: any) {
      setError(err?.message || 'Zusammenfügen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id="merge-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-dialog-title"
      >
        {/* Kopf */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/60 dark:bg-zinc-800/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id="merge-dialog-title" className="text-sm font-bold text-zinc-900 dark:text-white">
                Zu einem Dokument zusammenfügen
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {order.length} Belege • Reihenfolge per Ziehen ändern
              </p>
            </div>
          </div>
          <button
            type="button"
            id="merge-dialog-close"
            onClick={onClose}
            disabled={busy}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
            title="Schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Seitenliste */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {order.map((doc, index) => {
            const isDragging = dragIndex === index;
            const isOver = overIndex === index && dragIndex !== null && dragIndex !== index;
            return (
              <div
                key={doc.id}
                id={`merge-page-${doc.id}`}
                draggable={!busy}
                onDragStart={() => setDragIndex(index)}
                onDragEnter={() => setOverIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) move(dragIndex, index);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={`flex items-center gap-3 p-2.5 rounded-xl border bg-white dark:bg-zinc-900 transition-all ${
                  isDragging
                    ? 'opacity-40 border-blue-400'
                    : isOver
                    ? 'border-blue-500 ring-2 ring-blue-500/30'
                    : 'border-zinc-200 dark:border-zinc-800'
                } ${busy ? '' : 'cursor-grab active:cursor-grabbing'}`}
              >
                <GripVertical className="w-4 h-4 text-zinc-300 dark:text-zinc-600 shrink-0" />

                <span className="w-6 h-6 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs font-mono font-semibold flex items-center justify-center shrink-0">
                  {index + 1}
                </span>

                <div className="w-12 h-16 rounded-lg bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
                  {doc.thumb_path ? (
                    <img
                      src={`/api/documents/${doc.id}/thumb?v=${encodeURIComponent(doc.updated_at || '')}`}
                      alt=""
                      className="w-full h-full object-cover object-top"
                    />
                  ) : (
                    <FileText className="w-5 h-5 text-zinc-400" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {doc.title || doc.original_name}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {doc.original_name}
                    {doc.doc_date ? ` • ${formatIsoDateDe(doc.doc_date)}` : ''}
                    {doc.page_count > 1 ? ` • ${doc.page_count} Seiten` : ''}
                  </p>
                  {index === 0 && (
                    <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium mt-0.5">
                      Titel und Ablageort richten sich nach diesem Beleg
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    type="button"
                    aria-label="Nach oben"
                    disabled={index === 0 || busy}
                    onClick={() => move(index, index - 1)}
                    className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-25 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Nach unten"
                    disabled={index === order.length - 1 || busy}
                    onClick={() => move(index, index + 1)}
                    className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-25 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex items-start gap-2.5 text-red-700 dark:text-red-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Fuß */}
        <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-800/50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
            Fehlende Angaben wie Datum oder Betrag werden von den folgenden Seiten ergänzt. Die
            Einzelbelege wandern in den Papierkorb und lassen sich über »Seiten wieder trennen«
            zurückholen.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              id="merge-dialog-cancel"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-xs font-medium rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              type="button"
              id="merge-dialog-confirm"
              onClick={handleMerge}
              disabled={busy || order.length < 2}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
              {busy ? 'Wird zusammengefügt…' : `${order.length} Belege zusammenfügen`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
