import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  CheckCircle2,
  Loader2,
  AlertCircle,
  FileText,
  Copy,
  ArrowRight,
  CheckCheck,
  RotateCcw,
  RotateCw,
  AlertTriangle,
} from 'lucide-react';
import {
  Folder,
  ScannyDocument,
  DocumentFormData,
  HighlightField,
  formatDocumentType,
  highlightSpan,
  parseExtraction,
  suggestFolderId,
} from '../types';
import { DocumentForm } from './DocumentForm';
import { OcrTextView } from './OcrTextView';

interface ImportDialogProps {
  isOpen: boolean;
  batchDocuments: ScannyDocument[];
  folders: Folder[];
  onClose: () => void;
  onRefresh: () => void;
  onSelectDocument?: (doc: ScannyDocument) => void;
}

export function ImportDialog({
  isOpen,
  batchDocuments: initialDocs,
  folders,
  onClose,
  onRefresh,
}: ImportDialogProps) {
  const [documents, setDocuments] = useState<ScannyDocument[]>(initialDocs);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [formDataMap, setFormDataMap] = useState<Record<number, DocumentFormData>>({});
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'processed' | 'original' | 'text'>('processed');
  const [hoveredField, setHoveredField] = useState<HighlightField>(null);

  // Hilfsfunktion zum Erzeugen der Standard-Formulardaten für ein Dokument
  const getInitialFormData = useCallback(
    (doc: ScannyDocument, currentFolders: Folder[]): DocumentFormData => {
      let userEditedArr: string[] = [];
      if (doc.user_edited) {
        try {
          const parsed = JSON.parse(doc.user_edited);
          userEditedArr = Array.isArray(parsed) ? parsed : [];
        } catch {
          userEditedArr = doc.user_edited.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }

      const rawCents = doc.amount_cents;
      const amountStr =
        rawCents !== null && rawCents !== undefined
          ? (rawCents / 100).toFixed(2).replace('.', ',')
          : '';

      // Passenden Ordner für das Jahr vorschlagen (falls noch nicht manuell editiert)
      let autoFolderId = doc.folder_id;
      if (!autoFolderId && !userEditedArr.includes('folder_id')) {
        autoFolderId = suggestFolderId(currentFolders, doc.doc_date || doc.file_date || doc.created_at);
      }

      return {
        title: doc.title || '',
        sender: doc.sender || '',
        doc_type: doc.doc_type || '',
        doc_date: doc.doc_date || '',
        amount_cents: doc.amount_cents,
        amount_str: amountStr,
        folder_id: autoFolderId,
        user_edited: userEditedArr,
      };
    },
    []
  );

  // Synchronisieren, wenn sich initialDocs ändert
  useEffect(() => {
    setDocuments(initialDocs);
    setSelectedIndex(0);

    // Initialisiere formDataMap für alle übergebenen Dokumente
    setFormDataMap((prev) => {
      const nextMap = { ...prev };
      for (const doc of initialDocs) {
        if (!nextMap[doc.id]) {
          nextMap[doc.id] = getInitialFormData(doc, folders);
        }
      }
      return nextMap;
    });
  }, [initialDocs, folders, getInitialFormData]);

  // Ausgewähltes Dokument
  const currentDoc = documents[selectedIndex] || documents[0];

  // Aktuelle Formulardaten des ausgewählten Dokuments
  const getCurrentFormData = useCallback(
    (doc: ScannyDocument): DocumentFormData => {
      if (formDataMap[doc.id]) {
        return formDataMap[doc.id];
      }
      return getInitialFormData(doc, folders);
    },
    [formDataMap, folders, getInitialFormData]
  );

  // Pfeiltasten Navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement as HTMLElement)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, documents.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, documents.length, onClose]);

  // Live-Polling während der Dialog geöffnet ist (alle 2 Sekunden)
  useEffect(() => {
    if (!isOpen || documents.length === 0) return;

    const hasUnfinished = documents.some((d) => d.status === 'queued' || d.status === 'processing');
    if (!hasUnfinished) return;

    const pollInterval = setInterval(async () => {
      try {
        const ids = documents.map((d) => d.id);
        const updatedList: ScannyDocument[] = [];

        for (const id of ids) {
          const res = await fetch(`/api/documents/${id}`);
          if (res.ok) {
            const data = await res.json();
            updatedList.push(data);
          }
        }

        if (updatedList.length > 0) {
          setDocuments((prev) =>
            prev.map((doc) => {
              const fresh = updatedList.find((u) => u.id === doc.id);
              return fresh ? { ...doc, ...fresh } : doc;
            })
          );

          // Nur Felder in formDataMap aktualisieren, die NICHT in user_edited stehen
          setFormDataMap((prevMap) => {
            const nextMap = { ...prevMap };
            for (const fresh of updatedList) {
              const existing = nextMap[fresh.id];
              if (!existing) {
                nextMap[fresh.id] = getInitialFormData(fresh, folders);
              } else {
                const edited = new Set(existing.user_edited);
                const nextDocDate = edited.has('doc_date') ? existing.doc_date : (fresh.doc_date || existing.doc_date);
                // Ordner-Vorschlag nachziehen, wenn sich das (erkannte) Datum geändert hat
                const nextFolderId = edited.has('folder_id')
                  ? existing.folder_id
                  : fresh.folder_id ||
                    (nextDocDate !== existing.doc_date ? suggestFolderId(folders, nextDocDate) : null) ||
                    existing.folder_id;
                nextMap[fresh.id] = {
                  ...existing,
                  title: edited.has('title') ? existing.title : (fresh.title || existing.title),
                  sender: edited.has('sender') ? existing.sender : (fresh.sender || existing.sender),
                  doc_type: edited.has('doc_type') ? existing.doc_type : (fresh.doc_type || existing.doc_type),
                  doc_date: nextDocDate,
                  amount_cents: edited.has('amount_cents') ? existing.amount_cents : fresh.amount_cents,
                  amount_str: edited.has('amount_cents')
                    ? existing.amount_str
                    : fresh.amount_cents !== null && fresh.amount_cents !== undefined
                    ? (fresh.amount_cents / 100).toFixed(2).replace('.', ',')
                    : existing.amount_str,
                  folder_id: nextFolderId,
                };
              }
            }
            return nextMap;
          });
        }
      } catch (err) {
        console.error('Fehler beim Polling im Import-Dialog:', err);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [isOpen, documents, folders, getInitialFormData]);

  // Formular-Änderungen in formDataMap speichern
  const handleFormChange = useCallback((docId: number, data: DocumentFormData) => {
    setFormDataMap((prev) => ({
      ...prev,
      [docId]: data,
    }));
  }, []);

  // Speichern eines einzelnen Dokuments
  const saveDocument = async (doc: ScannyDocument, data: DocumentFormData): Promise<boolean> => {
    try {
      const payload = {
        title: data.title,
        sender: data.sender,
        doc_type: data.doc_type,
        doc_date: data.doc_date || null,
        amount_cents: data.amount_cents,
        folder_id: data.folder_id,
        user_edited: JSON.stringify(data.user_edited),
      };

      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('Speichern fehlgeschlagen.');
      }

      return true;
    } catch (err) {
      console.error('Fehler beim Speichern:', err);
      return false;
    }
  };

  // Aktion: Ablegen (speichert und springt zum nächsten)
  const handleFileCurrent = async () => {
    if (!currentDoc) return;
    setIsSaving(true);
    const data = getCurrentFormData(currentDoc);
    const ok = await saveDocument(currentDoc, data);
    setIsSaving(false);

    if (ok) {
      const isPending = currentDoc.status === 'queued' || currentDoc.status === 'processing';
      const isDocError = currentDoc.status === 'error';
      const updatedStatus = isPending || isDocError
        ? currentDoc.status
        : data.folder_id ? 'filed' : 'inbox';

      const msg = isPending && data.folder_id
        ? `»${data.title || currentDoc.original_name}« wird nach Aufbereitung abgelegt.`
        : `»${data.title || currentDoc.original_name}« ${data.folder_id ? 'abgelegt' : 'im Eingang gesichert'}.`;

      setSaveMessage(msg);
      setTimeout(() => setSaveMessage(null), 2500);

      // Status lokal aktualisieren
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === currentDoc.id
            ? { ...d, status: updatedStatus, folder_id: data.folder_id }
            : d
        )
      );

      // Zur nächsten Datei springen oder beenden
      if (selectedIndex < documents.length - 1) {
        setSelectedIndex((prev) => prev + 1);
      } else {
        onRefresh();
        onClose();
      }
    }
  };

  // Aktion: Überspringen (bleibt im Eingang, springt zum nächsten)
  const handleSkipCurrent = () => {
    if (selectedIndex < documents.length - 1) {
      setSelectedIndex((prev) => prev + 1);
    } else {
      onRefresh();
      onClose();
    }
  };

  // Aktion: "Alle gleich" (Ordner + Datum auf alle Dokumente des Batches übertragen)
  const handleApplyToAll = () => {
    if (!currentDoc) return;
    const currentData = getCurrentFormData(currentDoc);

    setFormDataMap((prev) => {
      const nextMap = { ...prev };
      for (const doc of documents) {
        const existingData = nextMap[doc.id] || getInitialFormData(doc, folders);
        nextMap[doc.id] = {
          ...existingData,
          folder_id: currentData.folder_id,
          doc_date: currentData.doc_date,
          user_edited: Array.from(new Set([...existingData.user_edited, 'folder_id', 'doc_date'])),
        };
      }
      return nextMap;
    });

    setSaveMessage('Ordner und Datum auf alle Belege des Batches übertragen.');
    setTimeout(() => setSaveMessage(null), 2500);
  };

  // Aktion: "Alle ablegen" (speichert alle bereiten Dokumente)
  const handleFileAll = async () => {
    setIsSaving(true);
    for (const doc of documents) {
      const data = getCurrentFormData(doc);
      await saveDocument(doc, data);
    }

    setIsSaving(false);
    onRefresh();
    onClose();
  };

  // Aktion: Bei Fehler erneut versuchen
  const handleRetry = async (docId: number) => {
    try {
      const res = await fetch(`/api/documents/${docId}/retry`, { method: 'POST' });
      if (res.ok) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === docId ? { ...d, status: 'queued', error: null } : d))
        );
      }
    } catch (err) {
      console.error('Retry fehlgeschlagen:', err);
    }
  };

  // Schnellaktionen: Drehung ändern ("↺ 90°", "↻ 90°")
  const handleRotate = async (doc: ScannyDocument, direction: 'cw' | 'ccw') => {
    const cur = doc.rotation || 0;
    const next = direction === 'cw' ? (cur + 90) % 360 : (cur - 90 + 360) % 360;
    setDocuments((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, rotation: next, status: 'processing', error: null } : d))
    );
    setPreviewMode('processed');

    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotation: next }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDocuments((prev) =>
          prev.map((d) => (d.id === doc.id ? { ...d, ...updated } : d))
        );
      }
    } catch (err) {
      console.error('Fehler beim Drehen:', err);
    }
  };

  // Schnellaktionen: Farbmodus ändern ("S/W | Grau | Farbe")
  const handleColorMode = async (doc: ScannyDocument, mode: 'bw' | 'gray' | 'color') => {
    if (doc.color_mode === mode) return;
    setDocuments((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, color_mode: mode, status: 'processing', error: null } : d))
    );
    setPreviewMode('processed');

    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color_mode: mode }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDocuments((prev) =>
          prev.map((d) => (d.id === doc.id ? { ...d, ...updated } : d))
        );
      }
    } catch (err) {
      console.error('Fehler beim Ändern des Farbmodus:', err);
    }
  };

  const isDocPdf = (doc?: ScannyDocument) =>
    Boolean(doc?.original_name?.toLowerCase().endsWith('.pdf'));

  const isDocHeic = (doc?: ScannyDocument) => {
    const name = (doc?.original_name || '').toLowerCase();
    return name.endsWith('.heic') || name.endsWith('.heif');
  };

  const getOriginalUrl = (doc: ScannyDocument) => {
    const v = doc.updated_at ? `?v=${encodeURIComponent(doc.updated_at)}` : '';
    if (isDocHeic(doc)) {
      return `/api/documents/${doc.id}/work-preview${v}`;
    }
    return `/api/documents/${doc.id}/original${v}`;
  };

  const getScanUrl = (doc: ScannyDocument) => {
    const v = doc.updated_at ? `?v=${encodeURIComponent(doc.updated_at)}` : '';
    return `/api/documents/${doc.id}/scan${v}`;
  };

  if (!isOpen || documents.length === 0) return null;

  return (
    <div id="import-dialog-overlay" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-xs">
      <div
        id="import-dialog"
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-[96vw] max-w-6xl h-[92vh] max-h-[920px] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-50/70 dark:bg-zinc-800/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
              {selectedIndex + 1}/{documents.length}
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                Belege prüfen & benennen
                <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  ({documents.length} Belege im Batch)
                </span>
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-md">
                {currentDoc?.original_name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {saveMessage && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg animate-in fade-in">
                {saveMessage}
              </span>
            )}
            <button
              type="button"
              id="import-dialog-close-btn"
              onClick={() => {
                onRefresh();
                onClose();
              }}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Schließen (ESC)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 3-Spalten Hauptbereich */}
        <div className="flex-1 flex overflow-hidden">
          {/* Links: Dateiliste */}
          <div className="w-64 border-r border-zinc-200 dark:border-zinc-800 flex flex-col bg-zinc-50/40 dark:bg-zinc-900/40 shrink-0">
            <div className="p-3 border-b border-zinc-100 dark:border-zinc-800/60 text-xs font-semibold text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
              <span>Dateien ({documents.length})</span>
              <span className="text-[10px] text-zinc-400">↑/↓ wechseln</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {documents.map((doc, idx) => {
                const isSelected = idx === selectedIndex;
                const isReady = doc.status === 'inbox' || doc.status === 'filed';
                const isProcessing = doc.status === 'processing' || doc.status === 'queued';
                const isError = doc.status === 'error';
                const itemFormData = getCurrentFormData(doc);

                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setSelectedIndex(idx)}
                    className={`w-full flex items-center gap-2.5 p-2 rounded-xl text-left text-xs transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 font-medium shadow-xs'
                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300 border border-transparent'
                    }`}
                  >
                    {/* Thumbnail mit Cache-Buster oder Icon */}
                    <div className="w-10 h-12 rounded-lg bg-zinc-200 dark:bg-zinc-800 shrink-0 overflow-hidden flex items-center justify-center border border-zinc-300/60 dark:border-zinc-700">
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
                      <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                        {itemFormData.title || doc.original_name}
                      </p>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {formatDocumentType(itemFormData.doc_type) || '– noch offen –'}
                      </p>

                      {/* Status-Punkt */}
                      <div className="flex items-center gap-1 mt-1">
                        {isProcessing && (
                          <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                            aufbereiten…
                          </span>
                        )}
                        {isReady && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                            bereit
                          </span>
                        )}
                        {isError && (
                          <span className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            Fehler
                          </span>
                        )}
                        {(doc.detected === 0 || doc.detected === false) && (
                          <span
                            className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium"
                            title="Ränder nicht erkannt – bitte prüfen"
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            Ränder prüfen
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mitte: Große Vorschau */}
          <div className="flex-1 bg-zinc-100/70 dark:bg-zinc-950 flex flex-col p-4 relative overflow-hidden">
            {currentDoc ? (
              <div className="w-full h-full flex flex-col items-center justify-between relative">
                {/* Gelbe Warnung: Ränder nicht erkannt */}
                {(currentDoc.detected === 0 || currentDoc.detected === false) && (
                  <div
                    id="import-dialog-edge-warning"
                    className="w-full mb-3 px-3.5 py-2 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2 shadow-xs shrink-0"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="font-semibold">Ränder nicht erkannt – bitte prüfen</span>
                  </div>
                )}

                {/* Vorschau-Container */}
                <div className="w-full flex-1 flex items-center justify-center relative min-h-0 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-900/40">
                  {/* Umschalter Aufbereitet | Original | Text oben rechts (PDF: PDF | Text) */}
                  {(
                    <div
                      id="import-dialog-preview-mode-toggle"
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
                        {isDocPdf(currentDoc) ? 'PDF' : 'Aufbereitet'}
                      </button>
                      {!isDocPdf(currentDoc) && (
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
                      )}
                      <button
                        type="button"
                        id="import-dialog-preview-text"
                        onClick={() => setPreviewMode('text')}
                        title="Erkannter Text – beim Hovern über Datum, Betrag oder Absender wird die Fundstelle markiert"
                        className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                          previewMode === 'text'
                            ? 'bg-blue-600 text-white font-semibold shadow-xs'
                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                        }`}
                      >
                        Text
                      </button>
                    </div>
                  )}

                  {/* Text-Ansicht mit Fundstellen, PDF-Vorschau oder Bild */}
                  {previewMode === 'text' ? (
                    currentDoc.ocr_text ? (
                      <OcrTextView
                        id="import-dialog-ocr-text"
                        text={currentDoc.ocr_text}
                        highlight={highlightSpan(parseExtraction(currentDoc), hoveredField)}
                        className="w-full h-full pt-12"
                      />
                    ) : (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Noch kein Text erkannt – die Texterkennung läuft nach der Aufbereitung.
                      </p>
                    )
                  ) : isDocPdf(currentDoc) ? (
                    <iframe
                      src={`/api/documents/${currentDoc.id}/original`}
                      title="PDF Vorschau"
                      className="w-full h-full rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white"
                    />
                  ) : (
                    <div className="relative max-w-full max-h-full flex items-center justify-center p-2">
                      <img
                        key={`${currentDoc.id}-${previewMode}-${currentDoc.updated_at}`}
                        src={
                          previewMode === 'processed' && (currentDoc.status === 'inbox' || currentDoc.status === 'filed')
                            ? getScanUrl(currentDoc)
                            : getOriginalUrl(currentDoc)
                        }
                        alt={currentDoc.original_name}
                        className="max-h-[calc(92vh-220px)] max-w-full object-contain rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800"
                      />
                    </div>
                  )}

                  {/* Overlay bei laufender Aufbereitung */}
                  {(currentDoc.status === 'processing' || currentDoc.status === 'queued') && (
                    <div className="absolute inset-0 z-10 bg-black/45 backdrop-blur-xs flex flex-col items-center justify-center text-white rounded-xl">
                      <Loader2 className="w-10 h-10 animate-spin mb-2 text-blue-400" />
                      <p className="text-sm font-semibold">Wird aufbereitet…</p>
                      <p className="text-xs text-white/75 mt-1">Du kannst die Felder rechts schon ausfüllen</p>
                    </div>
                  )}

                  {/* Fehleranzeige */}
                  {currentDoc.status === 'error' && (
                    <div className="absolute inset-0 z-10 bg-red-950/85 backdrop-blur-xs flex flex-col items-center justify-center text-white p-6 rounded-xl text-center">
                      <AlertCircle className="w-10 h-10 text-red-400 mb-2" />
                      <p className="text-sm font-semibold">Aufbereitung fehlgeschlagen</p>
                      <p className="text-xs text-red-200 mt-1 max-w-md">{currentDoc.error || 'Unbekannter Fehler'}</p>
                      <button
                        type="button"
                        onClick={() => handleRetry(currentDoc.id)}
                        className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Erneut versuchen
                      </button>
                    </div>
                  )}
                </div>

                {/* Schnellaktionen unter der Vorschau (Drehung + Farbmodus) */}
                {!isDocPdf(currentDoc) && (
                  <div className="mt-3 w-full flex flex-wrap items-center justify-between gap-2 shrink-0 px-1">
                    {/* Drehung */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        id="import-quick-rotate-ccw"
                        disabled={currentDoc.status === 'processing' || currentDoc.status === 'queued'}
                        onClick={() => handleRotate(currentDoc, 'ccw')}
                        className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Gegen den Uhrzeigersinn um 90° drehen (↺ 90°)"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>↺ 90°</span>
                      </button>
                      <button
                        type="button"
                        id="import-quick-rotate-cw"
                        disabled={currentDoc.status === 'processing' || currentDoc.status === 'queued'}
                        onClick={() => handleRotate(currentDoc, 'cw')}
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
                        id="import-quick-mode-bw"
                        disabled={currentDoc.status === 'processing' || currentDoc.status === 'queued'}
                        onClick={() => handleColorMode(currentDoc, 'bw')}
                        className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                          currentDoc.color_mode === 'bw'
                            ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white font-semibold shadow-xs'
                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        S/W
                      </button>
                      <button
                        type="button"
                        id="import-quick-mode-gray"
                        disabled={currentDoc.status === 'processing' || currentDoc.status === 'queued'}
                        onClick={() => handleColorMode(currentDoc, 'gray')}
                        className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                          currentDoc.color_mode === 'gray'
                            ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white font-semibold shadow-xs'
                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        Grau
                      </button>
                      <button
                        type="button"
                        id="import-quick-mode-color"
                        disabled={currentDoc.status === 'processing' || currentDoc.status === 'queued'}
                        onClick={() => handleColorMode(currentDoc, 'color')}
                        className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                          currentDoc.color_mode === 'color'
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
            ) : null}
          </div>

          {/* Rechts: Kontrolliertes Formular & Duplikat-Hinweis */}
          <div className="w-84 border-l border-zinc-200 dark:border-zinc-800 p-5 overflow-y-auto bg-white dark:bg-zinc-900 shrink-0 space-y-4">
            {/* Gelber Warnhinweis bei Duplikat */}
            {currentDoc?.duplicate_of_id && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-snug">
                  <p className="font-semibold">Vermutlich doppelt</p>
                  <p className="mt-0.5 opacity-90">
                    Gleiche Datei wie »<span className="underline font-medium">{currentDoc.duplicate_of_title || `Dokument #${currentDoc.duplicate_of_id}`}</span>«.
                  </p>
                </div>
              </div>
            )}

            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Metadaten & Zuordnung
            </h3>

            {currentDoc && (
              <DocumentForm
                document={currentDoc}
                folders={folders}
                value={getCurrentFormData(currentDoc)}
                onChange={(data) => handleFormChange(currentDoc.id, data)}
                onHoverField={setHoveredField}
              />
            )}
          </div>
        </div>

        {/* Footer / Aktionen */}
        <div className="px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-800/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              id="import-btn-apply-all"
              onClick={handleApplyToAll}
              title="Überträgt das ausgewählte Datum und den Zielordner auf alle Belege dieses Imports"
              className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-zinc-400" />
              Alle gleich
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              id="import-btn-skip"
              onClick={handleSkipCurrent}
              className="px-4 py-2 text-xs font-medium rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
            >
              Überspringen
            </button>

            {(() => {
              const isError = currentDoc?.status === 'error';
              const isProcessing = currentDoc?.status === 'queued' || currentDoc?.status === 'processing';
              const fileButtonLabel = isError
                ? 'Erst erneut versuchen'
                : isProcessing
                ? 'Nach Aufbereitung ablegen'
                : 'Ablegen';
              const fileButtonTitle = isError
                ? 'Aufbereitung fehlgeschlagen. Bitte erst erneut versuchen.'
                : undefined;

              return (
                <button
                  type="button"
                  id="import-btn-file-current"
                  onClick={handleFileCurrent}
                  disabled={isSaving || isError}
                  title={fileButtonTitle}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 shadow-xs ${
                    isError
                      ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50'
                  }`}
                >
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ArrowRight className="w-3.5 h-3.5" />
                  )}
                  {fileButtonLabel}
                </button>
              );
            })()}

            <button
              type="button"
              id="import-btn-file-all"
              onClick={handleFileAll}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Alle ablegen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
