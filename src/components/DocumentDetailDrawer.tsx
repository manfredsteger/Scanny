import React, { useState, useEffect } from 'react';
import { X, Trash2, Save, ExternalLink, Loader2, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Folder, ScannyDocument, DocumentFormData } from '../types';
import { DocumentForm } from './DocumentForm';
import { DeleteConfirmModal } from './DeleteConfirmModal';

interface DocumentDetailDrawerProps {
  document: ScannyDocument | null;
  folders: Folder[];
  onClose: () => void;
  onRefresh: () => void;
  onDeleteDocument: (id: number) => Promise<void>;
}

export function DocumentDetailDrawer({
  document,
  folders,
  onClose,
  onRefresh,
  onDeleteDocument,
}: DocumentDetailDrawerProps) {
  const [formData, setFormData] = useState<DocumentFormData | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (document) {
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
  }, [document?.id]);

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

  const isPdf = document.original_name.toLowerCase().endsWith('.pdf');

  return (
    <>
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
              <button
                type="button"
                id="drawer-delete-btn"
                onClick={() => setIsDeleteModalOpen(true)}
                className="p-2 rounded-xl text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                title="Dokument löschen"
              >
                <Trash2 className="w-4 h-4" />
              </button>
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
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Duplikat-Hinweis */}
            {document.duplicate_of_id && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-snug">
                  <p className="font-semibold">Vermutlich doppelt</p>
                  <p className="mt-0.5 opacity-90">
                    Gleiche Datei wie »<span className="underline font-medium">{document.duplicate_of_title || `Dokument #${document.duplicate_of_id}`}</span>«.
                  </p>
                </div>
              </div>
            )}

            {/* Vorschau-Box */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-950 p-2 flex items-center justify-center relative min-h-[220px] max-h-[300px] overflow-hidden">
              {isPdf ? (
                <iframe
                  src={`/api/documents/${document.id}/original`}
                  title="PDF Vorschau"
                  className="w-full h-64 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white"
                />
              ) : (
                <img
                  src={`/api/documents/${document.id}/original`}
                  alt={document.original_name}
                  className="max-h-64 object-contain rounded-lg shadow-xs"
                />
              )}
              <a
                href={`/api/documents/${document.id}/original`}
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-3 right-3 bg-white/90 dark:bg-zinc-800/90 text-zinc-700 dark:text-zinc-200 px-2.5 py-1 rounded-lg text-xs font-medium shadow-xs hover:bg-white flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Vollbild
              </a>
            </div>

            {/* Metadaten Formular */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
                Belegdaten
              </h3>
              {formData && (
                <DocumentForm
                  document={document}
                  folders={folders}
                  value={formData}
                  onChange={setFormData}
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
                disabled={isSaving || !formData}
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
        title="Dokument löschen"
        message={`Möchtest du das Dokument »${document.title || document.original_name}« wirklich unwiderruflich löschen? Auch die Originaldatei wird gelöscht.`}
        confirmText="Unwiderruflich löschen"
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsDeleteModalOpen(false)}
      />
    </>
  );
}
