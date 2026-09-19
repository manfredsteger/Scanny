import React, { useState } from 'react';
import { Search as SearchIcon, Filter } from 'lucide-react';
import { Folder, DOCUMENT_TYPE_OPTIONS } from '../types';

interface SearchViewProps {
  folders: Folder[];
}

export function SearchView({ folders }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [selectedDocType, setSelectedDocType] = useState<string>('all');

  return (
    <div id="search-view" className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Suche</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          Schnelle Volltextsuche in allen archivierten Belegen (OCR-Text, Absender, Betrag, Titel).
        </p>
      </div>

      {/* Suchleiste */}
      <div className="relative">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          id="global-search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Belege durchsuchen nach Absender (z. B. Telekom), Betrag oder Stichwort..."
          className="w-full pl-11 pr-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-sm placeholder:text-zinc-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-xs"
        />
      </div>

      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter:</span>
        </div>

        {/* Ordner-Filter */}
        <select
          id="search-filter-folder"
          value={selectedFolderId}
          onChange={(e) => setSelectedFolderId(e.target.value)}
          className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-700 dark:text-zinc-300 focus:outline-hidden cursor-pointer"
        >
          <option value="all">Alle Ordner</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        {/* Typ-Filter */}
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
      </div>

      {/* Leere Ansicht */}
      <div className="text-center py-20 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/30">
        <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
          <SearchIcon className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {query ? `Keine Treffer für "${query}"` : 'Dokumente durchsuchen'}
        </h3>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 max-w-sm mx-auto leading-relaxed">
          {query
            ? 'Versuchen Sie einen anderen Suchbegriff oder passen Sie die Filter an.'
            : 'Scanny durchsucht dank SQLite FTS5 blitzschnell den gesamten erkannten OCR-Text sowie Titel und Absender.'}
        </p>
      </div>
    </div>
  );
}
