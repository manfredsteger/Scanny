import React, { useState, useRef } from 'react';
import { X, ShieldX, Upload, Download, Check, AlertCircle, Loader2, Undo2 } from 'lucide-react';

interface PdfRedactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface RedactBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function PdfRedactModal({ isOpen, onClose }: PdfRedactModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [boxes, setBoxes] = useState<RedactBox[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPdfPreviewUrl(URL.createObjectURL(f));
    setBoxes([]);
    setDownloadUrl(null);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setIsDrawing(true);
    setStartPos({ x, y });
    setCurrentBox({ x, y, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !startPos || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const x = Math.min(startPos.x, curX);
    const y = Math.min(startPos.y, curY);
    const width = Math.abs(curX - startPos.x);
    const height = Math.abs(curY - startPos.y);

    setCurrentBox({ x, y, width, height });
  };

  const handleMouseUp = () => {
    if (isDrawing && currentBox && currentBox.width > 5 && currentBox.height > 5) {
      setBoxes((prev) => [...prev, { page: 0, ...currentBox }]);
    }
    setIsDrawing(false);
    setStartPos(null);
    setCurrentBox(null);
  };

  const handleApplyRedaction = async () => {
    if (!file || boxes.length === 0) return;
    setIsProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('boxes', JSON.stringify(boxes));

      const res = await fetch('/api/tools/redact', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Fehler beim Zensieren.');
      }

      const data = await res.json();
      setDownloadUrl(data.downloadUrl);
    } catch (err: any) {
      setError(err.message || 'Fehler beim Zensieren.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      id="pdf-redact-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col p-4 animate-in fade-in duration-150"
    >
      <header className="h-14 px-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-t-2xl flex items-center justify-between shrink-0 text-zinc-900 dark:text-white">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-center">
            <ShieldX className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">PDF zensieren (Schwärzen)</h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Ziehen Sie Rechtecke über vertrauliche Daten, um sie dauerhaft unkenntlich zu machen</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {boxes.length > 0 && (
            <button
              type="button"
              onClick={() => setBoxes((prev) => prev.slice(0, -1))}
              className="px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Rückgängig ({boxes.length})</span>
            </button>
          )}

          {downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Zensiertes PDF herunterladen</span>
            </a>
          ) : (
            <button
              type="button"
              disabled={!file || boxes.length === 0 || isProcessing}
              onClick={handleApplyRedaction}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Schwärzungen dauerhaft anwenden</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer ml-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 bg-zinc-100 dark:bg-zinc-950 border-x border-b border-zinc-200 dark:border-zinc-800 rounded-b-2xl p-4 flex flex-col items-center justify-center overflow-auto">
        {!file ? (
          <label className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer transition-colors max-w-md w-full bg-white/70 dark:bg-zinc-900/40">
            <Upload className="w-10 h-10 text-zinc-400 mb-3" />
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">PDF zum Zensieren auswählen</span>
            <span className="text-xs text-zinc-500 mt-1">Danach vertrauliche Daten mit der Maus markieren</span>
            <input type="file" accept=".pdf" onChange={handleFileChange} className="hidden" />
          </label>
        ) : (
          <div
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="relative w-full max-w-3xl aspect-[1/1.4] bg-white rounded-lg shadow-2xl cursor-crosshair overflow-hidden select-none"
          >
            {pdfPreviewUrl && (
              <iframe
                src={`${pdfPreviewUrl}#toolbar=0&navpanes=0`}
                title="PDF Vorschau"
                className="w-full h-full pointer-events-none"
              />
            )}

            {/* Bereits gezeichnete Schwärzungen */}
            {boxes.map((b, idx) => (
              <div
                key={idx}
                style={{
                  left: b.x,
                  top: b.y,
                  width: b.width,
                  height: b.height,
                }}
                className="absolute bg-black pointer-events-none"
              />
            ))}

            {/* Aktuelle Zeichnung */}
            {isDrawing && currentBox && (
              <div
                style={{
                  left: currentBox.x,
                  top: currentBox.y,
                  width: currentBox.width,
                  height: currentBox.height,
                }}
                className="absolute bg-black/80 border border-red-500 pointer-events-none"
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
