import React, { useState } from 'react';
import {
  Folder as FolderIcon,
  Edit2,
  Trash2,
  Calendar,
  Layers,
  FileText,
  FolderOpen,
  AlertCircle,
  Clock,
  ArrowRight,
  LayoutGrid,
  List,
  ChevronUp,
  ChevronDown,
  Download,
  Check,
} from 'lucide-react';
import {
  Folder,
  SystemPaths,
  ScannyDocument,
  DOCUMENT_TYPE_OPTIONS,
  GERMAN_MONTH_NAMES,
  formatDocumentType,
  formatEuro,
  formatIsoDateDe,
  typeChipClass,
} from '../types';
import { ExportDialog } from './ExportDialog';

type SortKey = 'doc_date' | 'doc_type' | 'title' | 'sender' | 'amount_cents' | 'page_count';

const VIEW_MODE_KEY = 'scanny.folderViewMode';

function readViewMode(): 'table' | 'tiles' {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'tiles' ? 'tiles' : 'table';
  } catch {
    return 'table';
  }
}

interface FolderViewProps {
  folder: Folder;
  documents?: ScannyDocument[];
  paths: SystemPaths | null;
  onEdit: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
  onSelectDocument?: (doc: ScannyDocument) => void;
}

export function FolderView({
  folder,
  documents = [],
  paths,
  onEdit,
  onDelete,
  onSelectDocument,
}: FolderViewProps) {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<'table' | 'tiles'>(readViewMode);
  const [sortKey, setSortKey] = useState<SortKey>('doc_date');
  const [sortAsc, setSortAsc] = useState(false);
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isExportOpen, setIsExportOpen] = useState(false);

  const setViewMode = (mode: 'table' | 'tiles') => {
    setViewModeState(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Speicher nicht verfügbar – Ansicht gilt nur für diese Sitzung
    }
  };

  const folderDocs = documents.filter((d) => d.folder_id === folder.id && d.status === 'filed');

  // Filter: Monat (YYYY-MM aus doc_date) und Dokumenttyp
  const monthOptions = Array.from(
    new Set(folderDocs.map((d) => (d.doc_date || '').slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))
  ).sort();
  const filteredDocs = folderDocs.filter(
    (d) =>
      (monthFilter === 'all' ||
        (monthFilter === 'none' ? !d.doc_date : (d.doc_date || '').startsWith(monthFilter))) &&
      (typeFilter === 'all' || (d.doc_type || '') === typeFilter)
  );

  const sortValue = (d: ScannyDocument) => (sortKey === 'title' ? d.title || d.original_name : d[sortKey]);
  const sortedDocs = [...filteredDocs].sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    // leere Werte immer ans Ende
    if (av === null || av === undefined || av === '') return 1;
    if (bv === null || bv === undefined || bv === '') return -1;
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(sortKey === 'doc_type' ? formatDocumentType(String(av)) : av).localeCompare(
            String(sortKey === 'doc_type' ? formatDocumentType(String(bv)) : bv),
            'de'
          );
    return sortAsc ? cmp : -cmp;
  });

  const totalCents = filteredDocs.reduce((sum, d) => sum + (d.amount_cents || 0), 0);

  // Auswahl beim Ordnerwechsel leeren
  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [folder.id]);

  // Belege, die den Ordner verlassen haben, aus der Auswahl nehmen
  React.useEffect(() => {
    setSelectedIds((prev) => {
      const gueltig = new Set(folderDocs.map((d) => d.id));
      const next = new Set([...prev].filter((id) => gueltig.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [documents]);

  const selectedList = folderDocs.filter((d) => selectedIds.has(d.id));

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const alleGefiltertMarkiert =
    sortedDocs.length > 0 && sortedDocs.every((d) => selectedIds.has(d.id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (alleGefiltertMarkiert) {
        const next = new Set(prev);
        sortedDocs.forEach((d) => next.delete(d.id));
        return next;
      }
      return new Set([...prev, ...sortedDocs.map((d) => d.id)]);
    });
  };

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key !== 'doc_date' && key !== 'amount_cents');
    }
  };

  const monthLabel = (ym: string) => `${GERMAN_MONTH_NAMES[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`;

  const getKindBadge = () => {
    switch (folder.kind) {
      case 'steuerjahr':
        return {
          label: `Steuerjahr ${folder.year || ''}`,
          icon: Calendar,
          className: 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900',
        };
      case 'jahr':
        return {
          label: `Jahr ${folder.year || ''}`,
          icon: FileText,
          className: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
        };
      case 'frei':
      default:
        return {
          label: 'Freier Ordner',
          icon: Layers,
          className: 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900',
        };
    }
  };

  const badge = getKindBadge();
  const BadgeIcon = badge.icon;
  const baseArchive = paths?.hostArchiveDir || paths?.archiveDir || 'scanny/Archiv';
  const folderArchivePath = `${baseArchive.replace(/\/+$/, '')}/${folder.name}`;

  const formatAmount = (cents: number | null) => {
    if (cents === null || cents === undefined) return null;
    return (cents / 100).toLocaleString('de-DE', {
      style: 'currency',
      currency: 'EUR',
    });
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return isoString.slice(0, 10);
    }
  };

  return (
    <div id="folder-view" className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-xs shrink-0"
            style={{ backgroundColor: folder.color || '#3b82f6' }}
          >
            <FolderIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
                {folder.name}
              </h2>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${badge.className}`}
              >
                <BadgeIcon className="w-3 h-3" />
                <span>{badge.label}</span>
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Erstellt am {new Date(folder.created_at).toLocaleDateString('de-DE')} • {folderDocs.length} {folderDocs.length === 1 ? 'Dokument' : 'Dokumente'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            id="folder-export-button"
            onClick={() => setIsExportOpen(true)}
            disabled={folderDocs.length === 0}
            title={folderDocs.length === 0 ? 'Dieser Ordner enthält noch keine Belege' : 'Belege exportieren'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportieren{selectedList.length > 0 ? ` (${selectedList.length})` : '…'}</span>
          </button>
          <button
            type="button"
            id="edit-folder-button"
            onClick={() => onEdit(folder)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>Bearbeiten</span>
          </button>
          <button
            type="button"
            id="delete-folder-button"
            onClick={() => onDelete(folder)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Löschen</span>
          </button>
        </div>
      </div>

      {deleteError && (
        <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex items-center gap-2.5 text-red-700 dark:text-red-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{deleteError}</span>
        </div>
      )}

      {/* Dateisystem Pfadkarte */}
      <div className="p-4 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <FolderOpen className="w-4 h-4 text-zinc-400 shrink-0" />
          <span>Archivpfad auf Ihrem Mac:</span>
          <code className="px-2 py-0.5 bg-white dark:bg-zinc-800 text-[11px] font-mono rounded text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 select-all">
            {folderArchivePath}
          </code>
        </div>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          Direkt im macOS Finder lesbar
        </span>
      </div>

      {/* Filter & Ansicht */}
      {folderDocs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            id="folder-filter-month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer"
          >
            <option value="all">Alle Monate</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
            <option value="none">Ohne Datum</option>
          </select>
          <select
            id="folder-filter-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer"
          >
            <option value="all">Alle Typen</option>
            {DOCUMENT_TYPE_OPTIONS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center rounded-xl bg-zinc-200/80 dark:bg-zinc-800 p-0.5 text-xs font-medium">
            <button
              type="button"
              id="folder-view-table"
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer ${
                viewMode === 'table' ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs' : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <List className="w-3.5 h-3.5" /> Tabelle
            </button>
            <button
              type="button"
              id="folder-view-tiles"
              onClick={() => setViewMode('tiles')}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer ${
                viewMode === 'tiles' ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs' : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Kacheln
            </button>
          </div>
        </div>
      )}

      {/* Tabellenansicht */}
      {folderDocs.length > 0 && viewMode === 'table' && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table id="folder-table" className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2.5 w-10">
                    <button
                      type="button"
                      id="folder-select-all"
                      role="checkbox"
                      aria-checked={alleGefiltertMarkiert}
                      aria-label="Alle sichtbaren Belege markieren"
                      onClick={toggleSelectAll}
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all cursor-pointer ${
                        alleGefiltertMarkiert
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-zinc-300 dark:border-zinc-600 text-transparent hover:border-blue-400'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  </th>
                  {(
                    [
                      ['doc_date', 'Datum', 'text-left w-28'],
                      ['doc_type', 'Typ', 'text-left w-36'],
                      ['title', 'Titel', 'text-left'],
                      ['sender', 'Absender', 'text-left'],
                      ['amount_cents', 'Betrag', 'text-right w-32'],
                      ['page_count', 'Seiten', 'text-right w-20'],
                    ] as [SortKey, string, string][]
                  ).map(([key, label, cls]) => (
                    <th key={key} className={`px-4 py-2.5 font-semibold ${cls}`}>
                      <button
                        type="button"
                        id={`folder-sort-${key}`}
                        onClick={() => toggleSort(key)}
                        className={`inline-flex items-center gap-1 cursor-pointer hover:text-zinc-900 dark:hover:text-white ${
                          sortKey === key ? 'text-zinc-900 dark:text-white' : ''
                        }`}
                      >
                        {label}
                        {sortKey === key &&
                          (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {sortedDocs.map((doc) => (
                  <tr
                    key={doc.id}
                    id={`folder-row-${doc.id}`}
                    onClick={() => onSelectDocument && onSelectDocument(doc)}
                    className={`cursor-pointer ${
                      selectedIds.has(doc.id)
                        ? 'bg-blue-50 dark:bg-blue-950/30'
                        : 'hover:bg-blue-50/50 dark:hover:bg-blue-950/20'
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        id={`folder-select-${doc.id}`}
                        role="checkbox"
                        aria-checked={selectedIds.has(doc.id)}
                        aria-label="Beleg markieren"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(doc.id);
                        }}
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all cursor-pointer ${
                          selectedIds.has(doc.id)
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-zinc-300 dark:border-zinc-600 text-transparent hover:border-blue-400'
                        }`}
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                      {formatIsoDateDe(doc.doc_date) || '–'}
                    </td>
                    <td className="px-4 py-2.5">
                      {doc.doc_type ? (
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border whitespace-nowrap ${typeChipClass(doc.doc_type)}`}>
                          {formatDocumentType(doc.doc_type)}
                        </span>
                      ) : (
                        <span className="text-zinc-400">–</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100 max-w-xs truncate">
                      {doc.title || doc.original_name}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400 max-w-[14rem] truncate">{doc.sender || '–'}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                      {formatEuro(doc.amount_cents) || '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-500">{doc.page_count || 1}</td>
                  </tr>
                ))}
                {sortedDocs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-500">
                      Keine Belege für diesen Filter.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-zinc-50 dark:bg-zinc-800/60 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <tr>
                  <td id="folder-table-count" colSpan={5} className="px-4 py-2.5">
                    {filteredDocs.length} {filteredDocs.length === 1 ? 'Dokument' : 'Dokumente'}
                    {selectedList.length > 0 && (
                      <span className="ml-2 font-normal text-blue-700 dark:text-blue-300">
                        · {selectedList.length} markiert
                      </span>
                    )}
                  </td>
                  <td id="folder-table-sum" className="px-4 py-2.5 text-right font-mono">
                    {formatEuro(totalCents)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Dokumentenliste (Kacheln) */}
      {folderDocs.length > 0 && viewMode === 'table' ? null : folderDocs.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-900/20">
          <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
            <FolderIcon className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Dieser Ordner ist noch leer
          </h3>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 max-w-sm mx-auto leading-relaxed">
            Sobald du Belege im Eingang bestätigst und diesem Ordner zuweist, werden sie hier aufgelistet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {sortedDocs.map((doc) => {
            const formattedAmount = formatAmount(doc.amount_cents);

            return (
              <div
                key={doc.id}
                onClick={(e) => {
                  // Bei aktiver Auswahl wählt ein Klick aus, statt den Beleg zu öffnen
                  if (selectedIds.size > 0) toggleSelect(doc.id);
                  else onSelectDocument && onSelectDocument(doc);
                }}
                className={`group relative rounded-2xl border bg-white dark:bg-zinc-900 transition-all cursor-pointer overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-md ${
                  selectedIds.has(doc.id)
                    ? 'border-blue-500 ring-2 ring-blue-500/40'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-blue-400 dark:hover:border-blue-600/80'
                }`}
              >
                <button
                  type="button"
                  id={`folder-tile-select-${doc.id}`}
                  role="checkbox"
                  aria-checked={selectedIds.has(doc.id)}
                  aria-label="Beleg markieren"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(doc.id);
                  }}
                  className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all cursor-pointer ${
                    selectedIds.has(doc.id)
                      ? 'bg-blue-600 border-blue-600 text-white opacity-100'
                      : `bg-white/90 dark:bg-zinc-900/90 border-zinc-300 dark:border-zinc-600 text-transparent ${
                          selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                {/* Vorschaubild */}
                <div className="h-44 bg-zinc-100 dark:bg-zinc-950/80 flex items-center justify-center overflow-hidden relative border-b border-zinc-100 dark:border-zinc-800/80">
                  {doc.thumb_path ? (
                    <img
                      src={`/api/documents/${doc.id}/thumb?v=${encodeURIComponent(doc.updated_at || '')}`}
                      alt={doc.title || doc.original_name}
                      className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
                      <FileText className="w-10 h-10 mb-1 opacity-60" />
                      <span className="text-[10px] uppercase font-mono tracking-wider">
                        {doc.original_name.split('.').pop()}
                      </span>
                    </div>
                  )}

                  {formattedAmount && (
                    <div className="absolute top-2.5 right-2.5 bg-zinc-900/80 backdrop-blur-xs text-white text-[11px] font-mono font-medium px-2 py-0.5 rounded-lg shadow-xs">
                      {formattedAmount}
                    </div>
                  )}

                  {/* Seitenzahl-Badge wenn > 1 */}
                  {doc.page_count !== null && doc.page_count !== undefined && doc.page_count > 1 && (
                    <div
                      id={`folder-doc-tile-pages-${doc.id}`}
                      className="absolute bottom-2.5 right-2.5 bg-zinc-900/80 backdrop-blur-xs text-white text-[10px] font-mono font-medium px-2 py-0.5 rounded-md shadow-xs flex items-center gap-1"
                      title={`${doc.page_count} Seiten`}
                    >
                      <FileText className="w-3 h-3 text-zinc-300" />
                      <span>{doc.page_count} Seiten</span>
                    </div>
                  )}
                </div>

                {/* Details unter dem Bild */}
                <div className="p-3.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {doc.title || doc.original_name}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                      <span className="truncate">{doc.sender || formatDocumentType(doc.doc_type) || 'Beleg'}</span>
                      {doc.doc_date && (
                        <span className="font-mono shrink-0 ml-1 text-zinc-400">
                          {formatDate(doc.doc_date)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-400">
                    <span>{formatDate(doc.created_at)}</span>
                    <span className="text-blue-600 dark:text-blue-400 font-medium group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                      Öffnen <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ExportDialog
        isOpen={isExportOpen}
        folder={folder}
        documents={folderDocs}
        selectedIds={selectedList.map((d) => d.id)}
        onClose={() => setIsExportOpen(false)}
      />

      {folderDocs.length > 0 && viewMode === 'tiles' && (
        <p id="folder-tiles-summary" className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 text-right">
          {filteredDocs.length} {filteredDocs.length === 1 ? 'Dokument' : 'Dokumente'} · Summe{' '}
          <span className="font-mono">{formatEuro(totalCents)}</span>
        </p>
      )}
    </div>
  );
}
