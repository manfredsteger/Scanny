import React, { useEffect, useState } from 'react';
import { Download, Loader2, RotateCcw, Save, FileCode } from 'lucide-react';

interface SourceEditorProps {
  docId: number;
  /** Beleg wird gerade (neu) verarbeitet – Speichern gesperrt */
  busy: boolean;
  /** Nach erfolgreichem Speichern: Beleg ist wieder in der Warteschlange */
  onSaved: () => void;
}

/**
 * Quelltext einer Textdatei (.txt/.md) bearbeiten und das PDF neu setzen lassen.
 * Die Datei liegt im Archiv direkt neben ihrem PDF (gleicher Name).
 */
export function SourceEditor({ docId, busy, onSaved }: SourceEditorProps) {
  const [loaded, setLoaded] = useState<{ text: string; name: string; markdown: boolean } | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${docId}/source`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Quelltext konnte nicht geladen werden.');
      setLoaded(data);
      setText(data.text);
    } catch (err: any) {
      setError(err?.message || 'Quelltext konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMessage(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const dirty = loaded !== null && text !== loaded.text;

  const save = async () => {
    if (!dirty || saving || busy) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${docId}/source`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Speichern fehlgeschlagen.');
      setLoaded((prev) => (prev ? { ...prev, text } : prev));
      setMessage('Gespeichert – das PDF wird neu erzeugt.');
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  };

  if (loading) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-zinc-500 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Quelltext wird geladen…
      </div>
    );
  }

  return (
    <div id="drawer-source-editor" className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 min-w-0">
          <FileCode className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono truncate" title={loaded?.name}>
            {loaded?.name}
          </span>
        </span>
        <a
          href={`/api/documents/${docId}/original`}
          download={loaded?.name}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
          title="Quelldatei herunterladen"
        >
          <Download className="w-3.5 h-3.5" /> Quelldatei
        </a>
      </div>

      <textarea
        id="drawer-source-textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setMessage(null);
        }}
        onKeyDown={onKeyDown}
        spellCheck={false}
        disabled={!loaded}
        className="w-full h-80 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-mono text-[12px] leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          id="drawer-source-save"
          onClick={save}
          disabled={!dirty || saving || busy}
          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          title="Speichern und PDF neu erzeugen (⌘S)"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Speichern &amp; PDF neu erzeugen
        </button>
        <button
          type="button"
          onClick={() => loaded && setText(loaded.text)}
          disabled={!dirty || saving}
          className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Verwerfen
        </button>
        <span className="ml-auto text-zinc-500 dark:text-zinc-400">
          {busy ? 'PDF wird erzeugt…' : dirty ? 'Ungespeicherte Änderungen' : `${text.length.toLocaleString('de-DE')} Zeichen`}
          {loaded?.markdown ? ' · Markdown' : ''}
        </span>
      </div>

      {message && <p className="text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
