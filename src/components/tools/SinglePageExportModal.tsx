import React, { useState } from 'react';
import {
  X,
  Download,
  Image as ImageIcon,
  FileText,
  Check,
  Loader2,
  Sparkles,
  Layers,
} from 'lucide-react';
import { StudioPageItem } from '../../types';

interface SinglePageExportModalProps {
  isOpen: boolean;
  pages: StudioPageItem[];
  sessionId: string;
  documentTitle: string;
  onClose: () => void;
  onExport: (
    page: StudioPageItem,
    pageIndex: number,
    format: 'jpg' | 'png' | 'pdf'
  ) => Promise<void>;
  isExporting: boolean;
}

export function SinglePageExportModal({
  isOpen,
  pages,
  documentTitle,
  onClose,
  onExport,
  isExporting,
}: SinglePageExportModalProps) {
  const [selectedPageIndex, setSelectedPageIndex] = useState<number>(0);
  const [selectedFormat, setSelectedFormat] = useState<'jpg' | 'png' | 'pdf'>('jpg');
  const [isDownloading, setIsDownloading] = useState(false);

  if (!isOpen || pages.length === 0) return null;

  const currentPage = pages[selectedPageIndex] || pages[0];

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await onExport(currentPage, selectedPageIndex, selectedFormat);
      onClose();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      id="single-page-export-modal"
      className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-zinc-900 dark:text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-white">
                Einzelseite als Bild oder PDF exportieren
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Wählen Sie eine Seite und das gewünschte Zielformat (JPG, PNG oder PDF).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
          {/* 1. Format-Auswahl */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Zielformat wählen:
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setSelectedFormat('jpg')}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  selectedFormat === 'jpg'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500/20'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-zinc-900 dark:text-white">
                    JPG Bild (.jpg)
                  </span>
                  {selectedFormat === 'jpg' && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Kompakt, universell kompatibel für E-Mail & Web.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedFormat('png')}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  selectedFormat === 'png'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500/20'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-zinc-900 dark:text-white">
                    PNG Bild (.png)
                  </span>
                  {selectedFormat === 'png' && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Verlustfreie Schärfe, ideal für Dokumententext & Scans.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedFormat('pdf')}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  selectedFormat === 'pdf'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500/20'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-zinc-900 dark:text-white">
                    Einzelseiten-PDF (.pdf)
                  </span>
                  {selectedFormat === 'pdf' && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Nur diese Seite als eigenständiges PDF.
                </p>
              </button>
            </div>
          </div>

          {/* 2. Seiten-Auswahl */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Seite auswählen:
              </label>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Seite {selectedPageIndex + 1} von {pages.length}
              </span>
            </div>

            {/* Horizontale Thumbnail-Leiste */}
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5 max-h-48 overflow-y-auto p-1 border border-zinc-200 dark:border-zinc-800 rounded-2xl bg-zinc-50/50 dark:bg-zinc-950/50">
              {pages.map((page, idx) => {
                const isSelected = selectedPageIndex === idx;
                return (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => setSelectedPageIndex(idx)}
                    className={`relative p-1.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50 shadow-sm ring-2 ring-blue-500/30'
                        : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="aspect-[3/4] w-full bg-zinc-100 dark:bg-zinc-950 rounded-lg overflow-hidden flex items-center justify-center mb-1">
                      <img
                        src={page.thumbnailUrl}
                        alt={`Seite ${idx + 1}`}
                        style={{ transform: `rotate(${page.rotation}deg)` }}
                        className="max-h-full max-w-full object-contain pointer-events-none"
                      />
                    </div>
                    <span
                      className={`text-[10px] font-mono font-bold ${
                        isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      S. {idx + 1}
                    </span>
                    {page.rotation !== 0 && (
                      <span className="text-[9px] text-blue-500 dark:text-blue-400">
                        {page.rotation}°
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Vorschau der gewählten Seite */}
          <div className="p-3 bg-zinc-100 dark:bg-zinc-950/70 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex items-center gap-4">
            <div className="w-16 h-20 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
              <img
                src={currentPage.thumbnailUrl}
                alt="Vorschau"
                style={{ transform: `rotate(${currentPage.rotation}deg)` }}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="text-xs space-y-1 min-w-0">
              <div className="font-semibold text-zinc-900 dark:text-white truncate">
                {documentTitle || 'Dokument'}_Seite_{selectedPageIndex + 1}.{selectedFormat}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Ursprung: {currentPage.sourceFileName} (Original Seite {currentPage.originalPageIndex + 1})
              </div>
              <div className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1 font-medium">
                <Sparkles className="w-3 h-3" />
                <span>
                  Wird in hoher 200 DPI Auflösung mit {currentPage.rotation}° Drehung gerendert
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/80 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Abbrechen
          </button>

          <button
            type="button"
            disabled={isDownloading || isExporting}
            onClick={handleDownload}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {isDownloading || isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>
              Seite {selectedPageIndex + 1} als {selectedFormat.toUpperCase()} herunterladen
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
