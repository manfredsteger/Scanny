import React from 'react';
import {
  Inbox,
  Folder as FolderIcon,
  Search,
  Settings,
  Plus,
  MoreVertical,
  Calendar,
  Layers,
  FileText,
  ScanLine
} from 'lucide-react';
import { Folder, ActiveView } from '../types';

interface SidebarProps {
  folders: Folder[];
  inboxCount: number;
  isProcessing?: boolean;
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
  onOpenNewFolder: () => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
}

export function Sidebar({
  folders,
  inboxCount,
  isProcessing = false,
  activeView,
  onSelectView,
  onOpenNewFolder,
  onEditFolder,
  onDeleteFolder,
}: SidebarProps) {
  const [openMenuFolderId, setOpenMenuFolderId] = React.useState<number | null>(null);

  // Gruppierung der Ordner
  const steuerjahre = folders.filter((f) => f.kind === 'steuerjahr');
  const jahre = folders.filter((f) => f.kind === 'jahr');
  const freieOrdner = folders.filter((f) => f.kind === 'frei');

  const isFolderActive = (id: number) => activeView.type === 'folder' && activeView.folderId === id;

  const renderFolderItem = (folder: Folder) => {
    const isActive = isFolderActive(folder.id);
    const isMenuOpen = openMenuFolderId === folder.id;

    return (
      <div
        key={folder.id}
        className="group relative flex items-center justify-between rounded-xl px-2.5 py-1.5 transition-colors text-sm"
      >
        <button
          type="button"
          id={`sidebar-folder-${folder.id}`}
          onClick={() => {
            setOpenMenuFolderId(null);
            onSelectView({ type: 'folder', folderId: folder.id });
          }}
          className={`flex-1 flex items-center gap-2.5 min-w-0 text-left cursor-pointer rounded-lg p-1 transition-all ${
            isActive
              ? 'text-blue-600 dark:text-blue-400 font-semibold'
              : 'text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
          }`}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: folder.color || '#3b82f6' }}
          />
          <span className="truncate">{folder.name}</span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <span
            className={`text-xs px-2 py-0.5 rounded-md font-mono ${
              isActive
                ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-medium'
                : 'text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300'
            }`}
          >
            {folder.document_count}
          </span>

          <div className="relative">
            <button
              type="button"
              id={`folder-actions-btn-${folder.id}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenuFolderId(isMenuOpen ? null : folder.id);
              }}
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
              title="Optionen"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            {isMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setOpenMenuFolderId(null)}
                />
                <div
                  id={`folder-actions-menu-${folder.id}`}
                  className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg py-1 z-50 text-xs text-zinc-700 dark:text-zinc-200"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuFolderId(null);
                      onEditFolder(folder);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
                  >
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuFolderId(null);
                      onDeleteFolder(folder);
                    }}
                    className="w-full text-left px-3 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                  >
                    Löschen
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside
      id="main-sidebar"
      className="w-64 h-screen border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 flex flex-col shrink-0 select-none"
    >
      {/* App Header / Logo */}
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
            <ScanLine className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-white">Scanny</h1>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-none">Home Office Belege</p>
          </div>
        </div>
      </div>

      {/* Navigationsbereich */}
      <div className="flex-1 overflow-y-auto p-3 space-y-6">
        {/* Hauptansicht: Eingang */}
        <div>
          <button
            type="button"
            id="nav-inbox-button"
            onClick={() => onSelectView({ type: 'inbox' })}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
              activeView.type === 'inbox'
                ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-semibold'
                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Inbox className="w-4 h-4" />
              <span>Eingang</span>
            </div>
            <div className="flex items-center gap-1.5">
              {isProcessing && (
                <span className="relative flex h-2 w-2" title="Wird aufbereitet…">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
              )}
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  inboxCount > 0
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {inboxCount}
              </span>
            </div>
          </button>
        </div>

        {/* Ordner-Bereich */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Ordner
            </span>
            <button
              type="button"
              id="sidebar-add-folder-button"
              onClick={onOpenNewFolder}
              className="p-1 rounded-md text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1 text-xs cursor-pointer"
              title="Neuen Ordner anlegen"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Ordner</span>
            </button>
          </div>

          {folders.length === 0 ? (
            <div className="px-3 py-4 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">Noch keine Ordner vorhanden</p>
              <button
                type="button"
                id="sidebar-empty-create-folder"
                onClick={onOpenNewFolder}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                + Ersten Ordner anlegen
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Gruppe: Steuerjahre */}
              {steuerjahre.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2.5 mb-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                    <Calendar className="w-3 h-3" />
                    <span>Steuerjahre</span>
                  </div>
                  <div className="space-y-0.5">
                    {steuerjahre.map(renderFolderItem)}
                  </div>
                </div>
              )}

              {/* Gruppe: Jahre */}
              {jahre.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2.5 mb-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                    <FileText className="w-3 h-3" />
                    <span>Jahre</span>
                  </div>
                  <div className="space-y-0.5">
                    {jahre.map(renderFolderItem)}
                  </div>
                </div>
              )}

              {/* Gruppe: Freie Ordner */}
              {freieOrdner.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-2.5 mb-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                    <Layers className="w-3 h-3" />
                    <span>Freie Ordner</span>
                  </div>
                  <div className="space-y-0.5">
                    {freieOrdner.map(renderFolderItem)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Suche & Einstellungen */}
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 space-y-1">
          <button
            type="button"
            id="nav-search-button"
            onClick={() => onSelectView({ type: 'search' })}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
              activeView.type === 'search'
                ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-semibold'
                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
            }`}
          >
            <Search className="w-4 h-4" />
            <span>Suche</span>
          </button>

          <button
            type="button"
            id="nav-settings-button"
            onClick={() => onSelectView({ type: 'settings' })}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
              activeView.type === 'settings'
                ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-semibold'
                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Einstellungen</span>
          </button>
        </div>
      </div>

      {/* Footer mit lokalem Status */}
      <div className="p-3 border-t border-zinc-100 dark:border-zinc-800/80">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 px-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>Lokal auf Ihrem Rechner</span>
        </div>
      </div>
    </aside>
  );
}
