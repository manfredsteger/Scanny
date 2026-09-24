import React, { useState, useEffect } from 'react';
import {
  X,
  Trash2,
  Save,
  ExternalLink,
  Loader2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  RotateCw,
  Image as ImageIcon,
  AlignLeft,
  Copy,
  Check,
  Crop,
  Layers,
  Scissors,
  Plus,
  Undo2,
} from 'lucide-react';
import {
  Folder,
  ScannyDocument,
  DocumentFormData,
  DocumentPageInfo,
  HighlightField,
  hasEditableImage,
  pdfPreviewUrl,
  TRASH_RETENTION_DAYS,
  highlightSpan,
  parseExtraction,
} from '../types';
import { DocumentForm } from './DocumentForm';
import { OcrTextView } from './OcrTextView';
import { CornerEditor } from './CornerEditor';
import { DeleteConfirmModal } from './DeleteConfirmModal';

interface DocumentDetailDrawerProps {
  document: ScannyDocument | null;
  folders: Folder[];
  /** Fertig aufbereitete Belege im Eingang – Auswahl für "Seite hinzufügen". */
  inboxDocuments?: ScannyDocument[];
  onClose: () => void;
  onRefresh: () => void;
  onOpenDocument?: (id: number) => void;
  onDeleteDocument: (id: number) => Promise<void>;
  onRestoreDocument?: (id: number) => Promise<void>;
  onPurgeDocument?: (id: number) => Promise<void>;
}

export function DocumentDetailDrawer({
  document,
  folders,
  inboxDocuments = [],
  onClose,
  onRefresh,
  onOpenDocument,
  onDeleteDocument,
  onRestoreDocument,
  onPurgeDocument,
}: DocumentDetailDrawerProps) {
  const [localDoc, setLocalDoc] = useState<ScannyDocument | null>(document);
  const [formData, setFormData] = useState<DocumentFormData | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [previewMode, setPreviewMode] = useState<'processed' | 'original'>('processed');
  const [activeTab, setActiveTab] = useState<'preview' | 'pdf' | 'text'>('preview');
  const [copied, setCopied] = useState(false);
  const [hoveredField, setHoveredField] = useState<HighlightField>(null);
  const [isCornerEditorOpen, setIsCornerEditorOpen] = useState(false);
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
  const [pageAction, setPageAction] = useState<'idle' | 'adding' | 'splitting' | 'restoring'>('idle');
  const [addPageId, setAddPageId] = useState<string>('');
  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pages, setPages] = useState<DocumentPageInfo[]>([]);
  const [isSplitWarningOpen, setIsSplitWarningOpen] = useState(false);

  const handleCopyOcrText = async () => {
    if (!localDoc?.ocr_text) return;
    try {
      await navigator.clipboard.writeText(localDoc.ocr_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Fehler beim Kopieren:', err);
    }
  };

  useEffect(() => {
    setLocalDoc(document);
    if (document) {
      const nurPdf = !hasEditableImage(document);
      setActiveTab((prev) => (nurPdf ? 'pdf' : prev === 'pdf' ? 'preview' : prev));
      let userEditedArr: string[] = [];
      if (document.user_edited) {
        try {
          const parsed = JSON.parse(document.user_edited);
          userEditedArr = Array.isArray(parsed) ? parsed : [];
        } catch {
          userEditedArr = document.user_edited.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }

      const rawCents = document.amount_cents;
      const amountStr =
        rawCents !== null && rawCents !== undefined
          ? (rawCents / 100).toFixed(2).replace('.', ',')
          : '';

      setFormData({
        title: document.title || '',
        sender: document.sender || '',
        doc_type: document.doc_type || '',
        doc_date: document.doc_date || '',
        amount_cents: document.amount_cents,
        amount_str: amountStr,
        folder_id: document.folder_id,
        user_edited: userEditedArr,
      });
    } else {
      setFormData(null);
    }
    setSavedSuccess(false);
    setAddPageId('');
    setPageMessage(null);
    setPageError(null);
    setPageAction('idle');
    setPages([]);
    setIsSplitWarningOpen(false);
  }, [document?.id]);

  // Herkunft der Seiten laden, sobald das Dokument zusammengefügt ist. Fehlt eine Quelle
  // (endgültig gelöscht), muss vor dem Trennen gewarnt werden – diese Seite geht dabei verloren.
  useEffect(() => {
    const id = localDoc?.id;
    if (!id || !localDoc?.merged_pages) {
      setPages([]);
      return;
    }
    let abgebrochen = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${id}/pages`);
        if (res.ok && !abgebrochen) setPages(await res.json());
      } catch (err) {
        console.error('Seiten konnten nicht geladen werden:', err);
      }
    })();
    return () => {
      abgebrochen = true;
    };
  }, [localDoc?.id, localDoc?.merged_pages]);

  // Esc schließt den Drawer – aber nicht, wenn darüber noch ein Dialog offen ist
  // (Ecken-Editor, Löschen-Bestätigung) oder gerade in einem Feld getippt wird.
  useEffect(() => {
    if (!document) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isCornerEditorOpen || isDeleteModalOpen || isPurgeModalOpen || isSplitWarningOpen) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [document, isCornerEditorOpen, isDeleteModalOpen, isPurgeModalOpen, isSplitWarningOpen, onClose]);

  // Polling wenn das Dokument neu aufbereitet wird
  useEffect(() => {
    if (!localDoc || (localDoc.status !== 'queued' && localDoc.status !== 'processing')) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/documents/${localDoc.id}`);
        if (res.ok) {
          const fresh = await res.json();
          setLocalDoc(fresh);
          if (fresh.status !== 'queued' && fresh.status !== 'processing') {
            onRefresh();
          }
        }
      } catch (err) {
        console.error('Fehler beim Pollen des Dokuments:', err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [localDoc?.id, localDoc?.status, onRefresh]);

  if (!document) return null;

  const handleSave = async () => {
    if (!formData) return;
    setIsSaving(true);
    try {
      const payload = {
        title: formData.title,
        sender: formData.sender,
        doc_type: formData.doc_type,
        doc_date: formData.doc_date || null,
        amount_cents: formData.amount_cents,
        folder_id: formData.folder_id,
        user_edited: JSON.stringify(formData.user_edited),
      };

      const res = await fetch(`/api/documents/${document.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('Speichern fehlgeschlagen');
      }

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
      onRefresh();
    } catch (err) {
      console.error('Fehler beim Speichern:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDeleteDocument(document.id);
      setIsDeleteModalOpen(false);
      onClose();
      onRefresh();
    } catch (err) {
      console.error('Fehler beim Löschen:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Schnellaktion: Drehung ändern ("↺ 90°", "↻ 90°")
  const handleRotate = async (direction: 'cw' | 'ccw') => {
    if (!localDoc) return;
    const cur = localDoc.rotation || 0;
    const next = direction === 'cw' ? (cur + 90) % 360 : (cur - 90 + 360) % 360;
    setLocalDoc((prev) => (prev ? { ...prev, rotation: next, status: 'processing' } : null));
    setPreviewMode('processed');

    try {
      const res = await fetch(`/api/documents/${localDoc.id}/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotation: next }),
      });
      if (res.ok) {
        const fresh = await res.json();
        setLocalDoc(fresh);
      }
    } catch (err) {
      console.error('Fehler beim Drehen:', err);
    }
  };

  // Schnellaktion: Farbmodus ändern ("S/W | Grau | Farbe")
  const handleColorMode = async (mode: 'bw' | 'gray' | 'color') => {
    if (!localDoc || localDoc.color_mode === mode) return;
    setLocalDoc((prev) => (prev ? { ...prev, color_mode: mode, status: 'processing' } : null));
    setPreviewMode('processed');

    try {
      const res = await fetch(`/api/documents/${localDoc.id}/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color_mode: mode }),
      });
      if (res.ok) {
        const fresh = await res.json();
        setLocalDoc(fresh);
      }
    } catch (err) {
      console.error('Fehler beim Ändern des Farbmodus:', err);
    }
  };

  // Eine Seite anhängen: erzeugt serverseitig ein NEUES zusammengefügtes Dokument,
  // das Titel, Datum und Ordner dieses Belegs übernimmt – der Drawer springt darauf um.
  const handleAddPage = async () => {
    if (!localDoc || !addPageId) return;
    setPageAction('adding');
    setPageError(null);
    setPageMessage(null);
    try {
      const res = await fetch(`/api/documents/${localDoc.id}/add-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: parseInt(addPageId, 10) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Seite konnte nicht angehängt werden.');
      setAddPageId('');
      onRefresh();
      if (data?.id && onOpenDocument) onOpenDocument(data.id);
      else if (data) setLocalDoc(data);
    } catch (err: any) {
      setPageError(err?.message || 'Seite konnte nicht angehängt werden.');
    } finally {
      setPageAction('idle');
    }
  };

  // Zusammengefügtes Dokument wieder in Einzelbelege trennen
  const handleSplit = async () => {
    if (!localDoc) return;
    setIsSplitWarningOpen(false);
    setPageAction('splitting');
    setPageError(null);
    setPageMessage(null);
    try {
      const res = await fetch(`/api/documents/${localDoc.id}/split`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Dokument konnte nicht getrennt werden.');
      onRefresh();
      onClose();
    } catch (err: any) {
      setPageError(err?.message || 'Dokument konnte nicht getrennt werden.');
    } finally {
      setPageAction('idle');
    }
  };

  const handleRestore = async () => {
    if (!localDoc || !onRestoreDocument) return;
    setPageAction('restoring');
    setPageError(null);
    try {
      await onRestoreDocument(localDoc.id);
      onClose();
    } catch (err: any) {
      setPageError(err?.message || 'Wiederherstellen fehlgeschlagen.');
    } finally {
      setPageAction('idle');
    }
  };

  const handleConfirmPurge = async () => {
    if (!localDoc || !onPurgeDocument) return;
    setIsDeleting(true);
    try {
      await onPurgeDocument(localDoc.id);
      setIsPurgeModalOpen(false);
      onClose();
    } catch (err: any) {
      setPageError(err?.message || 'Endgültiges Löschen fehlgeschlagen.');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!document || !localDoc) return null;

  const isTrashed = Boolean(localDoc.deleted_at);
  const mergedPages = localDoc.merged_pages || 0;
  // Seiten, deren Quellbeleg endgültig gelöscht wurde – sie gehen beim Trennen verloren
  const lostPages = pages.filter((p) => p.source_document_id === null).length;
  const isBusyWithPages = pageAction !== 'idle';
  const addableDocuments = inboxDocuments.filter((d) => d.id !== localDoc.id && !d.deleted_at);

  const isPdf = Boolean(localDoc.original_name.toLowerCase().endsWith('.pdf'));
  // Zusammengefügte Belege haben kein Original und kein Scanbild – sie werden wie PDFs angezeigt
  const hasImage = hasEditableImage(localDoc);
  const isHeic = () => {
    const name = localDoc.original_name.toLowerCase();
    return name.endsWith('.heic') || name.endsWith('.heif');
  };

  const v = localDoc.updated_at ? `?v=${encodeURIComponent(localDoc.updated_at)}` : '';
  const originalUrl = isHeic()
    ? `/api/documents/${localDoc.id}/work-preview${v}`
    : `/api/documents/${localDoc.id}/original${v}`;
  const scanUrl = `/api/documents/${localDoc.id}/scan${v}`;
  const displayedImgUrl =
    previewMode === 'processed' && (localDoc.status === 'inbox' || localDoc.status === 'filed')
      ? scanUrl
      : originalUrl;

  return (
    <>
      {isCornerEditorOpen && localDoc && (
        <CornerEditor
          document={localDoc}
          onClose={() => setIsCornerEditorOpen(false)}
          onApplied={async () => {
            setLocalDoc((prev) => (prev ? { ...prev, status: 'queued' } : prev));
            onRefresh();
          }}
        />
      )}
      <div id="document-detail-overlay" className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-xs">
        <div
          id="document-detail-drawer"
          className="w-full max-w-xl bg-white dark:bg-zinc-900 h-full shadow-2xl flex flex-col border-l border-zinc-200 dark:border-zinc-800 animate-in slide-in-from-right duration-200"
          role="dialog"
          aria-modal="true"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/40">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                  {document.title || document.original_name}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {document.original_name}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {isTrashed ? (
                <>
                  <button
                    type="button"
                    id="drawer-restore-btn"
                    disabled={isBusyWithPages}
                    onClick={handleRestore}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    title="Beleg aus dem Papierkorb zurückholen"
                  >
                    {pageAction === 'restoring' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Undo2 className="w-3.5 h-3.5" />
                    )}
                    Wiederherstellen
                  </button>
                  <button
                    type="button"
                    id="drawer-purge-btn"
                    onClick={() => setIsPurgeModalOpen(true)}
                    className="p-2 rounded-xl text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                    title="Endgültig löschen"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  id="drawer-delete-btn"
                  onClick={() => setIsDeleteModalOpen(true)}
                  className="p-2 rounded-xl text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                  title="In den Papierkorb legen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                id="drawer-close-btn"
                onClick={onClose}
                className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Schließen"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Inhalt: Vorschau + Formular */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Hinweis: Beleg liegt im Papierkorb */}
            {isTrashed && (
              <div
                id="drawer-trash-notice"
                className="p-3 bg-zinc-100 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-700 dark:text-zinc-300 flex items-start gap-2.5"
              >
                <Trash2 className="w-4 h-4 shrink-0 mt-0.5 text-zinc-500" />
                <div className="leading-snug">
                  <p className="font-semibold">Dieser Beleg liegt im Papierkorb</p>
                  <p className="mt-0.5 opacity-80">
                    Bearbeiten ist erst nach dem Wiederherstellen möglich. Nach {TRASH_RETENTION_DAYS} Tagen
                    wird er automatisch endgültig gelöscht.
                  </p>
                </div>
              </div>
            )}

            {/* Duplikat-Hinweis */}
            {localDoc.duplicate_of_id && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-snug">
                  <p className="font-semibold">Vermutlich doppelt</p>
                  <p className="mt-0.5 opacity-90">
                    Gleiche Datei wie »<span className="underline font-medium">{localDoc.duplicate_of_title || `Dokument #${localDoc.duplicate_of_id}`}</span>«.
                  </p>
                </div>
              </div>
            )}

            {/* Warnung: Ränder nicht erkannt */}
            {(localDoc.detected === 0 || localDoc.detected === false) && (
              <div
                id="drawer-edge-warning"
                className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2.5 shadow-xs"
              >
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="font-semibold">Ränder nicht erkannt – bitte prüfen</span>
              </div>
            )}

            {/* Vorschau- & Dokumentenbereich mit Tabs */}
            <div className="space-y-3">
              {/* Tab-Navigation: Vorschau | PDF | Text */}
              <div className="flex items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-2">
                <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl border border-zinc-200/80 dark:border-zinc-800">
                  <button
                    type="button"
                    id="drawer-tab-preview"
                    onClick={() => setActiveTab('preview')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'preview'
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs font-semibold'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>Vorschau</span>
                  </button>
                  <button
                    type="button"
                    id="drawer-tab-pdf"
                    onClick={() => setActiveTab('pdf')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'pdf'
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs font-semibold'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>PDF</span>
                    {localDoc.page_count !== null && localDoc.page_count !== undefined && localDoc.page_count > 1 && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-mono">
                        {localDoc.page_count}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    id="drawer-tab-text"
                    onClick={() => setActiveTab('text')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'text'
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs font-semibold'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    <AlignLeft className="w-3.5 h-3.5" />
                    <span>Text</span>
                    {localDoc.ocr_text && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Text vorhanden" />
                    )}
                  </button>
                </div>

                {localDoc.page_count !== null && localDoc.page_count !== undefined && localDoc.page_count > 1 && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                    {localDoc.page_count} Seiten
                  </span>
                )}
              </div>

              {/* Tab 1: Vorschau (Bild mit Aufbereitet/Original Umschalter und Schnellaktionen) */}
              {activeTab === 'preview' && (
                <div className="space-y-2.5">
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-950 p-2 flex items-center justify-center relative min-h-[220px] max-h-[320px] overflow-hidden">
                    {/* Umschalter Aufbereitet | Original oben rechts (nur bei Nicht-PDF) */}
                    {hasImage && (
                      <div
                        id="drawer-preview-mode-toggle"
                        className="absolute top-3 right-3 z-20 flex items-center bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xs p-0.5 rounded-xl border border-zinc-200/90 dark:border-zinc-800 shadow-sm text-xs font-medium"
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewMode('processed')}
                          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                            previewMode === 'processed'
                              ? 'bg-blue-600 text-white font-semibold shadow-xs'
                              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                          }`}
                        >
                          Aufbereitet
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewMode('original')}
                          className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                            previewMode === 'original'
                              ? 'bg-blue-600 text-white font-semibold shadow-xs'
                              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                          }`}
                        >
                          Original
                        </button>
                      </div>
                    )}

                    {!hasImage ? (
                      <iframe
                        src={pdfPreviewUrl(localDoc)}
                        title="PDF Vorschau"
                        className="w-full h-64 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white"
                      />
                    ) : (
                      <img
                        key={`${localDoc.id}-${previewMode}-${localDoc.updated_at}`}
                        src={displayedImgUrl}
                        alt={localDoc.original_name}
                        className="max-h-64 object-contain rounded-lg shadow-xs"
                      />
                    )}

                    {/* Overlay bei laufender Aufbereitung */}
                    {(localDoc.status === 'processing' || localDoc.status === 'queued') && (
                      <div className="absolute inset-0 bg-black/45 backdrop-blur-xs flex flex-col items-center justify-center text-white rounded-xl z-30">
                        <Loader2 className="w-8 h-8 animate-spin mb-2 text-blue-400" />
                        <p className="text-xs font-semibold">Wird aufbereitet…</p>
                      </div>
                    )}

                    <a
                      href={displayedImgUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute bottom-3 right-3 z-10 bg-white/90 dark:bg-zinc-800/90 text-zinc-700 dark:text-zinc-200 px-2.5 py-1 rounded-lg text-xs font-medium shadow-xs hover:bg-white dark:hover:bg-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Vollbild
                    </a>
                  </div>

                  {/* Schnellaktionen unter der Vorschau (Drehung + Farbmodus) */}
                  {hasImage && (
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                      {/* Drehung + Zuschnitt */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          id="drawer-open-corner-editor"
                          disabled={localDoc.status === 'processing' || localDoc.status === 'queued'}
                          onClick={() => setIsCornerEditorOpen(true)}
                          className="px-3 py-1.5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Ecken des Belegs manuell festlegen"
                        >
                          <Crop className="w-3.5 h-3.5" />
                          <span>Zuschnitt anpassen</span>
                        </button>
                        <button
                          type="button"
                          id="drawer-quick-rotate-ccw"
                          disabled={localDoc.status === 'processing' || localDoc.status === 'queued'}
                          onClick={() => handleRotate('ccw')}
                          className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Gegen den Uhrzeigersinn um 90° drehen (↺ 90°)"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>↺ 90°</span>
                        </button>
                        <button
                          type="button"
                          id="drawer-quick-rotate-cw"
                          disabled={localDoc.status === 'processing' || localDoc.status === 'queued'}
                          onClick={() => handleRotate('cw')}
                          className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Im Uhrzeigersinn um 90° drehen (↻ 90°)"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                          <span>↻ 90°</span>
                        </button>
                      </div>

                      {/* Farbmodus */}
                      <div className="flex items-center rounded-xl bg-zinc-200/80 dark:bg-zinc-800 p-0.5 text-xs font-medium">
                        <button
                          type="button"
                          id="drawer-quick-mode-bw"
                          disabled={localDoc.status === 'processing' || localDoc.status === 'queued'}
                          onClick={() => handleColorMode('bw')}
                          className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                            localDoc.color_mode === 'bw'
                              ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white font-semibold shadow-xs'
                              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          S/W
                        </button>
                        <button
                          type="button"
                          id="drawer-quick-mode-gray"
                          disabled={localDoc.status === 'processing' || localDoc.status === 'queued'}
                          onClick={() => handleColorMode('gray')}
                          className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                            localDoc.color_mode === 'gray'
                              ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white font-semibold shadow-xs'
                              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          Grau
                        </button>
                        <button
                          type="button"
                          id="drawer-quick-mode-color"
                          disabled={localDoc.status === 'processing' || localDoc.status === 'queued'}
                          onClick={() => handleColorMode('color')}
                          className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                            localDoc.color_mode === 'color'
                              ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white font-semibold shadow-xs'
                              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          Farbe
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: PDF (eingebettetes PDF/A aus /api/documents/:id/pdf) */}
              {activeTab === 'pdf' && (
                <div className="space-y-2">
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-950 p-2 flex flex-col relative h-[360px] overflow-hidden">
                    {localDoc.pdf_path ? (
                      <iframe
                        id="drawer-pdf-frame"
                        src={`/api/documents/${localDoc.id}/pdf`}
                        title="PDF Dokument"
                        className="w-full h-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-zinc-400 text-center p-6 space-y-2">
                        <FileText className="w-10 h-10 opacity-40 mb-1" />
                        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                          PDF wird erzeugt…
                        </p>
                        <p className="text-[11px] text-zinc-500 max-w-xs leading-relaxed">
                          Sobald die Texterkennung abgeschlossen ist, wird das durchsuchbare PDF/A hier angezeigt.
                        </p>
                      </div>
                    )}

                    {localDoc.pdf_path && (
                      <a
                        id="drawer-open-pdf-external"
                        href={`/api/documents/${localDoc.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="absolute bottom-3 right-3 z-10 bg-white/95 dark:bg-zinc-800/95 text-zinc-700 dark:text-zinc-200 px-2.5 py-1 rounded-lg text-xs font-medium shadow-xs hover:bg-white dark:hover:bg-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer border border-zinc-200 dark:border-zinc-700"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Im neuen Tab öffnen
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Text (erkannter OCR-Text, monospace & kopierbar) */}
              {activeTab === 'text' && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3.5 flex flex-col relative min-h-[260px] max-h-[380px] space-y-2.5">
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                        Erkannter Text (OCR)
                      </span>
                      {localDoc.ocr_text && (
                        <span className="text-[10px] text-zinc-400 font-mono">
                          {localDoc.ocr_text.length} Zeichen
                        </span>
                      )}
                    </div>
                    {localDoc.ocr_text && (
                      <button
                        type="button"
                        id="drawer-copy-text-btn"
                        onClick={handleCopyOcrText}
                        className="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Text in Zwischenablage kopieren"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Kopiert!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Kopieren</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {localDoc.ocr_text ? (
                    <OcrTextView
                      id="drawer-ocr-text-display"
                      text={localDoc.ocr_text}
                      highlight={highlightSpan(parseExtraction(localDoc), hoveredField)}
                      className="flex-1"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center flex-1 text-center p-6 text-zinc-400">
                      <AlignLeft className="w-8 h-8 opacity-40 mb-2" />
                      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                        Kein Text erkannt oder Texterkennung läuft noch.
                      </p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
                        Sobald die OCR abgeschlossen ist, erscheint der extrahierte Text hier.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Seiten: zusammengefügte Belege trennen, weitere Seite anhängen */}
            {!isTrashed && (
              <div id="drawer-pages-section" className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Seiten
                </h3>

                {mergedPages > 0 && (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40">
                    <div className="flex items-center gap-2.5 min-w-0 text-xs text-zinc-700 dark:text-zinc-300">
                      <Layers className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
                      <span className="leading-snug">
                        Aus <span className="font-semibold">{mergedPages} Belegen</span> zusammengefügt.
                        {lostPages > 0 ? (
                          <span className="block text-amber-700 dark:text-amber-400 font-medium mt-0.5">
                            {lostPages} {lostPages === 1 ? 'Seite ist' : 'Seiten sind'} endgültig gelöscht und
                            {lostPages === 1 ? ' geht' : ' gehen'} beim Trennen verloren.
                          </span>
                        ) : (
                          ' Die Einzelbelege liegen im Papierkorb.'
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      id="drawer-split-btn"
                      disabled={isBusyWithPages}
                      onClick={() => (lostPages > 0 ? setIsSplitWarningOpen(true) : handleSplit())}
                      className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-zinc-900 transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                      title="Die ursprünglichen Belege wiederherstellen und dieses Dokument verwerfen"
                    >
                      {pageAction === 'splitting' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Scissors className="w-3.5 h-3.5" />
                      )}
                      Seiten wieder trennen
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <select
                    id="drawer-add-page-select"
                    value={addPageId}
                    onChange={(e) => setAddPageId(e.target.value)}
                    disabled={isBusyWithPages || addableDocuments.length === 0}
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {addableDocuments.length === 0
                        ? 'Kein Beleg im Eingang zum Anhängen'
                        : 'Seite aus dem Eingang anhängen…'}
                    </option>
                    {addableDocuments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title || d.original_name}
                        {d.page_count > 1 ? ` (${d.page_count} Seiten)` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    id="drawer-add-page-btn"
                    disabled={!addPageId || isBusyWithPages}
                    onClick={handleAddPage}
                    className="shrink-0 px-3 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {pageAction === 'adding' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    Seite hinzufügen
                  </button>
                </div>

                {pageError && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{pageError}</span>
                  </p>
                )}
                {pageMessage && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{pageMessage}</p>
                )}
              </div>
            )}

            {/* Metadaten Formular */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
                Belegdaten
              </h3>
              {formData && (
                <DocumentForm
                  document={localDoc}
                  folders={folders}
                  value={formData}
                  onChange={setFormData}
                  onHoverField={setHoveredField}
                />
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-800/60 flex items-center justify-between">
            <div>
              {savedSuccess && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4" />
                  Gespeichert
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                id="drawer-cancel-btn"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Schließen
              </button>
              <button
                type="button"
                id="drawer-save-btn"
                onClick={handleSave}
                disabled={isSaving || !formData || isTrashed}
                title={isTrashed ? 'Beleg liegt im Papierkorb – erst wiederherstellen' : undefined}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Speichern
              </button>
            </div>
          </div>
        </div>
      </div>

      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        title="In den Papierkorb legen"
        message={`»${document.title || document.original_name}« wandert in den Papierkorb und wird nach ${TRASH_RETENTION_DAYS} Tagen endgültig gelöscht. Bis dahin lässt sich der Beleg jederzeit wiederherstellen.`}
        confirmText="In den Papierkorb"
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsDeleteModalOpen(false)}
      />

      <DeleteConfirmModal
        isOpen={isSplitWarningOpen}
        title="Seiten trennen?"
        message={`Von diesem Dokument ${lostPages === 1 ? 'wurde 1 Seite' : `wurden ${lostPages} Seiten`} bereits endgültig gelöscht. Beim Trennen ${lostPages === 1 ? 'geht diese Seite' : 'gehen diese Seiten'} unwiderruflich verloren, weil das zusammengefügte Dokument dabei verworfen wird.`}
        confirmText="Trotzdem trennen"
        isDeleting={pageAction === 'splitting'}
        onConfirm={handleSplit}
        onCancel={() => setIsSplitWarningOpen(false)}
      />

      <DeleteConfirmModal
        isOpen={isPurgeModalOpen}
        title="Endgültig löschen"
        message={`»${document.title || document.original_name}« wird unwiderruflich gelöscht – samt Originaldatei, PDF und Vorschau. Das lässt sich nicht rückgängig machen.`}
        confirmText="Unwiderruflich löschen"
        isDeleting={isDeleting}
        onConfirm={handleConfirmPurge}
        onCancel={() => setIsPurgeModalOpen(false)}
      />
    </>
  );
}
