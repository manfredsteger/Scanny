import React, { useRef, useState } from 'react';
import { X, EyeOff, Upload, Loader2, Undo2, Trash2, Download, Inbox, ShieldCheck, AlertTriangle, Pencil } from 'lucide-react';
import { readJson } from '../../apiJson';

interface PdfRedactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => Promise<void> | void;
}

interface PageInfo {
  index: number;
  url: string;
  width: number;
  height: number;
}

/** Markierung als Anteil der angezeigten Seite (0..1) – unabhängig von Bildschirmgröße und Zoom. */
interface Box {
  id: number;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Result {
  pages: number[];
  removedWords: number;
  leaked: string[];
  searchable: boolean;
  previews: { page: number; url: string | null }[];
  downloadUrl: string;
  fileName: string;
}

/**
 * Werkzeug "Bereiche schwärzen": Der Nutzer markiert von Hand, was unkenntlich werden soll.
 * Der Server entfernt den Inhalt darunter wirklich (Seite wird als Bild neu aufgebaut) und prüft
 * danach, dass die Wörter aus den markierten Bereichen nicht mehr im PDF stecken.
 */
export function PdfRedactModal({ isOpen, onClose, onRefresh }: PdfRedactModalProps) {
  const [token, setToken] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [drawing, setDrawing] = useState<{ page: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [sentToScanny, setSentToScanny] = useState(false);
  const nextId = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('PDF wird geöffnet…');
    setError(null);
    setResult(null);
    setBoxes([]);
    setSentToScanny(false);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/tools/redact/prepare', { method: 'POST', body: formData });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Das PDF konnte nicht geöffnet werden.');
      setToken(data.token);
      setFileName(data.name);
      setPages(data.pages);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const relative = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    };
  };

  const onPointerDown = (page: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (result || busy) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = relative(e);
    setDrawing({ page, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    const p = relative(e);
    setDrawing({ ...drawing, x1: p.x, y1: p.y });
  };
  const onPointerUp = () => {
    if (!drawing) return;
    const x = Math.min(drawing.x0, drawing.x1);
    const y = Math.min(drawing.y0, drawing.y1);
    const w = Math.abs(drawing.x1 - drawing.x0);
    const h = Math.abs(drawing.y1 - drawing.y0);
    // Versehentliche Klicks (winzige Kästen) ignorieren
    if (w > 0.005 && h > 0.004) setBoxes((prev) => [...prev, { id: nextId.current++, page: drawing.page, x, y, w, h }]);
    setDrawing(null);
  };

  const apply = async () => {
    if (!token || boxes.length === 0) return;
    setBusy('Inhalt wird entfernt und geprüft… (bei vielen Seiten bis zu einer Minute)');
    setError(null);
    try {
      const res = await fetch('/api/tools/redact/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, boxes: boxes.map(({ id, ...b }) => b) }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Schwärzen fehlgeschlagen.');
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const sendToScanny = async () => {
    if (!token) return;
    setBusy('Wird an Scanny übergeben…');
    try {
      const res = await fetch(`/api/tools/redact/${token}/to-scanny`, { method: 'POST' });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Übergabe fehlgeschlagen.');
      setSentToScanny(true);
      await onRefresh?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const boxStyle = (b: { x: number; y: number; w: number; h: number }) => ({
    left: `${b.x * 100}%`,
    top: `${b.y * 100}%`,
    width: `${b.w * 100}%`,
    height: `${b.h * 100}%`,
  });

  return (
    <div
      id="pdf-redact-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!result) loadFile(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="w-full max-w-4xl max-h-[94vh] flex flex-col bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-900 dark:text-zinc-100">
        {/* Kopf */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center shrink-0">
              <EyeOff className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Bereiche schwärzen</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 max-w-xl">
                Werkzeug: <strong>Du markierst selbst</strong>, was unkenntlich werden soll (z. B. IBAN, Adresse,
                Steuer-ID). Scanny entfernt den Inhalt darunter dauerhaft – auch aus der Textebene – und prüft das
                Ergebnis. Dein Original bleibt unverändert.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer" aria-label="Schließen">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Inhalt */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-zinc-50 dark:bg-zinc-950">
          {!token && (
            <button
              type="button"
              id="redact-pick-file"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-12 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 flex flex-col items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300 cursor-pointer"
            >
              <Upload className="w-6 h-6" />
              PDF auswählen oder hierher ziehen
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              loadFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          {token && !result && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5" /> Mit gedrückter Maustaste einen Rahmen über die Stelle ziehen. Markierungen
              lassen sich über das ✕ wieder entfernen.
            </p>
          )}

          {result && (
            <div
              id="redact-result"
              className={`p-4 rounded-xl border text-sm space-y-1 ${
                result.leaked.length === 0
                  ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                  : 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {result.leaked.length === 0 ? <ShieldCheck className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                {result.leaked.length === 0
                  ? `Geschwärzt und geprüft – Seite${result.pages.length > 1 ? 'n' : ''} ${result.pages.join(', ')}`
                  : 'Achtung: Prüfung nicht bestanden'}
              </div>
              <p className="text-xs">
                {result.leaked.length === 0
                  ? result.removedWords > 0
                    ? `${result.removedWords} Wort/Wörter unter den Markierungen sind im Ergebnis nicht mehr enthalten – weder sichtbar noch per Suche oder Kopieren.`
                    : 'Unter den Markierungen stand kein auslesbarer Text (z. B. Foto/Scan) – der Bereich ist trotzdem dauerhaft geschwärzt.'
                  : `Diese Wörter sind noch auffindbar: ${result.leaked.join(', ')}. Bitte die Markierung größer ziehen und erneut anwenden.`}
              </p>
              {!result.searchable && (
                <p className="text-xs opacity-80">Hinweis: Die geschwärzten Seiten sind nicht durchsuchbar (Texterkennung fehlgeschlagen).</p>
              )}
            </div>
          )}

          {/* Seiten */}
          {token && !result &&
            pages.map((page) => (
              <div key={page.index} className="space-y-1">
                <div className="text-[11px] text-zinc-500">Seite {page.index + 1}</div>
                <div
                  id={`redact-page-${page.index}`}
                  className="relative mx-auto bg-white shadow-sm border border-zinc-200 dark:border-zinc-700 select-none touch-none cursor-crosshair"
                  style={{ maxWidth: Math.min(page.width * 1.2, 760), aspectRatio: `${page.width} / ${page.height}` }}
                  onPointerDown={onPointerDown(page.index)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => setDrawing(null)}
                >
                  <img src={page.url} alt={`Seite ${page.index + 1}`} draggable={false} className="w-full h-full pointer-events-none" />
                  {boxes
                    .filter((b) => b.page === page.index)
                    .map((b) => (
                      <div key={b.id} className="absolute bg-black/85 ring-1 ring-red-500" style={boxStyle(b)}>
                        <button
                          type="button"
                          onClick={() => setBoxes((prev) => prev.filter((x) => x.id !== b.id))}
                          className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-red-600 text-white text-[11px] leading-5 text-center shadow cursor-pointer"
                          aria-label="Markierung entfernen"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  {drawing && drawing.page === page.index && (
                    <div
                      className="absolute bg-black/50 ring-2 ring-red-500"
                      style={boxStyle({
                        x: Math.min(drawing.x0, drawing.x1),
                        y: Math.min(drawing.y0, drawing.y1),
                        w: Math.abs(drawing.x1 - drawing.x0),
                        h: Math.abs(drawing.y1 - drawing.y0),
                      })}
                    />
                  )}
                </div>
              </div>
            ))}

          {result &&
            result.previews.map((p) => (
              <div key={p.page} className="space-y-1">
                <div className="text-[11px] text-zinc-500">Seite {p.page} – Ergebnis</div>
                {p.url && <img src={p.url} alt={`Ergebnis Seite ${p.page}`} className="mx-auto max-w-[760px] w-full bg-white shadow-sm border border-zinc-200 dark:border-zinc-700" />}
              </div>
            ))}

          {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        </div>

        {/* Fuß */}
        <div className="flex flex-wrap items-center gap-2 p-4 border-t border-zinc-200 dark:border-zinc-800 text-xs">
          {busy ? (
            <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
              <Loader2 className="w-4 h-4 animate-spin" /> {busy}
            </span>
          ) : result ? (
            <>
              <a
                id="redact-download"
                href={result.downloadUrl}
                download={result.fileName}
                className="px-3 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Herunterladen
              </a>
              <button
                type="button"
                id="redact-to-scanny"
                onClick={sendToScanny}
                disabled={sentToScanny}
                className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Inbox className="w-3.5 h-3.5" /> {sentToScanny ? 'Liegt im Eingang' : 'In Scanny übernehmen'}
              </button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="px-3 py-2 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Markierungen ändern
              </button>
              <span className="ml-auto text-zinc-500 truncate max-w-[40%]" title={result.fileName}>{result.fileName}</span>
            </>
          ) : token ? (
            <>
              <button
                type="button"
                id="redact-apply"
                onClick={apply}
                disabled={boxes.length === 0}
                className="px-3 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-semibold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                <EyeOff className="w-3.5 h-3.5" /> {boxes.length} Bereich{boxes.length === 1 ? '' : 'e'} schwärzen
              </button>
              <button
                type="button"
                onClick={() => setBoxes((prev) => prev.slice(0, -1))}
                disabled={boxes.length === 0}
                className="px-3 py-2 rounded-lg flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" /> Rückgängig
              </button>
              <button
                type="button"
                onClick={() => setBoxes([])}
                disabled={boxes.length === 0}
                className="px-3 py-2 rounded-lg flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Alle entfernen
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="ml-auto px-3 py-2 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer truncate max-w-[40%]"
                title={fileName}
              >
                Anderes PDF…
              </button>
            </>
          ) : (
            <span className="text-zinc-500">Noch kein PDF gewählt.</span>
          )}
        </div>
      </div>
    </div>
  );
}
