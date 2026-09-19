import React, { useState, useEffect } from 'react';
import { X, Sparkles, Folder as FolderIcon, AlertCircle } from 'lucide-react';
import { Folder, FolderKind, COLOR_PRESETS } from '../types';

interface FolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (folderData: { name: string; kind: FolderKind; year: number | null; color: string }) => Promise<void>;
  editFolder?: Folder | null;
}

export function FolderModal({ isOpen, onClose, onSave, editFolder }: FolderModalProps) {
  const currentYear = new Date().getFullYear();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FolderKind>('steuerjahr');
  const [year, setYear] = useState<string>(String(currentYear));
  const [color, setColor] = useState(COLOR_PRESETS[0].value);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editFolder) {
      setName(editFolder.name);
      setKind(editFolder.kind);
      setYear(editFolder.year ? String(editFolder.year) : String(currentYear));
      setColor(editFolder.color || COLOR_PRESETS[0].value);
    } else {
      setName(`Steuer ${currentYear}`);
      setKind('steuerjahr');
      setYear(String(currentYear));
      setColor(COLOR_PRESETS[0].value);
    }
    setError(null);
  }, [editFolder, isOpen, currentYear]);

  if (!isOpen) return null;

  const handleQuickTaxYear = () => {
    setKind('steuerjahr');
    setYear(String(currentYear));
    setName(`Steuer ${currentYear}`);
    setColor(COLOR_PRESETS[0].value);
    setError(null);
  };

  const handleKindChange = (newKind: FolderKind) => {
    setKind(newKind);
    if (!editFolder) {
      if (newKind === 'steuerjahr') {
        setName(year ? `Steuer ${year}` : 'Steuer');
      } else if (newKind === 'jahr') {
        setName(year || '');
      } else {
        setName('');
      }
    }
  };

  const handleYearChange = (newYearStr: string) => {
    setYear(newYearStr);
    if (!editFolder) {
      if (kind === 'steuerjahr') {
        setName(newYearStr ? `Steuer ${newYearStr}` : 'Steuer');
      } else if (kind === 'jahr') {
        setName(newYearStr);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Bitte einen Ordnernamen eingeben.');
      return;
    }

    if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.') || trimmed.startsWith('_')) {
      setError('Ordnernamen dürfen nicht ".", ".." sein oder mit "." oder "_" beginnen.');
      return;
    }

    if (/[/\\:*?"<>|]/.test(trimmed)) {
      setError('Der Ordnername darf keine Sonderzeichen wie / \\ : * ? " < > | enthalten.');
      return;
    }

    if (trimmed.length > 80) {
      setError('Der Ordnername darf maximal 80 Zeichen lang sein.');
      return;
    }

    let parsedYear: number | null = null;
    if (kind === 'steuerjahr' || kind === 'jahr') {
      const trimmedYear = year.trim();
      const num = Number(trimmedYear);
      if (!trimmedYear || !/^\d+$/.test(trimmedYear) || !Number.isInteger(num) || num < 1900 || num > 2100) {
        setError('Bitte ein gültiges Jahr zwischen 1900 und 2100 eingeben.');
        return;
      }
      parsedYear = num;
    }

    try {
      setIsSubmitting(true);
      await onSave({
        name: trimmed,
        kind,
        year: kind === 'frei' ? null : parsedYear,
        color,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Speichern des Ordners.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="folder-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="folder-modal-container"
        className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl overflow-hidden text-zinc-900 dark:text-zinc-100"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <FolderIcon className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight">
              {editFolder ? 'Ordner bearbeiten' : 'Neuen Ordner anlegen'}
            </h2>
          </div>
          <button
            type="button"
            id="close-folder-modal-button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {!editFolder && (
            <div className="bg-blue-50/80 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-900 dark:text-blue-200">
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Schnellaktion für die laufende Steuererklärung</span>
              </div>
              <button
                type="button"
                id="quick-tax-year-button"
                onClick={handleQuickTaxYear}
                className="text-xs font-medium text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-100 bg-white dark:bg-zinc-900 px-2.5 py-1 rounded-md shadow-xs border border-blue-200 dark:border-blue-800 hover:border-blue-300 transition-all cursor-pointer"
              >
                Steuer {currentYear} vorlegen
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex items-start gap-2.5 text-red-700 dark:text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Ordnertyp */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
              Ordnertyp
            </label>
            <div className="grid grid-cols-3 gap-2 p-1 bg-zinc-100 dark:bg-zinc-800/70 rounded-xl">
              <button
                type="button"
                id="kind-tax-button"
                onClick={() => handleKindChange('steuerjahr')}
                className={`py-2 px-3 text-xs font-medium rounded-lg transition-all text-center ${
                  kind === 'steuerjahr'
                    ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                Steuerjahr
              </button>
              <button
                type="button"
                id="kind-year-button"
                onClick={() => handleKindChange('jahr')}
                className={`py-2 px-3 text-xs font-medium rounded-lg transition-all text-center ${
                  kind === 'jahr'
                    ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                Jahr
              </button>
              <button
                type="button"
                id="kind-free-button"
                onClick={() => handleKindChange('frei')}
                className={`py-2 px-3 text-xs font-medium rounded-lg transition-all text-center ${
                  kind === 'frei'
                    ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                Freier Ordner
              </button>
            </div>
          </div>

          {/* Name & Jahr */}
          <div className="space-y-3">
            <div>
              <label htmlFor="folder-name-input" className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                Ordnername (wird auch im Finder angelegt)
              </label>
              <input
                id="folder-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Steuer 2026 oder Versicherungen"
                className="w-full px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/80 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 dark:focus:border-blue-500 transition-all"
                required
              />
            </div>

            {(kind === 'steuerjahr' || kind === 'jahr') && (
              <div>
                <label htmlFor="folder-year-input" className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                  Zugeordnetes Jahr
                </label>
                <input
                  id="folder-year-input"
                  type="number"
                  min="1900"
                  max="2100"
                  value={year}
                  onChange={(e) => handleYearChange(e.target.value)}
                  placeholder="z. B. 2026"
                  className="w-full px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/80 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 dark:focus:border-blue-500 transition-all"
                  required
                />
              </div>
            )}
          </div>

          {/* Farbmarkierung */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
              Farbe
            </label>
            <div className="flex items-center gap-3">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  id={`color-preset-${preset.label.toLowerCase()}`}
                  onClick={() => setColor(preset.value)}
                  className={`w-7 h-7 rounded-full transition-transform flex items-center justify-center cursor-pointer ${
                    preset.bgClass
                  } ${
                    color === preset.value
                      ? 'ring-3 ring-blue-500/30 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 scale-110'
                      : 'hover:scale-105'
                  }`}
                  title={preset.label}
                  aria-label={preset.label}
                />
              ))}
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              id="cancel-folder-button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              id="save-folder-button"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl shadow-xs transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? 'Wird gespeichert...' : editFolder ? 'Änderungen speichern' : 'Ordner anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
