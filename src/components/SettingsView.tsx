import React, { useState, useEffect } from 'react';
import {
  HardDrive,
  Copy,
  Check,
  ShieldCheck,
  Cpu,
  Database,
  Terminal,
  Palette,
} from 'lucide-react';
import { SystemPaths, SystemHealth } from '../types';

interface SettingsViewProps {
  paths: SystemPaths | null;
  health: SystemHealth | null;
}

export function SettingsView({ paths, health }: SettingsViewProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<'bw' | 'gray' | 'color'>('bw');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [autoFile, setAutoFile] = useState(false);
  const [autoFileSaved, setAutoFileSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data?.default_color_mode && ['bw', 'gray', 'color'].includes(data.default_color_mode)) {
          setColorMode(data.default_color_mode);
        }
        setAutoFile(data?.auto_file === 'true');
      })
      .catch((err) => console.error('Fehler beim Laden der Einstellungen:', err));
  }, []);

  const handleColorModeChange = async (newMode: 'bw' | 'gray' | 'color') => {
    setColorMode(newMode);
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_color_mode: newMode }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch (err) {
      console.error('Fehler beim Speichern des Farbmodus:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoFileChange = async (next: boolean) => {
    setAutoFile(next);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_file: next }),
      });
      if (!res.ok) throw new Error('Speichern fehlgeschlagen');
      setAutoFileSaved(true);
      setTimeout(() => setAutoFileSaved(false), 2000);
    } catch (err) {
      console.error('Fehler beim Speichern von "Automatisch ablegen":', err);
      setAutoFile(!next);
    }
  };

  const copyPath = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const isHostMapped = Boolean(paths?.hostScannyDir && paths.hostScannyDir !== paths.scannyDir);

  const pathItems = [
    {
      key: 'SCANNY_DIR',
      title: isHostMapped ? 'Scanny-Ordner auf deinem Mac (SCANNY_PATH)' : 'Sichtbarer Basisordner (SCANNY_DIR)',
      description: 'Mac-Nutzerverzeichnis für Upload und Archiv',
      value: paths?.hostScannyDir || paths?.scannyDir || './scanny',
    },
    {
      key: 'WATCH_DIR',
      title: isHostMapped ? 'Eingangsordner auf deinem Mac' : 'Überwachter Eingangsordner (WATCH_DIR)',
      description: 'Hier abgelegte iPhone-Fotos oder Scans werden automatisch erfasst',
      value: paths?.hostWatchDir || paths?.watchDir || './scanny/Upload',
    },
    {
      key: 'ARCHIVE_DIR',
      title: isHostMapped ? 'Archiv-Verzeichnis auf deinem Mac' : 'Archiv-Verzeichnis (ARCHIVE_DIR)',
      description: 'Fertige, durchsuchbare Schwarz-Weiß-PDFs einsortiert nach Ordnern',
      value: paths?.hostArchiveDir || paths?.archiveDir || './scanny/Archiv',
    },
    {
      key: 'DATA_DIR',
      title: 'Internes Datenverzeichnis (DATA_DIR)',
      description: 'SQLite-Datenbank, Originalscans und Vorschaubilder',
      value: paths?.dataDir || './data',
    },
    {
      key: 'DB_PATH',
      title: 'SQLite-Datenbankdatei',
      description: 'Lokale Datenbankdatei mit WAL-Modus und FTS5-Volltextindex',
      value: paths?.dbPath || './data/scanny.db',
    },
  ];

  const toolDefinitions = [
    {
      key: 'python3',
      altKey: 'python',
      name: 'Python 3',
      description: 'Laufzeitumgebung für Bildverarbeitungsskripte',
    },
    {
      key: 'opencv',
      name: 'OpenCV (cv2)',
      description: 'Dokumentenkanten-Erkennung, Entzerrung und A4-Transformation',
    },
    {
      key: 'heif-convert',
      name: 'heif-convert (libheif)',
      description: 'Konvertierung von Apple iPhone Belegfotos (.HEIC / .HEIF)',
    },
    {
      key: 'ocrmypdf',
      name: 'OCRmyPDF',
      description: 'Erzeugung standardisierter, durchsuchbarer DIN A4 PDFs',
    },
    {
      key: 'tesseract',
      name: 'Tesseract OCR (deu + eng)',
      description: 'Lokale Texterkennungs-Engine mit deutschem Sprachmodell',
    },
  ];

  return (
    <div id="settings-view" className="p-8 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Einstellungen</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          Systemkonfiguration, Bildverarbeitung, aktive Verzeichnispfade und lokaler Betriebsstatus.
        </p>
      </div>

      {/* Automatisch ablegen */}
      <div className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl flex items-start justify-between gap-6">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            Automatisch ablegen
            {autoFileSaved && (
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <Check className="w-3.5 h-3.5" /> Gespeichert
              </span>
            )}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed max-w-xl">
            Wenn das Belegdatum sicher erkannt wurde und es einen passenden Steuerjahr- bzw. Jahr-Ordner gibt,
            wird der Beleg nach der Aufbereitung direkt dort abgelegt, ohne Umweg über den Eingang.
          </p>
        </div>
        <button
          type="button"
          id="settings-auto-file-toggle"
          role="switch"
          aria-checked={autoFile}
          onClick={() => handleAutoFileChange(!autoFile)}
          className={`relative shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer ${
            autoFile ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              autoFile ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </div>

      {/* Standard-Farbmodus für Bildaufbereitung */}
      <div className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Standard-Farbmodus für Belege & Scans
            </h3>
          </div>
          {saveSuccess && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" /> Gespeichert
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Bestimmt, wie neu importierte Dokumente und Smartphone-Fotos standardmäßig aufbereitet werden.
          Im Belegdetail kann der Modus jederzeit individuell geändert werden.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {[
            {
              id: 'bw',
              title: 'Schwarz-Weiß (S/W)',
              desc: 'Optimal für Textdokumente, Rechnungen & kleine Dateigrößen (Standard).',
            },
            {
              id: 'gray',
              title: 'Graustufen',
              desc: 'Erhält feine Schattierungen, Stempel & Graustufen-Grafiken.',
            },
            {
              id: 'color',
              title: 'Farbe',
              desc: 'Volle Farbwiedergabe mit lokalem Weißabgleich & Schattenausgleich.',
            },
          ].map((mode) => {
            const isSelected = colorMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                id={`setting-color-mode-${mode.id}`}
                onClick={() => handleColorModeChange(mode.id as 'bw' | 'gray' | 'color')}
                disabled={isSaving}
                className={`p-3.5 text-left rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-purple-600 bg-purple-50/50 dark:bg-purple-950/20 text-purple-950 dark:text-purple-200 ring-1 ring-purple-500'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40 text-zinc-800 dark:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold">{mode.title}</span>
                  <div
                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                      isSelected
                        ? 'border-purple-600 bg-purple-600'
                        : 'border-zinc-300 dark:border-zinc-600'
                    }`}
                  >
                    {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
                  {mode.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Aktive Pfade */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-blue-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Aktive Dateisystem-Pfade
            </h3>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
            {isHostMapped ? 'Mac-Host-Pfade aktiv' : 'Lokale Pfade'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {pathItems.map((item) => (
            <div
              key={item.key}
              className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {item.title}
                </span>
                <button
                  type="button"
                  id={`copy-path-${item.key.toLowerCase()}`}
                  onClick={() => copyPath(item.key, item.value)}
                  className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                  title="Pfad kopieren"
                >
                  {copiedKey === item.key ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-500" />
                      <span className="text-emerald-500 font-medium">Kopiert!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Kopieren</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {item.description}
              </p>
              <div className="mt-1">
                <code className="inline-block w-full px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/60 rounded-lg text-xs font-mono text-zinc-800 dark:text-zinc-200 truncate select-all">
                  {item.value}
                </code>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Systemstatus & Werkzeuge */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              System-Tools & Verarbeitungs-Pipeline
            </h3>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-medium">
            Scanny v{health?.version || '0.1.0'}
          </span>
        </div>

        {/* Werkzeugliste */}
        <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {toolDefinitions.map((tool) => {
            const isInstalled = health?.tools
              ? Boolean(health.tools[tool.key] || (tool.altKey && health.tools[tool.altKey]))
              : false;
            return (
              <div key={tool.key} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {tool.name}
                    </span>
                    <code className="text-[10px] font-mono px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded">
                      {tool.key}
                    </code>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {tool.description}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isInstalled ? 'bg-emerald-500 shadow-xs shadow-emerald-500/50' : 'bg-rose-500'
                    }`}
                  />
                  <span
                    className={`text-xs font-medium ${
                      isInstalled ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {isInstalled ? 'Bereit' : 'Nicht verfügbar'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Datenbank & Pipeline Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  SQLite Datenbank
                </span>
              </div>
              <span className="px-2 py-0.5 text-[11px] bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-full font-medium">
                WAL-Modus aktiv
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              better-sqlite3 mit synchronen Migrationen (Schema v5), FTS5-Volltextindex und lokaler Dokumentverwaltung.
            </p>
          </div>

          <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Verarbeitungs-Engine
                </span>
              </div>
              <span className="px-2 py-0.5 text-[11px] bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-full font-medium">
                Schritt 2 aktiv
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              OpenCV Dokumentenkanten-Erkennung, Schattenbereinigung und DIN A4 Transformation aktiv.
            </p>
          </div>
        </div>
      </div>

      {/* Datenschutz & Lokales Versprechen */}
      <div className="p-5 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-2xl flex items-start gap-3.5">
        <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-emerald-950 dark:text-emerald-200">
            Datenschutzgarantie: 100% lokal auf Ihrem Mac
          </h4>
          <p className="text-xs text-emerald-900/80 dark:text-emerald-300/80 leading-relaxed">
            Scanny verwendet bewusst keinerlei Cloud-Dienste, keine externen KI-APIs und kein iCloud. Ihre privaten Steuerunterlagen und Belege werden ausschließlich auf Ihrem eigenen Rechner verarbeitet und archiviert.
          </p>
        </div>
      </div>
    </div>
  );
}
