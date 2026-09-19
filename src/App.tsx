import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { InboxView } from './components/InboxView';
import { FolderView } from './components/FolderView';
import { SearchView } from './components/SearchView';
import { DashboardView } from './components/DashboardView';
import { SettingsView } from './components/SettingsView';
import { FolderModal } from './components/FolderModal';
import { ImportDialog } from './components/ImportDialog';
import { DocumentDetailDrawer } from './components/DocumentDetailDrawer';
import {
  Folder,
  ActiveView,
  SystemPaths,
  SystemHealth,
  FolderKind,
  ScannyDocument,
  QueueStats,
} from './types';
import {
  AlertCircle,
  Trash2,
  X,
  UploadCloud,
  Folder as FolderIcon,
  Sparkles,
  ArrowRight,
  Search as SearchIcon,
} from 'lucide-react';

export default function App() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<ScannyDocument[]>([]);
  const [stats, setStats] = useState<QueueStats>({
    inbox: 0,
    queued: 0,
    processing: 0,
    error: 0,
    filed: 0,
  });
  const [activeView, setActiveView] = useState<ActiveView>({ type: 'dashboard' });
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [paths, setPaths] = useState<SystemPaths | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);

  // Modals & Drawers
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Import Dialog State
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importBatchDocs, setImportBatchDocs] = useState<ScannyDocument[]>([]);

  // Document Detail Drawer State
  const [selectedDoc, setSelectedDoc] = useState<ScannyDocument | null>(null);

  // Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const dragCounter = useRef(0);

  // Watcher Toast Notification
  const [watcherToast, setWatcherToast] = useState<{
    count: number;
    docs: ScannyDocument[];
  } | null>(null);
  const knownFolderDocIds = useRef<Set<number>>(new Set());
  const initialLoadDone = useRef(false);

  // Upload & Rejection Toast Notification (8 Sekunden, schließbar)
  const [uploadToast, setUploadToast] = useState<{
    id: string;
    title: string;
    lines: string[];
  } | null>(null);

  useEffect(() => {
    if (!uploadToast) return;
    const timer = setTimeout(() => {
      setUploadToast(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [uploadToast]);

  // 1. Ordner laden
  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch('/api/folders');
      if (res.ok) {
        const data = await res.json();
        setFolders(data);
      }
    } catch (err) {
      console.error('Fehler beim Laden der Ordner:', err);
    }
  }, []);

  // 2. Dokumente & Stats laden
  const fetchDocumentsAndStats = useCallback(async () => {
    try {
      const [docsRes, statsRes] = await Promise.all([
        fetch('/api/documents'),
        fetch('/api/stats'),
      ]);

      let freshDocs: ScannyDocument[] = [];
      if (docsRes.ok) {
        freshDocs = await docsRes.json();
        setDocuments(freshDocs);

        // Prüfen auf neue Dokumente aus dem Upload-Ordner für den Toast
        const folderDocs = freshDocs.filter((d) => d.source === 'folder' && d.status !== 'filed');
        if (!initialLoadDone.current) {
          folderDocs.forEach((d) => knownFolderDocIds.current.add(d.id));
          initialLoadDone.current = true;
        } else {
          const newFolderDocs = folderDocs.filter((d) => !knownFolderDocIds.current.has(d.id));
          if (newFolderDocs.length > 0) {
            newFolderDocs.forEach((d) => knownFolderDocIds.current.add(d.id));
            setWatcherToast({
              count: newFolderDocs.length,
              docs: newFolderDocs,
            });
          }
        }
      }

      if (statsRes.ok) {
        const freshStats = await statsRes.json();
        setStats(freshStats);
      }
    } catch (err) {
      console.error('Fehler beim Laden der Dokumente und Statistiken:', err);
    }
  }, []);

  // 3. Systempfade und Health
  const fetchPathsAndHealth = useCallback(async () => {
    try {
      const [pathsRes, healthRes] = await Promise.all([
        fetch('/api/settings/paths'),
        fetch('/api/health'),
      ]);

      if (pathsRes.ok) {
        const pathsData = await pathsRes.json();
        setPaths(pathsData);
      }

      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setHealth(healthData);
      }
    } catch (err) {
      console.error('Fehler beim Laden der Systemeinstellungen:', err);
    }
  }, []);

  useEffect(() => {
    fetchFolders();
    fetchDocumentsAndStats();
    fetchPathsAndHealth();
  }, [fetchFolders, fetchDocumentsAndStats, fetchPathsAndHealth]);

  // Tastenkürzel "/" fokussiert die globale Suche (nicht beim Tippen in Feldern)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      // Nicht aus einem offenen Dialog oder Detail-Drawer heraus in die Suche dahinter springen
      if (document.querySelector('[role="dialog"], #drawer-cancel-btn')) return;
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dokument per ID laden und im Detail-Drawer öffnen (z. B. aus Suchtreffern)
  const openDocumentById = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/documents/${id}`);
      if (res.ok) setSelectedDoc(await res.json());
    } catch (err) {
      console.error('Dokument konnte nicht geladen werden:', err);
    }
  }, []);

  // Polling für Hintergrundverarbeitung (Queue)
  const isQueueActive = stats.queued > 0 || stats.processing > 0;

  useEffect(() => {
    const intervalTime = isQueueActive ? 2500 : 12000;
    const timer = setInterval(() => {
      fetchDocumentsAndStats();
      fetchFolders();
    }, intervalTime);

    return () => clearInterval(timer);
  }, [isQueueActive, fetchDocumentsAndStats, fetchFolders]);

  // Upload Funktion (für Drag & Drop oder Dateidialog)
  const handleUploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!files || files.length === 0) return;
      setIsUploading(true);

      try {
        const formData = new FormData();
        Array.from(files).forEach((f) => {
          // WICHTIG: lastModified VOR der jeweiligen Datei anhängen (Millisekunden-Zahl als String)
          formData.append('lastModified', String(f.lastModified || Date.now()));
          formData.append('files', f);
        });

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        const result = await res.json().catch(() => null);

        if (!res.ok) {
          // Fall "nur ungültige Dateien" (Status 400) oder anderer Fehler
          if (result?.rejected && Array.isArray(result.rejected) && result.rejected.length > 0) {
            const lines = result.rejected.map(
              (r: { name?: string; reason?: string }) =>
                `Nicht übernommen: ${r.name || 'Unbekannte Datei'} (${r.reason || 'Nicht unterstützt'})`
            );
            setUploadToast({
              id: String(Date.now()),
              title: result.error || 'Dateien nicht unterstützt',
              lines,
            });
            return;
          }
          throw new Error(result?.error || 'Upload fehlgeschlagen');
        }

        // Falls einige Dateien abgelehnt wurden, aber andere übernommen werden konnten
        if (result?.rejected && Array.isArray(result.rejected) && result.rejected.length > 0) {
          const lines = result.rejected.map(
            (r: { name?: string; reason?: string }) =>
              `Nicht übernommen: ${r.name || 'Unbekannte Datei'} (${r.reason || 'Nicht unterstützt'})`
          );
          setUploadToast({
            id: String(Date.now()),
            title: 'Einige Dateien wurden nicht übernommen',
            lines,
          });
        }

        // Dokumente sofort neu abrufen
        await fetchDocumentsAndStats();
        await fetchFolders();

        // Dokumente für den ImportDialog zusammenstellen und sofort öffnen
        if (result?.batchId) {
          const allDocsRes = await fetch(`/api/documents?batch=${result.batchId}`);
          if (allDocsRes.ok) {
            const batchData = await allDocsRes.json();
            if (batchData && batchData.length > 0) {
              setImportBatchDocs(batchData);
              setIsImportDialogOpen(true);
            }
          }
        }
      } catch (err: any) {
        console.error('Upload-Fehler:', err);
        setUploadToast({
          id: String(Date.now()),
          title: 'Fehler beim Upload',
          lines: [err?.message || 'Unbekannter Upload-Fehler aufgetreten.'],
        });
      } finally {
        setIsUploading(false);
      }
    },
    [fetchDocumentsAndStats, fetchFolders]
  );

  // Globaler Vollbild Drag & Drop Handler
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current += 1;
      if (e.dataTransfer?.types?.includes('Files')) {
        setIsWindowDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsWindowDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsWindowDragging(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        await handleUploadFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleUploadFiles]);

  // Dokument löschen
  const handleDeleteDocument = async (id: number) => {
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      throw new Error('Löschen fehlgeschlagen');
    }
    await fetchDocumentsAndStats();
    await fetchFolders();
  };

  // Dokument Retry
  const handleRetryDocument = async (id: number) => {
    await fetch(`/api/documents/${id}/retry`, { method: 'POST' });
    await fetchDocumentsAndStats();
  };

  // Ordner anlegen oder bearbeiten
  const handleSaveFolder = async (folderData: {
    name: string;
    kind: FolderKind;
    year: number | null;
    color: string;
  }) => {
    if (editingFolder) {
      const res = await fetch(`/api/folders/${editingFolder.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(folderData),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Ordner konnte nicht aktualisiert werden.');
      }

      const updated = await res.json();
      setFolders((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setEditingFolder(null);
    } else {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(folderData),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Ordner konnte nicht angelegt werden.');
      }

      const created = await res.json();
      setFolders((prev) => [...prev, created]);
      setActiveView({ type: 'folder', folderId: created.id });
    }
    await fetchFolders();
  };

  // Ordner löschen
  const confirmDeleteFolder = async () => {
    if (!deletingFolder) return;
    setIsDeleting(true);
    setDeleteErrorMessage(null);

    try {
      const res = await fetch(`/api/folders/${deletingFolder.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        setDeleteErrorMessage(data.error || 'Ordner konnte nicht gelöscht werden.');
        setIsDeleting(false);
        return;
      }

      if (activeView.type === 'folder' && activeView.folderId === deletingFolder.id) {
        setActiveView({ type: 'inbox' });
      }

      setDeletingFolder(null);
      await fetchFolders();
    } catch (err: any) {
      setDeleteErrorMessage(err?.message || 'Netzwerkfehler beim Löschen des Ordners.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Dokumente im Eingang (noch nicht abgelegt)
  const inboxDocuments = documents.filter((d) => d.status !== 'filed');
  const currentFolder =
    activeView.type === 'folder' ? folders.find((f) => f.id === activeView.folderId) : null;

  return (
    <div className="flex h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans">
      {/* Vollbild Drag & Drop Overlay */}
      {isWindowDragging && (
        <div className="fixed inset-0 z-50 bg-blue-600/80 backdrop-blur-sm flex flex-col items-center justify-center text-white pointer-events-none animate-in fade-in duration-100">
          <div className="w-20 h-20 rounded-3xl bg-white/20 flex items-center justify-center mb-4 shadow-xl border border-white/30">
            <UploadCloud className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Loslassen zum Importieren</h2>
          <p className="text-sm text-white/80 mt-1">Belege werden automatisch erfasst und geöffnet</p>
        </div>
      )}

      {/* Sidebar links */}
      <Sidebar
        folders={folders}
        inboxCount={inboxDocuments.length}
        isProcessing={isQueueActive}
        activeView={activeView}
        onSelectView={setActiveView}
        onOpenNewFolder={() => {
          setEditingFolder(null);
          setIsFolderModalOpen(true);
        }}
        onEditFolder={(folder) => {
          setEditingFolder(folder);
          setIsFolderModalOpen(true);
        }}
        onDeleteFolder={(folder) => {
          setDeleteErrorMessage(null);
          setDeletingFolder(folder);
        }}
      />

      {/* Hauptbereich */}
      <main className="flex-1 h-screen overflow-y-auto">
        {/* Globale Suche oben */}
        <div className="sticky top-0 z-30 px-6 md:px-8 py-3 bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur-sm border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div className="relative max-w-xl">
            <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              ref={searchInputRef}
              id="global-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim() && activeView.type !== 'search') setActiveView({ type: 'search' });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setActiveView({ type: 'search' });
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Belege durchsuchen …"
              className="w-full pl-10 pr-10 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm placeholder:text-zinc-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 text-[10px] font-mono text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded">
              /
            </kbd>
          </div>
        </div>

        {activeView.type === 'dashboard' && (
          <DashboardView
            documents={documents}
            folders={folders}
            onOpenInbox={() => setActiveView({ type: 'inbox' })}
            onOpenFolder={(folderId) => setActiveView({ type: 'folder', folderId })}
            onSelectDocument={(doc) => setSelectedDoc(doc)}
          />
        )}
        {activeView.type === 'inbox' && (
          <InboxView
            documents={inboxDocuments}
            folders={folders}
            onRefresh={async () => {
              await fetchDocumentsAndStats();
              await fetchFolders();
            }}
            paths={paths}
            onOpenImportDialog={(docs) => {
              setImportBatchDocs(docs || inboxDocuments);
              setIsImportDialogOpen(true);
            }}
            onSelectDocument={(doc) => setSelectedDoc(doc)}
            onUploadFiles={handleUploadFiles}
            onRetryDocument={handleRetryDocument}
            isUploading={isUploading}
          />
        )}

        {activeView.type === 'folder' && currentFolder && (
          <FolderView
            folder={currentFolder}
            documents={documents}
            paths={paths}
            onEdit={(folder) => {
              setEditingFolder(folder);
              setIsFolderModalOpen(true);
            }}
            onDelete={(folder) => {
              setDeleteErrorMessage(null);
              setDeletingFolder(folder);
            }}
            onSelectDocument={(doc) => setSelectedDoc(doc)}
          />
        )}

        {activeView.type === 'folder' && !currentFolder && (
          <div className="p-8 text-center text-zinc-500">
            <p>Ordner wurde nicht gefunden oder gelöscht.</p>
            <button
              type="button"
              onClick={() => setActiveView({ type: 'inbox' })}
              className="mt-3 text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Zurück zum Eingang
            </button>
          </div>
        )}

        {activeView.type === 'search' && (
          <SearchView folders={folders} query={searchQuery} onOpenDocument={openDocumentById} />
        )}

        {activeView.type === 'settings' && <SettingsView paths={paths} health={health} />}
      </main>

      {/* Import Dialog (Batch Benennung & Prüfung) */}
      <ImportDialog
        isOpen={isImportDialogOpen}
        batchDocuments={importBatchDocs}
        folders={folders}
        onClose={() => setIsImportDialogOpen(false)}
        onRefresh={async () => {
          await fetchDocumentsAndStats();
          await fetchFolders();
        }}
      />

      {/* Einzeldokument Detail-Drawer */}
      <DocumentDetailDrawer
        document={selectedDoc}
        folders={folders}
        onClose={() => setSelectedDoc(null)}
        onRefresh={async () => {
          await fetchDocumentsAndStats();
          await fetchFolders();
        }}
        onDeleteDocument={handleDeleteDocument}
      />

      {/* Toast Notifications (unten rechts gestapelt) */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none max-w-md w-full">
        {/* Eigener Toast für abgelehnte Dateien & Upload-Fehler (8s, schließbar) */}
        {uploadToast && (
          <div
            id="upload-toast-notification"
            role="alert"
            className="pointer-events-auto w-full bg-zinc-900 dark:bg-zinc-800 text-white p-4 rounded-2xl shadow-2xl border border-red-500/40 flex items-start gap-3 animate-in slide-in-from-bottom duration-200"
          >
            <div className="w-8 h-8 rounded-xl bg-red-600/30 border border-red-500/50 text-red-300 flex items-center justify-center shrink-0 mt-0.5">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div className="flex-1 text-xs space-y-1 min-w-0">
              <p className="font-semibold text-zinc-100">{uploadToast.title}</p>
              <div className="space-y-1 text-zinc-300 text-[11px] max-h-48 overflow-y-auto">
                {uploadToast.lines.map((line, idx) => (
                  <p key={idx} className="leading-snug break-words">
                    {line}
                  </p>
                ))}
              </div>
            </div>
            <button
              type="button"
              id="close-upload-toast-btn"
              onClick={() => setUploadToast(null)}
              className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              title="Schließen"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Toast Notification für Upload-Ordner */}
        {watcherToast && (
          <div className="pointer-events-auto bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-3 rounded-2xl shadow-2xl border border-zinc-800 dark:border-zinc-200 flex items-center gap-3 animate-in slide-in-from-bottom duration-200">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
              <FolderIcon className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <p className="font-semibold">
                {watcherToast.count} neue{watcherToast.count === 1 ? 's' : ''} Dokument{watcherToast.count === 1 ? '' : 'e'} im Upload-Ordner
              </p>
              <p className="text-[11px] opacity-70">Automatisch erkannt und bereit</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setImportBatchDocs(watcherToast.docs);
                setIsImportDialogOpen(true);
                setWatcherToast(null);
              }}
              className="ml-2 px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold rounded-xl flex items-center gap-1 cursor-pointer transition-colors"
            >
              Prüfen <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setWatcherToast(null)}
              className="p-1 opacity-60 hover:opacity-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Modal: Ordner anlegen / bearbeiten */}
      <FolderModal
        isOpen={isFolderModalOpen}
        onClose={() => {
          setIsFolderModalOpen(false);
          setEditingFolder(null);
        }}
        onSave={handleSaveFolder}
        editFolder={editingFolder}
      />

      {/* Modal: Ordner löschen bestätigen */}
      {deletingFolder && (
        <div
          id="delete-folder-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl overflow-hidden p-6 space-y-4 text-zinc-900 dark:text-zinc-100">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">Ordner löschen?</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Möchten Sie den Ordner <span className="font-semibold text-zinc-800 dark:text-zinc-200">"{deletingFolder.name}"</span> wirklich löschen?
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingFolder(null)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {deleteErrorMessage && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex items-start gap-2.5 text-red-700 dark:text-red-300 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{deleteErrorMessage}</span>
              </div>
            )}

            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Hinweis: Ein Ordner kann nur gelöscht werden, wenn er leer ist und keine Belege enthält.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                id="cancel-delete-folder-button"
                onClick={() => setDeletingFolder(null)}
                className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="button"
                id="confirm-delete-folder-button"
                disabled={isDeleting}
                onClick={confirmDeleteFolder}
                className="px-4 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-xs transition-all disabled:opacity-50 cursor-pointer"
              >
                {isDeleting ? 'Wird gelöscht...' : 'Endgültig löschen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
