import React, { useEffect, useState } from 'react';
import { Search as SearchIcon, Filter, Loader2, Inbox, Folder as FolderIcon } from 'lucide-react';
import {
  Folder,
  DOCUMENT_TYPE_OPTIONS,
  SearchHit,
  formatDocumentType,
  formatEuro,
  formatIsoDateDe,
  typeChipClass,
} from '../types';

interface SearchViewProps {
  folders: Folder[];
  query: string;
  onOpenDocument: (id: number) => void;
}

/** Textausschnitt mit \u0001…\u0002-Markierungen als <mark> darstellen (ohne HTML-Parsing). */
function Snippet({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\u0001([\s\S]*?)\u0002/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <mark key={key++} className="bg-amber-200/80 dark:bg-amber-500/40 text-zinc-900 dark:text-white rounded px-0.5">
        {m[1]}
      </mark>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function SearchView({ folders, query, onOpenDocument }: SearchViewProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [selectedDocType, setSelectedDocType] = useState<string>('all');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q });
        if (selectedFolderId !== 'all') params.set('folder_id', selectedFolderId);
        if (selectedDocType !== 'all') params.set('doc_type', selectedDocType);
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Suche fehlgeschlagen.');
        setHits(await res.json());
        setError(null);
      } catch (err: any) {
        if (err?.name !== 'AbortError') setError(err?.message || 'Suche fehlgeschlagen.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedFolderId, selectedDocType]);

  return (
    <div id="search-view" className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Suche</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          Suchbegriff oben eingeben – durchsucht erkannten Text, Titel und Absender aller Belege. Tastenkürzel: <kbd className="px-1.5 py-0.5 text-[11px] font-mono rounded border border-zinc-300 dark:border-zinc-700">/</kbd>
        </p>
      </div>

      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter:</span>
        </div>
        <select
          id="search-filter-folder"
          value={selectedFolderId}
          onChange={(e) => setSelectedFolderId(e.target.value)}
          className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-700 dark:text-zinc-300 focus:outline-hidden cursor-pointer"
        >
          <option value="all">Alle Ordner</option>
          <option value="inbox">Eingang</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          id="search-filter-type"
          value={selectedDocType}
          onChange={(e) => setSelectedDocType(e.target.value)}
          className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-700 dark:text-zinc-300 focus:outline-hidden cursor-pointer"
        >
          <option value="all">Alle Dokumenttypen</option>
          {DOCUMENT_TYPE_OPTIONS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        {loading && <Loader2 className="w-3.5 h-3.5 text-zinc-400 animate-spin" />}
        {query.trim() && !loading && !error && (
          <span id="search-hit-count" className="text-xs text-zinc-400 ml-auto">
            {hits.length === 100 ? 'mehr als 100' : hits.length} Treffer
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {hits.length > 0 ? (
        <ul id="search-results" className="space-y-2">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => onOpenDocument(hit.id)}
                className="w-full text-left p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-400 dark:hover:border-blue-600 transition-colors cursor-pointer space-y-1.5"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"
                    style={hit.folder_color ? { borderColor: hit.folder_color, color: hit.folder_color } : undefined}
                  >
                    {hit.folder_id ? <FolderIcon className="w-3 h-3" /> : <Inbox className="w-3 h-3" />}
                    {hit.folder_name || 'Eingang'}
                  </span>
                  {hit.doc_type && (
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${typeChipClass(hit.doc_type)}`}>
                      {formatDocumentType(hit.doc_type)}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {hit.title || hit.original_name}
                  </span>
                  <span className="ml-auto flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 font-mono shrink-0">
                    {hit.amount_cents !== null && <span>{formatEuro(hit.amount_cents)}</span>}
                    {hit.doc_date && <span>{formatIsoDateDe(hit.doc_date)}</span>}
                  </span>
                </div>
                {hit.snippet && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-2">
                    <Snippet text={hit.snippet} />
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-center py-20 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/30">
          <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
            <SearchIcon className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            {query.trim() && !loading ? `Keine Treffer für "${query.trim()}"` : 'Dokumente durchsuchen'}
          </h3>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 max-w-sm mx-auto leading-relaxed">
            {query.trim()
              ? 'Anderen Suchbegriff versuchen oder Filter anpassen.'
              : 'Durchsucht den erkannten Text sowie Titel und Absender aller Belege.'}
          </p>
        </div>
      )}
    </div>
  );
}
