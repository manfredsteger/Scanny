import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Crop, Loader2, Maximize, RotateCcw, RotateCw, Sparkles, X, Check, AlertTriangle } from 'lucide-react';
import { ScannyDocument } from '../types';

interface CornerEditorProps {
  document: ScannyDocument;
  onClose: () => void;
  /** Wird nach erfolgreichem "Übernehmen und neu verarbeiten" aufgerufen */
  onApplied: () => void | Promise<void>;
}

type Point = [number, number];
type ColorMode = 'bw' | 'gray' | 'color';

interface WorkMeta {
  width: number;
  height: number;
  rotation: number;
  color_mode: ColorMode;
  corners: Point[] | null;
}

const HANDLE_LABELS = ['oben links', 'oben rechts', 'unten rechts', 'unten links'];
const MAGNIFIER_SIZE = 132;
const MAGNIFIER_ZOOM = 2;

function fullImageCorners(width: number, height: number): Point[] {
  return [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
}

/** Ecken mitdrehen, wenn im Editor gedreht wird (Bild w×h wird zu h×w). */
function rotateCorners(corners: Point[], width: number, height: number, direction: 'cw' | 'ccw'): Point[] {
  return corners.map(([x, y]) =>
    direction === 'cw' ? ([height - y, x] as Point) : ([y, width - x] as Point)
  );
}

export function CornerEditor({ document: doc, onClose, onApplied }: CornerEditorProps) {
  const [corners, setCorners] = useState<Point[]>([]);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [rotation, setRotation] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>('bw');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState<'load' | 'detect' | 'apply' | null>('load');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const previewUrl = `/api/documents/${doc.id}/work-preview?rotation=${rotation}&v=${encodeURIComponent(
    doc.updated_at || ''
  )}`;

  // Arbeitsbild-Maße und gespeicherte Ecken laden
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${doc.id}/work-meta`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Arbeitsbild konnte nicht geladen werden.');
        if (cancelled) return;
        const loaded: WorkMeta = data;
        setSize({ width: loaded.width, height: loaded.height });
        setRotation(loaded.rotation);
        setColorMode(loaded.color_mode);
        setCorners(
          Array.isArray(loaded.corners) && loaded.corners.length === 4
            ? (loaded.corners as Point[])
            : fullImageCorners(loaded.width, loaded.height)
        );
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Arbeitsbild konnte nicht geladen werden.');
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.id]);

  // ESC bricht den Editor ab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Bildschirm- in Bildkoordinaten umrechnen (Vorschau ist auf 1600 px begrenzt und zusätzlich skaliert)
  const toImageCoords = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const img = imageRef.current;
      if (!img || !size) return null;
      const rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const x = ((clientX - rect.left) / rect.width) * size.width;
      const y = ((clientY - rect.top) / rect.height) * size.height;
      return [
        Math.min(Math.max(x, 0), size.width),
        Math.min(Math.max(y, 0), size.height),
      ];
    },
    [size]
  );

  useEffect(() => {
    if (dragIndex === null) return;
    const onMove = (e: PointerEvent) => {
      const point = toImageCoords(e.clientX, e.clientY);
      if (!point) return;
      setCorners((prev) => prev.map((c, i) => (i === dragIndex ? point : c)));
    };
    const onUp = () => setDragIndex(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragIndex, toImageCoords]);

  const handleRotate = (direction: 'cw' | 'ccw') => {
    if (!size) return;
    setCorners((prev) => rotateCorners(prev, size.width, size.height, direction));
    setSize({ width: size.height, height: size.width });
    setRotation((prev) => (direction === 'cw' ? (prev + 90) % 360 : (prev + 270) % 360));
  };

  const handleDetect = async () => {
    setBusy('detect');
    setError(null);
    setHint(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Ecken konnten nicht erkannt werden.');
      if (Array.isArray(data.corners) && data.corners.length === 4) {
        setCorners(data.corners as Point[]);
        if (data.width && data.height) setSize({ width: data.width, height: data.height });
        setHint(data.detected ? 'Ränder automatisch erkannt.' : 'Keine klaren Ränder gefunden – bitte prüfen.');
      }
    } catch (err: any) {
      setError(err?.message || 'Ecken konnten nicht erkannt werden.');
    } finally {
      setBusy(null);
    }
  };

  const handleApply = async () => {
    setBusy('apply');
    setError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corners, rotation, color_mode: colorMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Neu verarbeiten fehlgeschlagen.');
      await onApplied();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Neu verarbeiten fehlgeschlagen.');
      setBusy(null);
    }
  };

  // Lupe: 2-fache Vergrößerung rund um den gezogenen Griff
  const magnifier = (() => {
    const img = imageRef.current;
    if (dragIndex === null || !img || !size) return null;
    const point = corners[dragIndex];
    if (!point) return null;
    const rect = img.getBoundingClientRect();
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame || rect.width === 0) return null;
    const scale = rect.width / size.width;
    const px = point[0] * scale;
    const py = point[1] * scale;
    return {
      // Position innerhalb des Rahmens, oberhalb des Griffs (bzw. darunter, wenn oben kein Platz ist)
      left: rect.left - frame.left + px - MAGNIFIER_SIZE / 2,
      top: rect.top - frame.top + py - (py > MAGNIFIER_SIZE + 24 ? MAGNIFIER_SIZE + 24 : -24),
      backgroundSize: `${rect.width * MAGNIFIER_ZOOM}px ${rect.height * MAGNIFIER_ZOOM}px`,
      backgroundPosition: `${MAGNIFIER_SIZE / 2 - px * MAGNIFIER_ZOOM}px ${MAGNIFIER_SIZE / 2 - py * MAGNIFIER_ZOOM}px`,
    };
  })();

  const polygon = corners.map(([x, y]) => `${x},${y}`).join(' ');
  const handleRadius = size ? Math.max(size.width, size.height) / 55 : 10;
  const strokeWidth = size ? Math.max(size.width, size.height) / 300 : 3;

  return (
    <div
      id="corner-editor-overlay"
      className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Zuschnitt anpassen"
    >
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-5xl max-h-[94vh] shadow-2xl flex flex-col overflow-hidden">
        {/* Kopfzeile */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/70 dark:bg-zinc-800/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <Crop className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Zuschnitt anpassen</h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-md">
                {doc.title || doc.original_name}
              </p>
            </div>
          </div>
          <button
            type="button"
            id="corner-editor-close"
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Abbrechen (ESC)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Bild mit Ecken-Overlay */}
        <div ref={frameRef} className="flex-1 min-h-0 relative bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center p-4 overflow-hidden">
          {busy === 'load' ? (
            <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
          ) : !size ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{error || 'Kein Bild verfügbar.'}</p>
          ) : (
            <div className="relative max-h-full" style={{ touchAction: 'none' }}>
              <img
                ref={imageRef}
                id="corner-editor-image"
                src={previewUrl}
                alt=""
                draggable={false}
                className="block max-h-[calc(94vh-230px)] max-w-full object-contain select-none rounded-lg shadow-lg"
              />
              <svg
                id="corner-editor-svg"
                viewBox={`0 0 ${size.width} ${size.height}`}
                preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full"
              >
                <polygon
                  points={polygon}
                  fill="rgba(37, 99, 235, 0.16)"
                  stroke="#2563eb"
                  strokeWidth={strokeWidth}
                  vectorEffect="non-scaling-stroke"
                />
                {corners.map(([x, y], index) => (
                  <circle
                    key={index}
                    id={`corner-handle-${index}`}
                    data-testid="corner-handle"
                    aria-label={`Ecke ${HANDLE_LABELS[index]}`}
                    cx={x}
                    cy={y}
                    r={handleRadius}
                    fill={dragIndex === index ? '#1d4ed8' : '#ffffff'}
                    stroke="#2563eb"
                    strokeWidth={strokeWidth}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: 'grab', touchAction: 'none' }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setDragIndex(index);
                    }}
                  />
                ))}
              </svg>

              {magnifier && (
                <div
                  id="corner-editor-magnifier"
                  className="absolute pointer-events-none rounded-full border-2 border-blue-500 shadow-xl bg-white dark:bg-zinc-900 overflow-hidden"
                  style={{
                    width: MAGNIFIER_SIZE,
                    height: MAGNIFIER_SIZE,
                    left: magnifier.left,
                    top: magnifier.top,
                    backgroundImage: `url(${previewUrl})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: magnifier.backgroundSize,
                    backgroundPosition: magnifier.backgroundPosition,
                  }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-5 h-px bg-blue-600/70" />
                    <div className="h-5 w-px bg-blue-600/70 absolute" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Werkzeuge */}
        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center gap-2 text-xs shrink-0">
          <button
            type="button"
            id="corner-editor-detect"
            onClick={handleDetect}
            disabled={busy !== null || !size}
            className="px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === 'detect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Automatisch erkennen
          </button>
          <button
            type="button"
            id="corner-editor-full"
            onClick={() => size && setCorners(fullImageCorners(size.width, size.height))}
            disabled={busy !== null || !size}
            className="px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <Maximize className="w-3.5 h-3.5" />
            Ganzes Bild
          </button>
          <button
            type="button"
            id="corner-editor-rotate-ccw"
            onClick={() => handleRotate('ccw')}
            disabled={busy !== null || !size}
            className="px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" />↺ 90°
          </button>
          <button
            type="button"
            id="corner-editor-rotate-cw"
            onClick={() => handleRotate('cw')}
            disabled={busy !== null || !size}
            className="px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <RotateCw className="w-3.5 h-3.5" />↻ 90°
          </button>

          <div className="flex items-center rounded-xl bg-zinc-200/80 dark:bg-zinc-800 p-0.5 font-medium">
            {(
              [
                ['bw', 'S/W'],
                ['gray', 'Grau'],
                ['color', 'Farbe'],
              ] as [ColorMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                id={`corner-editor-mode-${mode}`}
                onClick={() => setColorMode(mode)}
                disabled={busy !== null}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer disabled:opacity-40 ${
                  colorMode === mode
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white font-semibold shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {(hint || error) && (
            <span
              id="corner-editor-message"
              className={`flex items-center gap-1.5 ${
                error ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {error && <AlertTriangle className="w-3.5 h-3.5" />}
              {error || hint}
            </span>
          )}
        </div>

        {/* Fußzeile */}
        <div className="px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-800/60 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Griffe auf die Belegecken ziehen – beim Ziehen zeigt eine Lupe die Umgebung vergrößert.
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              id="corner-editor-cancel"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-700 cursor-pointer"
            >
              Abbrechen
            </button>
            <button
              type="button"
              id="corner-editor-apply"
              onClick={handleApply}
              disabled={busy !== null || !size}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'apply' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Übernehmen und neu verarbeiten
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
