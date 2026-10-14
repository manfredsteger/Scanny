import React from 'react';
import { ScannyDocument } from '../types';

/** Was hinter einem Beleg steckt: Textdatei (PDF + Quelltext) oder zusammengefügte Teile. */
export function stackInfo(doc: Pick<ScannyDocument, 'kind' | 'merged_pages' | 'original_path'>): {
  label: string;
  layers: 1 | 2;
} | null {
  if (doc.merged_pages && doc.merged_pages > 0) return { label: `${doc.merged_pages} Teile`, layers: 2 };
  if (doc.kind === 'text') {
    const ext = (doc.original_path?.split('.').pop() || 'txt').toUpperCase();
    return { label: `PDF + ${ext === 'MARKDOWN' ? 'MD' : ext}`, layers: 1 };
  }
  return null;
}

/**
 * Legt bei Stapeln (Textdatei mit PDF, zusammengefügte Dokumente) eine bzw. zwei leicht versetzte
 * Karten hinter die Kachel, damit man auf einen Blick sieht: hier liegt mehr als eine Datei.
 */
export function StackFrame({
  doc,
  children,
}: {
  doc: Pick<ScannyDocument, 'kind' | 'merged_pages' | 'original_path'>;
  children: React.ReactNode;
}) {
  const info = stackInfo(doc);
  if (!info) return <>{children}</>;
  const layer =
    'absolute inset-0 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 shadow-xs pointer-events-none';
  return (
    <div className="relative h-full" data-stack={info.label}>
      {info.layers === 2 && <div aria-hidden className={`${layer} translate-x-3 translate-y-3 rotate-[2deg] opacity-70`} />}
      <div aria-hidden className={`${layer} translate-x-1.5 translate-y-1.5 rotate-[1deg]`} />
      <div className="relative h-full [&>*]:h-full">{children}</div>
    </div>
  );
}
