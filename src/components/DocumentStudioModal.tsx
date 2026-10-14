import React, { useState, useRef, useEffect } from 'react';
import { readJson, skippedNotice } from '../apiJson';
import {
  X,
  RotateCw,
  RotateCcw,
  Trash2,
  Copy,
  ZoomIn,
  MoveLeft,
  MoveRight,
  Download,
  ScanLine,
  Folder as FolderIcon,
  Plus,
  Hash,
  Sliders,
  Check,
  AlertCircle,
  Loader2,
  FileText,
  Image as ImageIcon,
  ArrowUpDown,
  Sparkles,
  ExternalLink,
  ArrowLeft,
  RefreshCw,
  Layers,
  Merge,
  Move,
  Undo2,
  ChevronDown,
} from 'lucide-react';
import { StudioPageItem, Folder, PageNumberConfig, CompressionLevel } from '../types';
import { SinglePageExportModal } from './tools/SinglePageExportModal';


export type StudioMode = 'general' | 'merge' | 'rotate' | 'organize';

interface DocumentStudioModalProps {
  isOpen: boolean;
  initialPages?: StudioPageItem[];
  initialSessionId?: string;
  initialMode?: StudioMode;
  /** Seitenzahlen gleich eingeschaltet (Werkzeug "Seitenzahlen einfügen") */
  initialPageNumbers?: boolean;
  /** Hinweis aus dem Einlesen, z. B. übersprungene Dateien */
  initialNotice?: string | null;
  folders: Folder[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onOpenInbox?: () => void;
}

export function DocumentStudioModal({
  isOpen,
  initialPages = [],
  initialSessionId = '',
  initialMode = 'general',
  initialPageNumbers = false,
  initialNotice = null,
  folders,
  onClose,
  onRefresh,
  onOpenInbox,
}: DocumentStudioModalProps) {
  const [pages, setPages] = useState<StudioPageItem[]>(initialPages);
  const [sessionId, setSessionId] = useState<string>(initialSessionId);
  const [mode, setMode] = useState<StudioMode>(initialMode);
  const [title, setTitle] = useState<string>(
    initialMode === 'rotate'
      ? 'Dokument_Ausgerichtet'
      : initialMode === 'merge'
      ? 'Zusammengeführtes_Dokument'
      : initialMode === 'organize'
      ? 'Dokument_NeuGeordnet'
      : 'Dokument'
  );
  const [zoomPage, setZoomPage] = useState<StudioPageItem | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Einstellungen
  const [showSettings, setShowSettings] = useState(false);
  const [compression, setCompression] = useState<CompressionLevel>('none');
  const [pageNumbering, setPageNumbering] = useState<PageNumberConfig>({
    enabled: initialPageNumbers,
    position: 'bottom-center',
    format: 'page_x_of_y',
    startFrom: 1,
    fontSize: 10,
  });

  // Export / Übergabe-Zustand
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialNotice);
  const [isAddingFiles, setIsAddingFiles] = useState(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const [isSinglePageModalOpen, setIsSinglePageModalOpen] = useState(false);
  const [activeCardExportMenu, setActiveCardExportMenu] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setIsExportDropdownOpen(false);
      }
      // Export-Menü einer Seite: Knopf und Menü selbst stoppen ihre Klicks – jeder andere Klick schließt
      setActiveCardExportMenu(null);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveCardExportMenu(null);
        setIsExportDropdownOpen(false);
      }
    };
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (initialPages && initialPages.length > 0) {
      setPages(initialPages);
    }
    if (initialSessionId) {
      setSessionId(initialSessionId);
    }
    if (initialMode) {
      setMode(initialMode);
      if (initialMode === 'rotate') {
        setTitle('Dokument_Ausgerichtet');
      } else if (initialMode === 'merge') {
        setTitle('Zusammengeführtes_Dokument');
      } else if (initialMode === 'organize') {
        setTitle('Dokument_NeuGeordnet');
      }
    }
  }, [initialPages, initialSessionId, initialMode]);


  if (!isOpen) return null;

  // Ermittle alle eindeutigen Quelldateien für Zusammenführungs-Hinweise
  const uniqueFiles = Array.from(new Set(pages.map((p) => p.sourceFileName)));
  const anyRotated = pages.some((p) => p.rotation !== 0);

  // 1. Drehung für eine Einzelseite ändern (+90° im Uhrzeigersinn, -90° gegen den Uhrzeigersinn)
  const handleRotatePage = (index: number, delta: number) => {
    setPages((prev) =>
      prev.map((p, idx) => {
        if (idx !== index) return p;
        const newRot = ((p.rotation + delta) % 360 + 360) % 360;
        return { ...p, rotation: newRot };
      })
    );
  };

  // 2. Drehung für ALLE Seiten gemeinsam ändern
  const handleRotateAll = (delta: number) => {
    setPages((prev) =>
      prev.map((p) => ({
        ...p,
        rotation: ((p.rotation + delta) % 360 + 360) % 360,
      }))
    );
  };

  // 3. Drehung für alle Seiten auf 0° zurücksetzen
  const handleResetRotation = () => {
    setPages((prev) =>
      prev.map((p) => ({
        ...p,
        rotation: 0,
      }))
    );
  };

  // 4. Seite löschen
  const handleDeletePage = (index: number) => {
    if (pages.length <= 1) {
      setErrorMessage('Mindestens eine Seite muss im Dokument verbleiben.');
      return;
    }
    setPages((prev) => prev.filter((_, idx) => idx !== index));
  };

  // 5. Seite duplizieren
  const handleDuplicatePage = (index: number) => {
    const target = pages[index];
    const newPage: StudioPageItem = {
      ...target,
      id: `${target.id}_copy_${Date.now()}`,
      displayNumber: target.displayNumber,
    };
    const nextPages = [...pages];
    nextPages.splice(index + 1, 0, newPage);
    setPages(nextPages);
  };

  // 6. Seite nach links/rechts verschieben
  const handleMovePage = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= pages.length) return;
    const next = [...pages];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    setPages(next);
  };

  // 7. Drag & Drop Reordering zwischen Seiten
  const handleDragStart = (index: number) => {
    setDraggedPageIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (dropIndex: number) => {
    if (draggedPageIndex !== null && draggedPageIndex !== dropIndex) {
      handleMovePage(draggedPageIndex, dropIndex);
    }
    setDraggedPageIndex(null);
    setDragOverIndex(null);
  };

  // 8. Weitere Dateien / Ordner zur aktuellen Werkbank hinzufügen
  const handleAppendFiles = async (filesToAdd: File[]) => {
    if (filesToAdd.length === 0) return;
    setIsAddingFiles(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      // Sitzung mitschicken: angehängte Seiten gehören zur SELBEN Sitzung, sonst würden sie beim
      // Zusammenfügen über gleichlautende Seitenschlüssel auf falsche Seiten zeigen
      if (sessionId) formData.append('sessionId', sessionId);
      filesToAdd.filter((f) => !f.name.startsWith('.')).forEach((f) => formData.append('files', f));

      const res = await fetch('/api/tools/prepare-session', {
        method: 'POST',
        body: formData,
      });
      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data.error || 'Fehler beim Hinzufügen der Dateien.');
      }

      if (data.sessionId) setSessionId(data.sessionId);
      if (data.pages && Array.isArray(data.pages)) {
        setPages((prev) => [...prev, ...data.pages]);
      }
      const notice = skippedNotice(data.skipped);
      if (notice) setErrorMessage(notice);
    } catch (err: any) {
      setErrorMessage(err.message || 'Fehler beim Laden weiterer Dateien.');
    } finally {
      setIsAddingFiles(false);
    }
  };

  // 9. Reihenfolge umkehren
  const handleReverseOrder = () => {
    setPages((prev) => [...prev].reverse());
  };

  // 10. Dokument zusammensetzen & exportieren
  const handleAssemble = async (destination: 'download' | 'scanny', targetFormat: 'pdf' | 'images_zip' = 'pdf') => {
    if (pages.length === 0) return;
    setIsExporting(true);
    setErrorMessage(null);
    setExportSuccessMessage(null);

    try {
      const payload = {
        sessionId,
        title: title.trim() || 'Dokument',
        pages: pages.map((p) => ({
          pageKey: p.pageKey,
          rotation: p.rotation,
          include: true,
        })),
        pageNumbering,
        compression,
        targetFormat,
        destination,
        folderId: selectedFolderId,
      };

      if (destination === 'download') {
        const res = await fetch('/api/tools/assemble', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const err = await readJson(res);
          throw new Error(err.error || 'Fehler beim Herunterladen des Dokuments.');
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ext = targetFormat === 'images_zip' ? 'zip' : 'pdf';
        a.download = `${title.trim() || 'Dokument'}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        setExportSuccessMessage('Datei wurde erfolgreich lokal heruntergeladen!');
      } else {
        // In Scanny übernehmen
        const res = await fetch('/api/tools/assemble', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const err = await readJson(res);
          throw new Error(err.error || 'Fehler bei der Übergabe an Scanny.');
        }

        const data = await res.json();
        setExportSuccessMessage(`»${data.title}« wurde erfolgreich an Scanny übergeben!`);
        await onRefresh();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Fehler beim Ausführen der Aktion.');
    } finally {
      setIsExporting(false);
    }
  };

  // 11. Einzelseite exportieren als JPG, PNG oder PDF
  const handleExportSinglePage = async (
    page: StudioPageItem,
    pageIndex: number,
    format: 'jpg' | 'png' | 'pdf'
  ) => {
    setIsExporting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/tools/export-single-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          pageKey: page.pageKey,
          format,
          rotation: page.rotation,
          title: title.trim() || 'Dokument',
          pageNumber: pageIndex + 1,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Fehler beim Herunterladen der Seite.');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cleanTitle = (title.trim() || 'Dokument').replace(/[/\\:*?"<>|]/g, '_');
      a.download = `${cleanTitle}_Seite_${pageIndex + 1}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setExportSuccessMessage(
        `Seite ${pageIndex + 1} erfolgreich als .${format.toUpperCase()} heruntergeladen!`
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Fehler beim Exportieren der Seite.');
    } finally {
      setIsExporting(false);
    }
  };

  return (

    <div
      id="document-studio-modal"
      className="fixed inset-0 z-50 flex flex-col bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md text-zinc-900 dark:text-zinc-100 animate-in fade-in duration-200"
    >
      {/* Kopfzeile der Werkbank */}
      <header className="min-h-16 px-4 md:px-6 py-2.5 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 shrink-0 select-none shadow-md">
        {/* Linke Seite: Abbrechen Button, Scanny Brand & Dokumentname */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            id="studio-cancel-button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white border border-zinc-300 dark:border-zinc-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            title="Werkbank schließen und abbrechen (Zurück zu Tools)"
          >
            <ArrowLeft className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            <span>Abbrechen</span>
          </button>

          <div className="hidden sm:flex items-center gap-2 pl-1 border-l border-zinc-200 dark:border-zinc-800">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <ScanLine className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-zinc-900 dark:text-white tracking-tight">Scanny Werkbank</span>
                {mode === 'rotate' && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1">
                    <RotateCw className="w-3 h-3 text-amber-400" />
                    <span>Drehen</span>
                  </span>
                )}
                {mode === 'merge' && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30 flex items-center gap-1">
                    <Merge className="w-3 h-3 text-blue-400" />
                    <span>Zusammenführen</span>
                  </span>
                )}
                {mode === 'organize' && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                    <Move className="w-3 h-3 text-indigo-400" />
                    <span>Verschieben</span>
                  </span>
                )}
              </div>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                {pages.length} Seite{pages.length === 1 ? '' : 'n'} • {uniqueFiles.length} Quell-Datei{uniqueFiles.length === 1 ? '' : 'en'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 pl-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Dokumentenname"
              className="bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-100/90 dark:hover:bg-zinc-800/90 focus:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-2.5 py-1 text-xs md:text-sm font-semibold text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-44 md:w-64 transition-all"
              title="Klicken zum Umbenennen des Ziel-Dokuments"
            />
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">.pdf</span>
          </div>
        </div>

        {/* Toolbar & Aktionen */}
        <div className="flex flex-wrap items-center gap-2">
          {/* DREH-ZENTRALE: Klar beschriftete Tasten, kein verwirrendes 'alle alle' mehr */}
          <div className="flex items-center gap-1 bg-zinc-100/95 dark:bg-zinc-800/95 p-1 rounded-xl border border-zinc-300/80 dark:border-zinc-700/80 text-xs">
            <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 px-2 flex items-center gap-1.5 hidden xl:inline-flex">
              <RotateCw className="w-3.5 h-3.5 text-blue-400" />
              <span>Alle drehen:</span>
            </span>
            <button
              type="button"
              id="rotate-all-ccw-btn"
              onClick={() => handleRotateAll(-90)}
              className="px-2.5 py-1.5 bg-zinc-200/80 dark:bg-zinc-700/80 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
              title="Alle Seiten um 90° nach links (gegen den Uhrzeigersinn) drehen"
            >
              <RotateCcw className="w-3.5 h-3.5 text-blue-400" />
              <span>90° Links</span>
            </button>
            <button
              type="button"
              id="rotate-all-cw-btn"
              onClick={() => handleRotateAll(90)}
              className="px-2.5 py-1.5 bg-zinc-200/80 dark:bg-zinc-700/80 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
              title="Alle Seiten um 90° nach rechts (im Uhrzeigersinn) drehen"
            >
              <RotateCw className="w-3.5 h-3.5 text-blue-400" />
              <span>90° Rechts</span>
            </button>
            <button
              type="button"
              id="rotate-all-180-btn"
              onClick={() => handleRotateAll(180)}
              className="px-2.5 py-1.5 bg-zinc-200/80 dark:bg-zinc-700/80 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs hidden sm:flex"
              title="Alle Seiten um 180° auf den Kopf bzw. aufrecht drehen (Kopfstand beheben)"
            >
              <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
              <span>180°</span>
            </button>
            {anyRotated && (
              <button
                type="button"
                onClick={handleResetRotation}
                className="px-2 py-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                title="Alle Drehungen zurücksetzen auf 0°"
              >
                <Undo2 className="w-3 h-3" />
                <span className="text-[11px] hidden md:inline">0° Reset</span>
              </button>
            )}
          </div>

          {/* Reihenfolge umkehren */}
          <button
            type="button"
            onClick={handleReverseOrder}
            className="px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer hidden md:flex"
            title="Reihenfolge aller Seiten umkehren"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>Umkehren</span>
          </button>

          {/* Weitere Dateien hinzufügen */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isAddingFiles}
            className="px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            title="Weitere Dateien oder Seiten anhängen"
          >
            {isAddingFiles ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Hinzufügen</span>
          </button>

          {/* Einstellungen Toggle (Seitenzahlen, Kompression) */}
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`px-3 py-1.5 rounded-xl border text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
              showSettings || pageNumbering.enabled || compression !== 'none'
                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300 font-semibold'
                : 'border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
            }`}
            title="Seitenzahlen & Komprimierung konfigurieren"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Optionen</span>
            {(pageNumbering.enabled || compression !== 'none') && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            )}
          </button>

          <div className="h-6 w-px bg-zinc-100 dark:bg-zinc-800 mx-1 hidden sm:block" />

          {/* HAUPTAKTION 1: Exportieren mit Dropdown (PDF, JPG, PNG, Einzelseiten) */}
          <div className="relative" ref={exportDropdownRef}>
            <button
              type="button"
              id="studio-export-dropdown-btn"
              disabled={isExporting}
              onClick={(e) => {
                e.stopPropagation();
                setIsExportDropdownOpen(!isExportDropdownOpen);
              }}
              className="px-3.5 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
              title="Dokument oder einzelne Seiten exportieren (PDF, JPG, PNG)"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>Exportieren</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 transition-transform ${
                  isExportDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Dropdown-Menü */}
            {isExportDropdownOpen && (
              <div
                id="studio-export-menu"
                className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-2xl shadow-2xl p-2 z-50 text-left animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Dokument-Export
                </div>

                {/* 1. Als PDF */}
                <button
                  type="button"
                  id="export-option-pdf"
                  onClick={() => {
                    setIsExportDropdownOpen(false);
                    handleAssemble('download', 'pdf');
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer group"
                >
                  <div className="w-7 h-7 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-white">Als PDF Dokument (.pdf)</div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Alle Seiten zusammengefügt herunterladen</div>
                  </div>
                </button>

                {/* 2. Alle Seiten als Bilder ZIP */}
                <button
                  type="button"
                  id="export-option-zip"
                  onClick={() => {
                    setIsExportDropdownOpen(false);
                    handleAssemble('download', 'images_zip');
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer group"
                >
                  <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-white">Alle Seiten als Bilder (.zip)</div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Alle Seiten als JPG im ZIP-Archiv</div>
                  </div>
                </button>

                <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-1.5 mx-1" />

                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Einzelne Seite(n) exportieren
                </div>

                {/* 3. Einzelseite als Bild (JPG/PNG) Dialog */}
                <button
                  type="button"
                  id="export-option-single-page"
                  onClick={() => {
                    setIsExportDropdownOpen(false);
                    setIsSinglePageModalOpen(true);
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white flex items-center gap-2.5 transition-colors cursor-pointer group"
                >
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <ImageIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                      <span>Einzelseite als Bild (JPG/PNG)</span>
                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold">
                        Neu
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Seite wählen und als JPG oder PNG sichern</div>
                  </div>
                </button>

                {/* Direkte Schnellauswahl erste/aktuelle Seite als JPG/PNG */}
                {pages.length > 0 && (
                  <div className="mt-1 pt-1.5 border-t border-zinc-200/80 dark:border-zinc-800/80 px-2 pb-1">
                    <div className="text-[10px] text-zinc-500 mb-1 px-1">Schnellexport Seite 1:</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setIsExportDropdownOpen(false);
                          handleExportSinglePage(pages[0], 0, 'jpg');
                        }}
                        className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white rounded-lg text-[10px] font-semibold text-center transition-colors cursor-pointer"
                        title="Erste Seite direkt als JPG herunterladen"
                      >
                        S. 1 als JPG
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsExportDropdownOpen(false);
                          handleExportSinglePage(pages[0], 0, 'png');
                        }}
                        className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white rounded-lg text-[10px] font-semibold text-center transition-colors cursor-pointer"
                        title="Erste Seite direkt als PNG herunterladen"
                      >
                        S. 1 als PNG
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>


          {/* HAUPTAKTION 2: Direkt an Scanny übergeben */}
          <button
            type="button"
            id="studio-send-scanny-btn"
            disabled={isExporting}
            onClick={() => handleAssemble('scanny', 'pdf')}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/30 disabled:opacity-50"
            title="Dokument direkt in Scannys Posteingang / Ordner zur Texterkennung ablegen"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ScanLine className="w-3.5 h-3.5" />
            )}
            <span>In Scanny übernehmen</span>
          </button>

          {/* Schließen Icon */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Werkbank schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ZUSAMMENFÜHREN & STATUS BANNER */}
      {uniqueFiles.length > 1 && (
        <div className="bg-blue-950/50 border-b border-blue-900/60 px-6 py-2.5 flex items-center justify-between text-xs text-blue-200">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-blue-500/20 flex items-center justify-center shrink-0">
              <Merge className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <span className="font-semibold">
              PDFs zusammenführen: {uniqueFiles.length} Dokumente mit insgesamt {pages.length} Seiten werden zu einer Datei vereint.
            </span>
          </div>
          <span className="text-[11px] text-blue-300/80 hidden sm:inline flex items-center gap-1">
            <Move className="w-3 h-3 text-blue-400" />
            <span>Tipp: Seitenkacheln per Drag & Drop verschieben, um die Reihenfolge festzulegen</span>
          </span>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files) handleAppendFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={folderInputRef}
        // @ts-ignore
        webkitdirectory=""
        directory=""
        onChange={(e) => {
          if (e.target.files) handleAppendFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
        multiple
        className="hidden"
      />

      {/* Einstellungen Drawer (wenn aufgeklappt) */}
      {showSettings && (
        <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 animate-in slide-in-from-top-2 duration-150">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
            {/* 1. Seitenzahlen */}
            <div className="space-y-2 p-3 bg-zinc-100/80 dark:bg-zinc-950/60 rounded-xl border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-blue-400" />
                  Seitenzahlen
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pageNumbering.enabled}
                    onChange={(e) =>
                      setPageNumbering({ ...pageNumbering, enabled: e.target.checked })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-zinc-100 dark:bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {pageNumbering.enabled && (
                <div className="space-y-2 pt-2 border-t border-zinc-200/80 dark:border-zinc-800/80 text-[11px]">
                  <div>
                    <label className="text-zinc-500 dark:text-zinc-400 block mb-1">Position:</label>
                    <select
                      value={pageNumbering.position}
                      onChange={(e) =>
                        setPageNumbering({
                          ...pageNumbering,
                          position: e.target.value as any,
                        })
                      }
                      className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-2 py-1 text-zinc-800 dark:text-zinc-200"
                    >
                      <option value="bottom-center">Unten Mitte</option>
                      <option value="bottom-right">Unten Rechts</option>
                      <option value="bottom-left">Unten Links</option>
                      <option value="top-center">Oben Mitte</option>
                      <option value="top-right">Oben Rechts</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-zinc-500 dark:text-zinc-400 block mb-1">Format:</label>
                    <select
                      value={pageNumbering.format}
                      onChange={(e) =>
                        setPageNumbering({
                          ...pageNumbering,
                          format: e.target.value as any,
                        })
                      }
                      className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-2 py-1 text-zinc-800 dark:text-zinc-200"
                    >
                      <option value="page_x_of_y">Seite X von Y</option>
                      <option value="page_x">Seite X</option>
                      <option value="just_x">Nur Ziffer (X)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Komprimierung */}
            <div className="space-y-2 p-3 bg-zinc-100/80 dark:bg-zinc-950/60 rounded-xl border border-zinc-200 dark:border-zinc-800">
              <span className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                Dateigröße & Komprimierung
              </span>
              <div className="space-y-1.5 text-[11px] pt-1">
                {[
                  { id: 'none', label: 'Keine (Originalqualität)', sub: 'Kein Qualitätsverlust' },
                  { id: 'light', label: 'Leicht (300 DPI)', sub: 'Ideal für Druck' },
                  { id: 'medium', label: 'Ausgewogen (150 DPI)', sub: 'Empfohlen für E-Mail / Scanny' },
                  { id: 'high', label: 'Stark (72 DPI)', sub: 'Minimale Dateigröße' },
                ].map((opt) => (
                  <label
                    key={opt.id}
                    className={`flex items-start gap-2 p-1.5 rounded-lg border cursor-pointer transition-colors ${
                      compression === opt.id
                        ? 'bg-blue-600/15 border-blue-500/50 text-white'
                        : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="comp_setting"
                      checked={compression === opt.id}
                      onChange={() => setCompression(opt.id as CompressionLevel)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-medium text-zinc-800 dark:text-zinc-200">{opt.label}</div>
                      <div className="text-[10px] text-zinc-500">{opt.sub}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* 3. Ziel in Scanny */}
            <div className="space-y-2 p-3 bg-zinc-100/80 dark:bg-zinc-950/60 rounded-xl border border-zinc-200 dark:border-zinc-800">
              <span className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <FolderIcon className="w-3.5 h-3.5 text-blue-400" />
                Ziel bei Übergabe an Scanny
              </span>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Wählen Sie einen Ordner oder übergeben Sie das Dokument direkt an den Posteingang.
              </p>
              <select
                value={selectedFolderId === null ? '' : selectedFolderId}
                onChange={(e) =>
                  setSelectedFolderId(e.target.value === '' ? null : Number(e.target.value))
                }
                className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200 text-xs mt-2"
              >
                <option value="">Posteingang (Inbox - Automatisches Filing)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    📁 {f.name}
                  </option>
                ))}
              </select>

              <div className="pt-3 border-t border-zinc-200/80 dark:border-zinc-800/80">
                <button
                  type="button"
                  onClick={() => handleAssemble('download', 'images_zip')}
                  className="w-full py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-700 rounded-lg text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-3 h-3 text-zinc-500 dark:text-zinc-400" />
                  <span>Als Bilder-ZIP herunterladen</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Benachrichtigungen / Status-Meldungen */}
      {exportSuccessMessage && (
        <div className="bg-emerald-950/80 border-b border-emerald-800/80 px-6 py-2.5 flex items-center justify-between text-xs text-emerald-200">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-semibold">{exportSuccessMessage}</span>
          </div>
          <div className="flex items-center gap-2">
            {onOpenInbox && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenInbox();
                }}
                className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>Zum Posteingang</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setExportSuccessMessage(null)}
              className="p-1 text-emerald-400 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 dark:bg-red-950/80 border-b border-red-200 dark:border-red-800/80 px-6 py-2.5 flex items-center justify-between text-xs text-red-800 dark:text-red-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 text-red-400 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Hauptbereich: Die Seitenkacheln (Grid) */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 px-1">
            <span className="flex items-center gap-2">
              <span>💡 Tipp:</span>
              <span className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300">
                <Move className="w-3 h-3 text-indigo-400" />
                <span>Seiten per Drag & Drop verschieben</span>
              </span>
              <span>•</span>
              <span className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300">
                <RotateCw className="w-3 h-3 text-amber-400" />
                <span>Mit 90° / 180° drehen</span>
              </span>
            </span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                {pages.length} Seiten im Dokument
              </span>
            </div>
          </div>

          <div
            id="studio-pages-grid"
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
          >
            {pages.map((page, index) => {
              const isDragging = draggedPageIndex === index;
              const isOver = dragOverIndex === index;

              return (
                <div
                  key={page.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={() => handleDrop(index)}
                  className={`group relative bg-white dark:bg-zinc-900 border rounded-2xl p-2.5 flex flex-col justify-between transition-all select-none shadow-sm ${
                    isDragging ? 'opacity-40 scale-95 border-blue-500' : 'opacity-100'
                  } ${
                    isOver ? 'border-blue-400 shadow-lg shadow-blue-500/20 scale-102' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  {/* Obere Leiste der Seite: Seitennummer, Drehungs-Status & Drehtasten */}
                  <div className="flex items-center justify-between mb-2 px-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200">
                        Seite {index + 1}
                      </span>
                      <span
                        className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-grab active:cursor-grabbing p-0.5"
                        title="Mit gedrückter Maustaste verschieben (Drag & Drop)"
                      >
                        <Move className="w-3 h-3" />
                      </span>
                    </div>

                    {/* Rotation Badge wenn gedreht */}
                    {page.rotation !== 0 ? (
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                        ↺ {page.rotation}°
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-500 font-mono">0°</span>
                    )}

                    {/* Einzel-Dreh-Buttons mit intuitiven Tooltips */}
                    <div className="flex items-center gap-0.5 bg-zinc-100/80 dark:bg-zinc-800/80 p-0.5 rounded-lg border border-zinc-300/70 dark:border-zinc-700/60">
                      <button
                        type="button"
                        onClick={() => handleRotatePage(index, -90)}
                        className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded transition-colors cursor-pointer"
                        title="Diese Seite um 90° nach links drehen (↺)"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-blue-400" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRotatePage(index, 90)}
                        className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded transition-colors cursor-pointer"
                        title="Diese Seite um 90° nach rechts drehen (↻)"
                      >
                        <RotateCw className="w-3.5 h-3.5 text-blue-400" />
                      </button>
                    </div>
                  </div>

                  {/* Vorschaubild der Seite mit Drehungs-Transformation */}
                  <div
                    onClick={() => setZoomPage(page)}
                    className="relative aspect-[3/4] bg-zinc-100 dark:bg-zinc-950 rounded-xl overflow-hidden flex items-center justify-center cursor-pointer border border-zinc-200/80 dark:border-zinc-800/80 group-hover:border-zinc-400 dark:group-hover:border-zinc-700 transition-colors"
                  >
                    <img
                      src={page.thumbnailUrl}
                      alt={`Seite ${index + 1}`}
                      style={{
                        transform: `rotate(${page.rotation}deg)`,
                        transition: 'transform 0.2s ease',
                      }}
                      className="max-h-full max-w-full object-contain pointer-events-none drop-shadow-md"
                    />

                    {/* Hover Zoom & Quick-Rotate Overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-between p-2 transition-opacity">
                      <div className="p-1.5 bg-white/90 dark:bg-zinc-900/90 rounded-xl text-zinc-900 dark:text-white shadow-lg flex items-center gap-1 text-[10px] font-semibold">
                        <ZoomIn className="w-3.5 h-3.5" />
                        <span>Vergrößern</span>
                      </div>
                      {/* Schnellklick-Tasten direkt auf dem Bild */}
                      <div className="w-full flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRotatePage(index, -90);
                            }}
                            className="px-1.5 py-1 bg-white/95 dark:bg-zinc-900/95 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-[10px] font-semibold flex items-center gap-0.5 shadow-md border border-zinc-300 dark:border-zinc-700 cursor-pointer"
                            title="90° nach links drehen"
                          >
                            <RotateCcw className="w-3 h-3 text-blue-400" />
                            <span>90°L</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRotatePage(index, 90);
                            }}
                            className="px-1.5 py-1 bg-white/95 dark:bg-zinc-900/95 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-[10px] font-semibold flex items-center gap-0.5 shadow-md border border-zinc-300 dark:border-zinc-700 cursor-pointer"
                            title="90° nach rechts drehen"
                          >
                            <RotateCw className="w-3 h-3 text-blue-400" />
                            <span>90°R</span>
                          </button>
                        </div>

                        {/* Quick-Export JPG/PNG buttons */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExportSinglePage(page, index, 'jpg');
                            }}
                            className="px-1.5 py-1 bg-emerald-950/90 hover:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded-lg text-[10px] font-bold shadow-md border border-emerald-700/80 cursor-pointer"
                            title="Diese Seite sofort als JPG herunterladen"
                          >
                            JPG
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExportSinglePage(page, index, 'png');
                            }}
                            className="px-1.5 py-1 bg-blue-950/90 hover:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg text-[10px] font-bold shadow-md border border-blue-700/80 cursor-pointer"
                            title="Diese Seite sofort als PNG herunterladen"
                          >
                            PNG
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Fußleiste der Karte: Dateiname & Aktionen */}
                  <div className="mt-2.5 pt-2 border-t border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between text-xs">
                    <span
                      className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[80px]"
                      title={page.sourceFileName}
                    >
                      {page.sourceFileName}
                    </span>

                    <div className="flex items-center gap-0.5">
                      {/* Einzelseite Exportieren Dropdown-Menü */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveCardExportMenu(activeCardExportMenu === index ? null : index);
                          }}
                          className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-emerald-400 rounded cursor-pointer transition-colors"
                          title="Seite exportieren (JPG, PNG, PDF)"
                        >
                          <Download className="w-3 h-3 text-emerald-400" />
                        </button>

                        {activeCardExportMenu === index && (
                          <div
                            className="absolute right-0 bottom-full mb-1.5 w-48 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl shadow-2xl p-1 z-50 text-left animate-in fade-in zoom-in-95 duration-100"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                              Seite {index + 1} exportieren
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveCardExportMenu(null);
                                handleExportSinglePage(page, index, 'jpg');
                              }}
                              className="w-full px-2 py-1.5 rounded-lg text-left text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-between cursor-pointer"
                            >
                              <span>Als JPG (.jpg)</span>
                              <ImageIcon className="w-3 h-3 text-emerald-400" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveCardExportMenu(null);
                                handleExportSinglePage(page, index, 'png');
                              }}
                              className="w-full px-2 py-1.5 rounded-lg text-left text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-between cursor-pointer"
                            >
                              <span>Als PNG (.png)</span>
                              <ImageIcon className="w-3 h-3 text-blue-400" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveCardExportMenu(null);
                                handleExportSinglePage(page, index, 'pdf');
                              }}
                              className="w-full px-2 py-1.5 rounded-lg text-left text-[11px] font-medium text-zinc-800 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-between cursor-pointer"
                            >
                              <span>Als PDF (.pdf)</span>
                              <FileText className="w-3 h-3 text-red-400" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Nach links verschieben */}
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => handleMovePage(index, index - 1)}
                        className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded disabled:opacity-20 cursor-pointer transition-colors"
                        title="Seite nach links schieben"
                      >
                        <MoveLeft className="w-3 h-3" />
                      </button>

                      {/* Nach rechts verschieben */}
                      <button
                        type="button"
                        disabled={index === pages.length - 1}
                        onClick={() => handleMovePage(index, index + 1)}
                        className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded disabled:opacity-20 cursor-pointer transition-colors"
                        title="Seite nach rechts schieben"
                      >
                        <MoveRight className="w-3 h-3" />
                      </button>

                      {/* Duplizieren */}
                      <button
                        type="button"
                        onClick={() => handleDuplicatePage(index)}
                        className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded cursor-pointer transition-colors"
                        title="Seite duplizieren"
                      >
                        <Copy className="w-3 h-3" />
                      </button>

                      {/* Löschen */}
                      <button
                        type="button"
                        onClick={() => handleDeletePage(index)}
                        className="p-1 hover:bg-red-950/60 text-zinc-500 dark:text-zinc-400 hover:text-red-400 rounded cursor-pointer transition-colors"
                        title="Seite entfernen"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

              );
            })}

            {/* Kachel zum Hinzufügen weiterer Dateien / Ordner */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="aspect-[3/4] border-2 border-dashed border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-100/60 dark:bg-zinc-900/40 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-2xl flex flex-col items-center justify-center p-4 text-center cursor-pointer transition-all group"
            >
              <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 group-hover:bg-blue-600/20 text-zinc-500 dark:text-zinc-400 group-hover:text-blue-400 border border-zinc-300 dark:border-zinc-700 group-hover:border-blue-500/30 flex items-center justify-center mb-2 transition-colors">
                <Plus className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 group-hover:text-white">
                Seiten anhängen
              </p>
              <p className="text-[10px] text-zinc-500 mt-1">PDF, Bilder oder Dokumente</p>
            </div>
          </div>
        </div>
      </main>

      {/* Lightbox / Vollbild-Zoom Modal für eine Seite */}
      {zoomPage && (
        <div
          className="fixed inset-0 z-60 bg-black/85 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-150"
          onClick={() => setZoomPage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800 text-xs">
              <div>
                <span className="font-semibold text-zinc-900 dark:text-white">{zoomPage.sourceFileName}</span>
                <span className="text-zinc-500 dark:text-zinc-400 ml-2">Original Seite {zoomPage.originalPageIndex + 1}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Drehung gilt für die Seite in der Werkbank (und damit für den Export), nicht nur für die Großansicht
                    const rotation = ((zoomPage.rotation + 90) % 360 + 360) % 360;
                    setPages((prev) => prev.map((p) => (p.id === zoomPage.id ? { ...p, rotation } : p)));
                    setZoomPage({ ...zoomPage, rotation });
                  }}
                  className="px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>90° drehen</span>
                </button>
                <button
                  type="button"
                  onClick={() => setZoomPage(null)}
                  className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto flex items-center justify-center p-4 min-h-[300px]">
              <img
                src={zoomPage.thumbnailUrl}
                alt={zoomPage.sourceFileName}
                style={{
                  transform: `rotate(${zoomPage.rotation}deg)`,
                  transition: 'transform 0.2s ease',
                }}
                className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Einzelseiten-Export als JPG, PNG oder PDF */}
      <SinglePageExportModal
        isOpen={isSinglePageModalOpen}
        pages={pages}
        sessionId={sessionId}
        documentTitle={title}
        onClose={() => setIsSinglePageModalOpen(false)}
        onExport={handleExportSinglePage}
        isExporting={isExporting}
      />
    </div>
  );
}
