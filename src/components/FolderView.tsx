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
} from 'lucide-react';
import { Folder, SystemPaths, ScannyDocument } from '../types';

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

  const folderDocs = documents.filter((d) => d.folder_id === folder.id && d.status === 'filed');

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

      {/* Dokumentenliste */}
      {folderDocs.length === 0 ? (
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
          {folderDocs.map((doc) => {
            const formattedAmount = formatAmount(doc.amount_cents);

            return (
              <div
                key={doc.id}
                onClick={() => onSelectDocument && onSelectDocument(doc)}
                className="group relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-400 dark:hover:border-blue-600/80 transition-all cursor-pointer overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-md"
              >
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
                      <span className="truncate">{doc.sender || doc.doc_type || 'Beleg'}</span>
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
    </div>
  );
}
