import React, { useState } from 'react';
import { readJson } from '../../apiJson';
import { X, ScanText, Upload, Copy, Check, Download, AlertCircle, Loader2 } from 'lucide-react';

interface PdfOcrModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PdfOcrModal({ isOpen, onClose }: PdfOcrModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [charCount, setCharCount] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExtract = async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    setExtractedText(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/tools/extract-text', {
        method: 'POST',
        body: formData,
      });

      const data = await readJson(res);
      if (!res.ok) {
        throw new Error(data.error || 'Fehler bei der Texterkennung.');
      }
      if (!data.text || !data.text.trim()) {
        // Sonst bliebe die Ansicht einfach unverändert – als wäre nichts passiert
        throw new Error('In dieser Datei wurde kein Text gefunden (auch nicht per Texterkennung).');
      }
      setExtractedText(data.text);
      setCharCount(data.characterCount || data.text.length);
    } catch (err: any) {
      setError(err.message || 'Texterkennung fehlgeschlagen.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = async () => {
    if (!extractedText) return;
    try {
      await navigator.clipboard.writeText(extractedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Kopieren nicht möglich – bitte den Text markieren und mit ⌘C kopieren.');
    }
  };

  const handleDownloadTxt = () => {
    if (!extractedText) return;
    const blob = new Blob([extractedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file?.name.replace(/\.[^/.]+$/, '') || 'text'}_extrahiert.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      id="pdf-ocr-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-900 dark:text-zinc-100 p-6 space-y-4 max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center">
              <ScanText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Text erkennen (OCR)</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Gedruckten und eingescannten Text auslesen und kopieren</p>
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

        {!extractedText ? (
          <div className="space-y-4">
            {!file ? (
              <label className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors bg-zinc-50/70 dark:bg-zinc-950/40">
                <Upload className="w-8 h-8 text-zinc-400 mb-2" />
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Dokument oder Bild auswählen</span>
                <span className="text-[11px] text-zinc-500 mt-0.5">Unterstützt PDF, JPG, PNG, WEBP</span>
                <input
                  type="file"
                  accept=".pdf,image/*"
                  onChange={(e) => {
                    if (e.target.files?.[0]) setFile(e.target.files[0]);
                  }}
                  className="hidden"
                />
              </label>
            ) : (
              <div className="p-3.5 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white cursor-pointer ml-2 shrink-0"
                >
                  Ändern
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={!file || isProcessing}
              onClick={handleExtract}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-600/20"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Text wird erkannt…</span>
                </>
              ) : (
                <span>Text jetzt extrahieren</span>
              )}
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col space-y-3 min-h-[300px]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500 dark:text-zinc-400 font-mono">{charCount} Zeichen erkannt</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Kopiert!' : 'Kopieren'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadTxt}
                  className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Als .txt</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExtractedText(null);
                    setFile(null);
                  }}
                  className="px-2.5 py-1.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white text-xs cursor-pointer"
                >
                  Neu
                </button>
              </div>
            </div>

            <textarea
              readOnly
              value={extractedText}
              className="flex-1 w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 font-mono text-xs text-zinc-800 dark:text-zinc-200 resize-none focus:outline-none select-all"
            />
          </div>
        )}
      </div>
    </div>
  );
}
