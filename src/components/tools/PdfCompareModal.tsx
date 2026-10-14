import React, { useState } from 'react';
import { X, Columns2, Upload, FileText } from 'lucide-react';

interface PdfCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PdfCompareModal({ isOpen, onClose }: PdfCompareModalProps) {
  const [file1Url, setFile1Url] = useState<string | null>(null);
  const [file1Name, setFile1Name] = useState<string>('');
  const [file2Url, setFile2Url] = useState<string | null>(null);
  const [file2Name, setFile2Name] = useState<string>('');

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, side: 1 | 2) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    // Vorherige Vorschau freigeben, sonst bleibt jede gewählte Datei im Speicher
    const previous = side === 1 ? file1Url : file2Url;
    if (previous) URL.revokeObjectURL(previous);
    if (side === 1) {
      setFile1Url(url);
      setFile1Name(file.name);
    } else {
      setFile2Url(url);
      setFile2Name(file.name);
    }
  };

  return (
    <div
      id="pdf-compare-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col p-4 animate-in fade-in duration-150"
    >
      <header className="h-14 px-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-t-2xl flex items-center justify-between shrink-0 text-zinc-900 dark:text-white">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center">
            <Columns2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">PDFs vergleichen</h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Zwei Dokumente nebeneinander anzeigen und prüfen</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1 bg-zinc-100 dark:bg-zinc-950 border-x border-b border-zinc-200 dark:border-zinc-800 rounded-b-2xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden">
        {/* Dokument 1 (Links) */}
        <div className="flex flex-col bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300">
            <span className="font-semibold truncate max-w-[200px]">
              {file1Name || 'Dokument A (Original)'}
            </span>
            <label className="px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded-lg cursor-pointer text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition-colors">
              <Upload className="w-3 h-3" />
              <span>Datei wählen</span>
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => handleFileChange(e, 1)}
                className="hidden"
              />
            </label>
          </div>
          <div className="flex-1 flex items-center justify-center p-2 bg-zinc-50 dark:bg-zinc-950/50">
            {file1Url ? (
              <iframe src={file1Url} title="Dokument A" className="w-full h-full rounded border-0" />
            ) : (
              <div className="text-center p-6 text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 text-xs space-y-2">
                <FileText className="w-10 h-10 mx-auto opacity-30" />
                <p>Erstes Dokument auswählen oder hineinziehen</p>
              </div>
            )}
          </div>
        </div>

        {/* Dokument 2 (Rechts) */}
        <div className="flex flex-col bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300">
            <span className="font-semibold truncate max-w-[200px]">
              {file2Name || 'Dokument B (Vergleich)'}
            </span>
            <label className="px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded-lg cursor-pointer text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition-colors">
              <Upload className="w-3 h-3" />
              <span>Datei wählen</span>
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => handleFileChange(e, 2)}
                className="hidden"
              />
            </label>
          </div>
          <div className="flex-1 flex items-center justify-center p-2 bg-zinc-50 dark:bg-zinc-950/50">
            {file2Url ? (
              <iframe src={file2Url} title="Dokument B" className="w-full h-full rounded border-0" />
            ) : (
              <div className="text-center p-6 text-zinc-500 dark:text-zinc-400 dark:text-zinc-500 text-xs space-y-2">
                <FileText className="w-10 h-10 mx-auto opacity-30" />
                <p>Zweites Dokument zum Vergleichen auswählen</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
