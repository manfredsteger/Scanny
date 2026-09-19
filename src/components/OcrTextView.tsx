import React, { useEffect, useRef } from 'react';

interface OcrTextViewProps {
  text: string;
  /** Fundstelle [start, end], die hervorgehoben und in den sichtbaren Bereich gescrollt wird */
  highlight?: [number, number] | null;
  id?: string;
  className?: string;
}

export function OcrTextView({ text, highlight, id, className = '' }: OcrTextViewProps) {
  const markRef = useRef<HTMLElement | null>(null);

  const valid =
    highlight && highlight[0] >= 0 && highlight[1] <= text.length && highlight[0] < highlight[1] ? highlight : null;

  useEffect(() => {
    if (valid && markRef.current) {
      markRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [valid?.[0], valid?.[1]]);

  return (
    <pre
      id={id}
      className={`font-mono text-xs text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed p-3 bg-zinc-50 dark:bg-zinc-900/60 rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 overflow-y-auto ${className}`}
    >
      {valid ? (
        <>
          {text.slice(0, valid[0])}
          <mark
            ref={markRef}
            data-testid="ocr-highlight"
            className="bg-amber-200 dark:bg-amber-500/40 text-zinc-900 dark:text-white rounded px-0.5 ring-2 ring-amber-400"
          >
            {text.slice(valid[0], valid[1])}
          </mark>
          {text.slice(valid[1])}
        </>
      ) : (
        text
      )}
    </pre>
  );
}
