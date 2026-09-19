import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  Inbox,
  Folder as FolderIcon,
  RotateCcw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  FileText,
  CheckCircle2,
  Calendar,
  Sparkles,
  ArrowRight,
  Plus,
  Check,
  FolderInput,
  X,
} from 'lucide-react';
import { Folder, ScannyDocument, SystemPaths, formatDocumentType, suggestFolderId } from '../types';

interface InboxViewProps {
  documents: ScannyDocument[];
  folders: Folder[];
  onRefresh: () => Promise<void> | void;
  paths: SystemPaths | null;
  onOpenImportDialog: (docs?: ScannyDocument[]) => void;
  onSelectDocument: (doc: ScannyDocument) => void;
  onUploadFiles: (files: FileList | File[]) => Promise<void>;
  onRetryDocument: (id: number) => Promise<void>;
  isUploading?: boolean;
}

export function InboxView({
  documents,
  folders,
  onRefresh,
  paths,
  onOpenImportDialog,
  onSelectDocument,
  onUploadFiles,
  onRetryDocument,
  isUploading = false,
}: InboxViewProps) {
  const [isDropActive, setIsDropActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<number | null>(null);
  const [bulkFolderId, setBulkFolderId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Nur fertig aufbereitete Belege sind auswählbar / ablegbar
  const selectableDocs = documents.filter((d) => d.status === 'inbox');
  const selectedList = selectableDocs.filter((d) => selectedIds.has(d.id));

  // Auswahl bereinigen, wenn Belege den Eingang verlassen
  React.useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(selectableDocs.map((d) => d.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [documents]);

  const toggleSelect = (doc: ScannyDocument, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedId !== null) {
        // Bereich zwischen letzter Auswahl und diesem Beleg auswählen
        const ids = selectableDocs.map((d) => d.id);
        const a = ids.indexOf(lastClickedId);
        const b = ids.indexOf(doc.id);
        if (a >= 0 && b >= 0) {
          for (const id of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(id);
          return next;
        }
      }
      if (next.has(doc.id)) next.delete(doc.id);
      else next.add(doc.id);
      return next;
    });
    setLastClickedId(doc.id);
  };

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (msg: string) => {
    setActionMessage(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setActionMessage(null), 3500);
  };

  const fileDocuments = async (ids: number[], folderId: number) => {
    setBusy(true);
    try {
      const res = await fetch('/api/documents/file-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, folder_id: folderId }),
      });
      const data = await res.json().catch(() => null);
      const folder = folders.find((f) => f.id === folderId);
      if (!res.ok) throw new Error(data?.results?.[0]?.error || data?.error || 'Ablegen fehlgeschlagen.');
      flash(`${data.moved} ${data.moved === 1 ? 'Beleg' : 'Belege'} nach »${folder?.name ?? 'Ordner'}« abgelegt.`);
      setSelectedIds(new Set());
      await onRefresh();
    } catch (err: any) {
      flash(err?.message || 'Ablegen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayWatchDir = paths?.hostWatchDir || paths?.watchDir;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDropActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDropActive(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDropActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await onUploadFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await onUploadFiles(e.target.files);
      e.target.value = '';
    }
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return isoString.slice(0, 10);
    }
  };

  const formatAmount = (cents: number | null) => {
    if (cents === null || cents === undefined) return null;
    return (cents / 100).toLocaleString('de-DE', {
      style: 'currency',
      currency: 'EUR',
    });
  };

  return (
    <div id="inbox-view" className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Verstecktes Datei-Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.heic,.heif,.pdf"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-2.5">
            Eingang
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold">
              {documents.length}
            </span>
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Neue Belege erfassen, prüfen und für die Archivierung vorbereiten.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {selectableDocs.length > 0 && (
            <button
              type="button"
              id="inbox-select-all-btn"
              onClick={() =>
                setSelectedIds(
                  selectedList.length === selectableDocs.length ? new Set() : new Set(selectableDocs.map((d) => d.id))
                )
              }
              className="px-3 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {selectedList.length === selectableDocs.length ? 'Auswahl aufheben' : 'Alle auswählen'}
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Dateien wählen
          </button>

          <button
            type="button"
            id="inbox-check-all-btn"
            onClick={() => onOpenImportDialog(documents)}
            disabled={documents.length === 0}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Alle prüfen
          </button>
        </div>
      </div>

      {/* Dropzone am oberen Rand */}
      <div
        id="inbox-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-6 md:p-8 text-center transition-all cursor-pointer select-none ${
          isDropActive
            ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30 scale-[1.005]'
            : 'border-zinc-300 dark:border-zinc-700/80 bg-white dark:bg-zinc-900/40 hover:border-zinc-400 dark:hover:border-zinc-600'
        }`}
      >
        <div className="max-w-md mx-auto flex flex-col items-center">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-2 shadow-xs">
            {isUploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <UploadCloud className="w-5 h-5" />
            )}
          </div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {isUploading ? 'Dateien werden importiert…' : 'Dateien hierher ziehen oder klicken'}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
            iPhone-Fotos (HEIC, JPG), PNG oder PDF-Dokumente
          </p>
          {displayWatchDir && (
            <div className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
              <span>oder Upload-Ordner nutzen:</span>
              <code className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded font-mono">
                {displayWatchDir}
              </code>
            </div>
          )}
        </div>
      </div>

      {/* Aktionsleiste bei Mehrfachauswahl */}
      {(selectedList.length > 0 || actionMessage) && (
        <div
          id="inbox-bulk-bar"
          className="sticky top-16 z-20 flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50/95 dark:bg-blue-950/90 backdrop-blur-sm shadow-sm text-xs"
        >
          {selectedList.length > 0 && (
            <>
              <span className="font-semibold text-blue-800 dark:text-blue-200">
                {selectedList.length} ausgewählt
              </span>
              <select
                id="inbox-bulk-folder"
                value={bulkFolderId}
                onChange={(e) => setBulkFolderId(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 cursor-pointer"
              >
                <option value="">In Ordner verschieben…</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                id="inbox-bulk-move-btn"
                disabled={!bulkFolderId || busy}
                onClick={() => fileDocuments(selectedList.map((d) => d.id), parseInt(bulkFolderId, 10))}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderInput className="w-3.5 h-3.5" />}
                Verschieben
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto p-1 rounded-lg text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 cursor-pointer"
                title="Auswahl aufheben"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
          {actionMessage && (
            <span id="inbox-action-message" className="text-emerald-700 dark:text-emerald-300 font-medium">
              {actionMessage}
            </span>
          )}
        </div>
      )}

      {/* Dokumente Kachelraster */}
      {documents.length === 0 ? (
        <div className="py-16 text-center border border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/30 p-8">
          <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          </div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
            Eingang ist leer
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto mt-1">
            Alle Belege wurden geprüft und abgelegt. Ziehe neue Dateien hierher oder lege sie in den Upload-Ordner auf deinem Mac.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {documents.map((doc) => {
            const isProcessing = doc.status === 'processing' || doc.status === 'queued';
            const isError = doc.status === 'error';
            const formattedAmount = formatAmount(doc.amount_cents);

            // Kachel bei Fehler
            if (isError) {
              return (
                <div
                  key={doc.id}
                  id={`doc-card-${doc.id}`}
                  className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 p-4 flex flex-col justify-between min-h-[260px] shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between text-red-600 dark:text-red-400 mb-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <AlertCircle className="w-4 h-4" />
                        <span>Fehler beim Erfassen</span>
                      </div>
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/50">
                        {doc.source}
                      </span>
                    </div>

                    <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {doc.original_name}
                    </p>
                    <p className="text-[11px] text-red-600 dark:text-red-400 mt-2 line-clamp-3 bg-white/60 dark:bg-zinc-900/60 p-2 rounded-xl font-mono">
                      {doc.error || 'Unbekannter Fehler'}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-red-200 dark:border-red-900/40 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">
                      {formatDate(doc.created_at)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRetryDocument(doc.id)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Erneut versuchen
                    </button>
                  </div>
                </div>
              );
            }

            // Kachel bei laufender Verarbeitung
            if (isProcessing) {
              return (
                <div
                  key={doc.id}
                  id={`doc-card-${doc.id}`}
                  className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-4 flex flex-col justify-between min-h-[260px] shadow-xs"
                >
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                    <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      Wird aufbereitet…
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 truncate max-w-full">
                      {doc.original_name}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-blue-200 dark:border-blue-900/40 flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="flex items-center gap-1">
                      {doc.source === 'folder' ? (
                        <FolderIcon className="w-3 h-3" />
                      ) : (
                        <UploadCloud className="w-3 h-3" />
                      )}
                      {doc.source === 'folder' ? 'Upload-Ordner' : 'Web-Upload'}
                    </span>
                    <span>{formatDate(doc.created_at)}</span>
                  </div>
                </div>
              );
            }

            // Normale Kachel (bereit zur Prüfung oder bereits im Eingang)
            const isSelected = selectedIds.has(doc.id);
            const suggestedFolder = folders.find((f) => f.id === suggestFolderId(folders, doc.doc_date));
            return (
              <div
                key={doc.id}
                id={`doc-card-${doc.id}`}
                onClick={(e) => {
                  // Bei aktiver Auswahl wählt ein Klick (bzw. Shift-Klick) aus statt zu öffnen
                  if (selectedIds.size > 0 || e.shiftKey) toggleSelect(doc, e.shiftKey);
                  else onSelectDocument(doc);
                }}
                className={`group relative rounded-2xl border bg-white dark:bg-zinc-900 transition-all cursor-pointer overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-md ${
                  isSelected
                    ? 'border-blue-500 ring-2 ring-blue-500/40'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-blue-400 dark:hover:border-blue-600/80'
                }`}
              >
                {/* Auswahl-Checkbox */}
                <button
                  type="button"
                  id={`doc-select-${doc.id}`}
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label="Beleg auswählen"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(doc, e.shiftKey);
                  }}
                  className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 border-blue-600 text-white opacity-100'
                      : `bg-white/90 dark:bg-zinc-900/90 border-zinc-300 dark:border-zinc-600 text-transparent ${
                          selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                {/* Vorschaubild */}
                <div className="h-44 bg-zinc-100 dark:bg-zinc-950/80 flex items-center justify-center overflow-hidden relative border-b border-zinc-100 dark:border-zinc-800/80">
                  {doc.thumb_path ? (
                    <img
                      src={`/api/documents/${doc.id}/thumb?v=${encodeURIComponent(doc.updated_at || '')}`}
                      alt={doc.title || doc.original_name}
                      className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
                      <FileText className="w-10 h-10 mb-1 opacity-60" />
                      <span className="text-[10px] uppercase font-mono tracking-wider">
                        {doc.original_name.split('.').pop()}
                      </span>
                    </div>
                  )}

                  {/* Betrag Badge oben rechts falls vorhanden */}
                  {formattedAmount && (
                    <div className="absolute top-2.5 right-2.5 bg-zinc-900/80 backdrop-blur-xs text-white text-[11px] font-mono font-medium px-2 py-0.5 rounded-lg shadow-xs">
                      {formattedAmount}
                    </div>
                  )}

                  {/* Duplikat-Badge */}
                  {doc.duplicate_of_id && (
                    <div
                      className="absolute top-2.5 left-17 bg-amber-500/90 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-md shadow-xs flex items-center gap-1"
                      title={`Vermutlich doppelt zu »${doc.duplicate_of_title || 'Dokument #' + doc.duplicate_of_id}«`}
                    >
                      <span>Doppelt?</span>
                    </div>
                  )}

                  {/* Ränder nicht erkannt Badge */}
                  {(doc.detected === 0 || doc.detected === false) && (
                    <div
                      className="absolute bottom-2.5 left-2.5 bg-amber-500/95 backdrop-blur-xs text-white text-[10px] font-semibold px-2 py-0.5 rounded-lg shadow-xs flex items-center gap-1"
                      title="Ränder nicht erkannt – bitte prüfen"
                    >
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>Ränder prüfen</span>
                    </div>
                  )}

                  {/* Seitenzahl-Badge wenn > 1 */}
                  {doc.page_count !== null && doc.page_count !== undefined && doc.page_count > 1 && (
                    <div
                      id={`doc-tile-pages-${doc.id}`}
                      className="absolute bottom-2.5 right-2.5 bg-zinc-900/80 backdrop-blur-xs text-white text-[10px] font-mono font-medium px-2 py-0.5 rounded-md shadow-xs flex items-center gap-1"
                      title={`${doc.page_count} Seiten`}
                    >
                      <FileText className="w-3 h-3 text-zinc-300" />
                      <span>{doc.page_count} Seiten</span>
                    </div>
                  )}

                  {/* Quelle oben links */}
                  <div
                    className="absolute top-2.5 left-10 bg-white/90 dark:bg-zinc-900/90 text-zinc-600 dark:text-zinc-300 p-1 rounded-md shadow-xs"
                    title={doc.source === 'folder' ? 'Aus Upload-Ordner' : 'Per Web hochgeladen'}
                  >
                    {doc.source === 'folder' ? (
                      <FolderIcon className="w-3 h-3 text-amber-500" />
                    ) : (
                      <UploadCloud className="w-3 h-3 text-blue-500" />
                    )}
                  </div>
                </div>

                {/* Details unter dem Bild */}
                <div className="p-3.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {doc.title || doc.original_name}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                      <span className="truncate">{doc.sender || formatDocumentType(doc.doc_type) || 'Beleg'}</span>
                      {doc.doc_date && (
                        <span className="font-mono shrink-0 ml-1 text-zinc-400">
                          {formatDate(doc.doc_date)}
                        </span>
                      )}
                    </div>

                    {(doc.detected === 0 || doc.detected === false) && (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">Ränder nicht erkannt – bitte prüfen</span>
                      </div>
                    )}
                  </div>

                  {suggestedFolder && (
                    <button
                      type="button"
                      id={`doc-suggest-file-${doc.id}`}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        fileDocuments([doc.id], suggestedFolder.id);
                      }}
                      className="mt-2.5 w-full px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                      title="In den vorgeschlagenen Ordner ablegen"
                    >
                      <ArrowRight className="w-3 h-3" />
                      <span className="truncate">{suggestedFolder.name} ablegen</span>
                    </button>
                  )}

                  {/* Fußzeile mit Erfassungsdatum */}
                  <div className="mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Erfasst: {formatDate(doc.created_at)}
                    </span>
                    <span className="text-blue-600 dark:text-blue-400 font-medium group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                      Prüfen <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
