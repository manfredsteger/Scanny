import React, { useState } from 'react';
import { X, Minimize2, Upload, Download, Check, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

interface PdfCompressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export function PdfCompressModal({ isOpen, onClose, onRefresh }: PdfCompressModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [level, setLevel] = useState<'light' | 'medium' | 'high'>('medium');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{
    originalSize: number;
    newSize: number;
    savedPercent: number;
    downloadUrl: string;
    tmpFile: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inboxSuccess, setInboxSuccess] = useState(false);

  if (!isOpen) return null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleCompress = async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('level', level);

      const res = await fetch('/api/tools/quick-compress', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Fehler beim Komprimieren.');
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Komprimierung fehlgeschlagen.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendToScanny = async () => {
    if (!result) return;
    setIsProcessing(true);
    try {
      // Ingest the compressed file
      const downloadRes = await fetch(result.downloadUrl);
      const blob = await downloadRes.blob();
      const uploadData = new FormData();
      uploadData.append('files', blob, file?.name.replace('.pdf', '_komprimiert.pdf') || 'komprimiert.pdf');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: uploadData,
      });

      if (!res.ok) throw new Error('Übergabe an Scanny fehlgeschlagen.');
      setInboxSuccess(true);
      await onRefresh();
    } catch (err: any) {
      setError(err.message || 'Fehler beim Übergeben an Scanny.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      id="pdf-compress-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-900 dark:text-zinc-100 p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center">
              <Minimize2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">PDF komprimieren</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Dateigröße optimieren und reduzieren</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/80 rounded-xl flex items-center gap-2 text-xs text-red-700 dark:text-red-200">
            <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Datei Upload Bereich */}
        {!file ? (
          <label className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors bg-zinc-50/70 dark:bg-zinc-950/40">
            <Upload className="w-8 h-8 text-zinc-400 mb-2" />
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">PDF-Datei auswählen oder hier ablegen</span>
            <span className="text-[11px] text-zinc-500 mt-0.5">Unterstützt alle PDF-Dokumente</span>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => {
                if (e.target.files?.[0]) setFile(e.target.files[0]);
              }}
              className="hidden"
            />
          </label>
        ) : (
          <div className="p-3.5 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-between text-xs">
            <div className="truncate max-w-[280px]">
              <span className="font-semibold text-zinc-800 dark:text-zinc-200 block truncate">{file.name}</span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{formatSize(file.size)}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setResult(null);
                setInboxSuccess(false);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white cursor-pointer"
            >
              Ändern
            </button>
          </div>
        )}

        {/* Qualitätseinstellungen */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Komprimierungsstufe:</label>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              { id: 'light', label: 'Leicht', sub: '300 DPI (Druck)' },
              { id: 'medium', label: 'Ausgewogen', sub: '150 DPI (Optimal)' },
              { id: 'high', label: 'Stark', sub: '72 DPI (Kompakt)' },
            ].map((opt) => (
              <button
                type="button"
                key={opt.id}
                onClick={() => setLevel(opt.id as any)}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                  level === opt.id
                    ? 'bg-emerald-50 dark:bg-emerald-600/20 border-emerald-500 text-emerald-950 dark:text-white font-medium ring-1 ring-emerald-500'
                    : 'bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-200">{opt.label}</div>
                <div className="text-[10px] text-zinc-500">{opt.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Ergebnis Box */}
        {result && (
          <div className="p-4 bg-emerald-950/50 border border-emerald-800/80 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-400" />
                Erfolgreich komprimiert!
              </span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-600/40 text-emerald-200 font-mono">
                -{result.savedPercent}%
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-300">
              <div>
                <span className="text-[10px] text-zinc-400 block">Vorher:</span>
                <span className="font-mono">{formatSize(result.originalSize)}</span>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-500" />
              <div>
                <span className="text-[10px] text-zinc-400 block">Nachher:</span>
                <span className="font-mono text-emerald-300 font-bold">{formatSize(result.newSize)}</span>
              </div>
            </div>

            {inboxSuccess ? (
              <div className="text-xs text-emerald-300 font-medium text-center py-1">
                ✓ Dokument wurde an Ihren Scanny-Posteingang übergeben!
              </div>
            ) : (
              <div className="flex items-center gap-2 pt-1">
                <a
                  href={result.downloadUrl}
                  download
                  className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Herunterladen</span>
                </a>
                <button
                  type="button"
                  onClick={handleSendToScanny}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>In Scanny übernehmen</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Aktions-Button */}
        {!result && (
          <button
            type="button"
            disabled={!file || isProcessing}
            onClick={handleCompress}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-600/20"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Wird komprimiert…</span>
              </>
            ) : (
              <span>Jetzt komprimieren</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
