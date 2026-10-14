import React, { useState, useRef, useEffect } from 'react';
import {
  Folder as FolderIcon,
  Upload,
  Search,
  Merge,
  RotateCw,
  Move,
  Hash,
  Minimize2,
  ScanText,
  Lock,
  ShieldAlert,
  MessageSquare,
  Columns2,
  Image as ImageIcon,
  FileText,
  Table,
  FilePlus,
  FileCode,
  FileSpreadsheet,
  Presentation,
  Loader2,
  Sparkles,
  ArrowRight,
  FolderOpen,
  ArrowLeft,
  ScanLine,
  X,
  SlidersHorizontal,
  Download,
  ChevronDown,
  Layers,
  Check,
} from 'lucide-react';
import { Folder, StudioPageItem } from '../types';
import { DocumentStudioModal, StudioMode } from './DocumentStudioModal';
import { PdfCompressModal } from './tools/PdfCompressModal';
import { PdfOcrModal } from './tools/PdfOcrModal';
import { PdfCompareModal } from './tools/PdfCompareModal';
import { PdfRedactModal } from './tools/PdfRedactModal';

interface ToolsViewProps {
  folders: Folder[];
  onRefresh: () => Promise<void>;
  onOpenInbox: () => void;
  onOpenDashboard?: () => void;
  onBack?: () => void;
}

export type ToolCategory =
  | 'Alle'
  | 'Organisieren'
  | 'Optimieren'
  | 'Schützen'
  | 'Überarbeiten'
  | 'Erstellen'
  | 'Konvertieren';

interface ToolCard {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  category: Exclude<ToolCategory, 'Alle'>;
  colorClass: string;
  iconBgClass: string;
  badge?: string;
  isHero?: boolean;
}

export function ToolsView({
  folders,
  onRefresh,
  onOpenInbox,
  onOpenDashboard,
  onBack,
}: ToolsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory>('Alle');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');

  // Studio Modal State
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [studioPages, setStudioPages] = useState<StudioPageItem[]>([]);
  const [studioSessionId, setStudioSessionId] = useState('');
  const [studioMode, setStudioMode] = useState<StudioMode>('general');

  // Spezialisierte Modale
  const [isCompressModalOpen, setIsCompressModalOpen] = useState(false);
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [isRedactModalOpen, setIsRedactModalOpen] = useState(false);
  const [isToolsExportDropdownOpen, setIsToolsExportDropdownOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const toolsExportDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        toolsExportDropdownRef.current &&
        !toolsExportDropdownRef.current.contains(e.target as Node)
      ) {
        setIsToolsExportDropdownOpen(false);
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);


  const handleReturnToScanny = () => {
    if (onBack) {
      onBack();
    } else {
      onOpenInbox();
    }
  };

  // Rekursives Auslesen aller Dateien aus einem gedroppten Ordner
  const getFilesFromDataTransfer = async (dataTransfer: DataTransfer): Promise<File[]> => {
    const files: File[] = [];
    const items = dataTransfer.items;
    if (!items || items.length === 0) {
      return Array.from(dataTransfer.files);
    }

    const queue: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.webkitGetAsEntry) {
        const entry = item.webkitGetAsEntry();
        if (entry) queue.push(entry);
      } else if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }

    while (queue.length > 0) {
      const entry = queue.shift();
      if (entry.isFile) {
        await new Promise<void>((resolve) => {
          entry.file(
            (file: File) => {
              files.push(file);
              resolve();
            },
            () => resolve()
          );
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        await new Promise<void>((resolve) => {
          const readEntries = () => {
            dirReader.readEntries(
              async (entries: any[]) => {
                if (entries.length === 0) {
                  resolve();
                } else {
                  for (const e of entries) {
                    queue.push(e);
                  }
                  readEntries();
                }
              },
              () => resolve()
            );
          };
          readEntries();
        });
      }
    }

    return files.length > 0 ? files : Array.from(dataTransfer.files);
  };

  // Dateien an das Backend senden und Werkbank öffnen
  const processFilesIntoStudio = async (files: File[], targetMode: StudioMode = studioMode) => {
    if (files.length === 0) return;
    setIsProcessingUpload(true);
    setUploadProgressText(
      `${files.length} Datei${files.length === 1 ? '' : 'en'} werden analysiert und Seiten extrahiert…`
    );

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));

      const res = await fetch('/api/tools/prepare-session', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Fehler beim Analysieren der Dateien.');
      }

      const data = await res.json();
      setStudioPages(data.pages || []);
      setStudioSessionId(data.sessionId || '');
      setStudioMode(targetMode);
      setIsStudioOpen(true);
    } catch (err: any) {
      alert(err.message || 'Fehler beim Laden der Werkbank.');
    } finally {
      setIsProcessingUpload(false);
      setUploadProgressText('');
    }
  };

  // Drag & Drop Handler
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = await getFilesFromDataTransfer(e.dataTransfer);
    const modeToUse: StudioMode = files.length > 1 ? 'merge' : 'general';
    await processFilesIntoStudio(files, modeToUse);
  };

  // Klick auf ein Werkzeug im Katalog
  const handleToolClick = (toolId: string) => {
    switch (toolId) {
      case 'merge':
        setStudioMode('merge');
        fileInputRef.current?.click();
        break;
      case 'rotate':
        setStudioMode('rotate');
        fileInputRef.current?.click();
        break;
      case 'manage_pages':
        setStudioMode('organize');
        fileInputRef.current?.click();
        break;
      case 'page_numbers':
        setStudioMode('organize');
        fileInputRef.current?.click();
        break;
      case 'compress':
        setIsCompressModalOpen(true);
        break;
      case 'ocr':
        setIsOcrModalOpen(true);
        break;
      case 'compare':
        setIsCompareModalOpen(true);
        break;
      case 'redact':
        setIsRedactModalOpen(true);
        break;
      case 'empty_pdf':
        setStudioMode('general');
        processFilesIntoStudio(
          [new File(['Neues Dokument'], 'Neues_Dokument.txt', { type: 'text/plain' })],
          'general'
        );
        break;
      default:
        setStudioMode('general');
        fileInputRef.current?.click();
        break;
    }
  };

  // Werkzeuge-Katalog: Klar verständliche Icons (Merge, RotateCw, Move) und professionelles Design
  const toolCards: ToolCard[] = [
    // 1. Organisieren
    {
      id: 'merge',
      title: 'PDFs zusammenführen',
      description:
        'Mehrere PDFs und Bilddateien in gewünschter Reihenfolge zu einer einzigen PDF vereinen.',
      icon: <Merge className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
      category: 'Organisieren',
      colorClass: 'border-blue-500/30 hover:border-blue-500/60 dark:hover:border-blue-400/60',
      iconBgClass: 'bg-blue-500/10 dark:bg-blue-500/20',
      badge: 'Zusammenführen',
      isHero: true,
    },
    {
      id: 'rotate',
      title: 'PDF & Seiten drehen',
      description:
        'Kopfstehende oder verdrehte Seiten um 90° oder 180° dauerhaft ausrichten – einzeln oder alle gemeinsam.',
      icon: <RotateCw className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      category: 'Organisieren',
      colorClass: 'border-amber-500/30 hover:border-amber-500/60 dark:hover:border-amber-400/60',
      iconBgClass: 'bg-amber-500/10 dark:bg-amber-500/20',
      badge: 'Drehen',
      isHero: true,
    },
    {
      id: 'manage_pages',
      title: 'Seiten verschieben & anordnen',
      description:
        'Seiten per Drag & Drop frei verschieben, umsortieren, duplizieren oder überflüssige Seiten löschen.',
      icon: <Move className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
      category: 'Organisieren',
      colorClass: 'border-indigo-500/30 hover:border-indigo-500/60 dark:hover:border-indigo-400/60',
      iconBgClass: 'bg-indigo-500/10 dark:bg-indigo-500/20',
      badge: 'Verschieben',
      isHero: true,
    },
    {
      id: 'page_numbers',
      title: 'Seitenzahlen einfügen',
      description:
        'Einheitliche Seitennummerierung („Seite X von Y“) oben oder unten auf den Seiten platzieren.',
      icon: <Hash className="w-5 h-5 text-violet-600 dark:text-violet-400" />,
      category: 'Organisieren',
      colorClass: 'border-violet-500/30 hover:border-violet-500/60 dark:hover:border-violet-400/60',
      iconBgClass: 'bg-violet-500/10 dark:bg-violet-500/20',
      badge: 'Nummerierung',
    },

    // 2. Optimieren
    {
      id: 'compress',
      title: 'PDF komprimieren',
      description:
        'PDF-Dateigröße mit verschiedenen Qualitätsstufen reduzieren (ideal für E-Mail & Scanny).',
      icon: <Minimize2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
      category: 'Optimieren',
      colorClass: 'border-emerald-500/30 hover:border-emerald-500/60 dark:hover:border-emerald-400/60',
      iconBgClass: 'bg-emerald-500/10 dark:bg-emerald-500/20',
      badge: 'Größe sparen',
    },
    {
      id: 'ocr',
      title: 'Text erkennen (OCR)',
      description:
        'Eingescannten Text mit OCR durchsuchbar machen, Textstellen markieren und exportieren.',
      icon: <ScanText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
      category: 'Optimieren',
      colorClass: 'border-emerald-500/30 hover:border-emerald-500/60 dark:hover:border-emerald-400/60',
      iconBgClass: 'bg-emerald-500/10 dark:bg-emerald-500/20',
      badge: 'OCR',
    },

    // 3. Schützen
    {
      id: 'password',
      title: 'Passwort festlegen',
      description: 'Vertrauliche Dokumente mit einem Passwort vor unbefugtem Öffnen schützen.',
      icon: <Lock className="w-5 h-5 text-rose-600 dark:text-rose-400" />,
      category: 'Schützen',
      colorClass: 'border-rose-500/30 hover:border-rose-500/60 dark:hover:border-rose-400/60',
      iconBgClass: 'bg-rose-500/10 dark:bg-rose-500/20',
      badge: 'Sicherheit',
    },
    {
      id: 'redact',
      title: 'PDF zensieren & schwärzen',
      description: 'Vertrauliche Informationen, IBAN oder Adressen dauerhaft unkenntlich machen.',
      icon: <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400" />,
      category: 'Schützen',
      colorClass: 'border-rose-500/30 hover:border-rose-500/60 dark:hover:border-rose-400/60',
      iconBgClass: 'bg-rose-500/10 dark:bg-rose-500/20',
      badge: 'Datenschutz',
    },

    // 4. Überarbeiten
    {
      id: 'comment',
      title: 'PDFs kommentieren',
      description: 'Notizen, Randbemerkungen und Hervorhebungen auf Seiten anbringen.',
      icon: <MessageSquare className="w-5 h-5 text-sky-600 dark:text-sky-400" />,
      category: 'Überarbeiten',
      colorClass: 'border-sky-500/30 hover:border-sky-500/60 dark:hover:border-sky-400/60',
      iconBgClass: 'bg-sky-500/10 dark:bg-sky-500/20',
      badge: 'Notizen',
    },
    {
      id: 'compare',
      title: 'PDFs vergleichen',
      description: 'Zwei Dokumente nebeneinander anzeigen und auf inhaltliche Abweichungen prüfen.',
      icon: <Columns2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />,
      category: 'Überarbeiten',
      colorClass: 'border-sky-500/30 hover:border-sky-500/60 dark:hover:border-sky-400/60',
      iconBgClass: 'bg-sky-500/10 dark:bg-sky-500/20',
      badge: 'Vergleich',
    },

    // 5. Erstellen
    {
      id: 'images_to_pdf',
      title: 'Bilder in PDF',
      description: 'Fotos und Rechnungsbilder (JPG, PNG) zu einem sauberen PDF zusammenfügen.',
      icon: <ImageIcon className="w-5 h-5 text-teal-600 dark:text-teal-400" />,
      category: 'Erstellen',
      colorClass: 'border-teal-500/30 hover:border-teal-500/60 dark:hover:border-teal-400/60',
      iconBgClass: 'bg-teal-500/10 dark:bg-teal-500/20',
      badge: 'Fotos zu PDF',
    },
    {
      id: 'word_to_pdf',
      title: 'Word in PDF',
      description: 'Ein PDF aus einem Word- oder Textdokument erzeugen.',
      icon: <FileText className="w-5 h-5 text-teal-600 dark:text-teal-400" />,
      category: 'Erstellen',
      colorClass: 'border-teal-500/30 hover:border-teal-500/60 dark:hover:border-teal-400/60',
      iconBgClass: 'bg-teal-500/10 dark:bg-teal-500/20',
    },
    {
      id: 'excel_to_pdf',
      title: 'Tabelle in PDF',
      description: 'Excel- und CSV-Tabellen in strukturierte PDFs verwandeln.',
      icon: <Table className="w-5 h-5 text-teal-600 dark:text-teal-400" />,
      category: 'Erstellen',
      colorClass: 'border-teal-500/30 hover:border-teal-500/60 dark:hover:border-teal-400/60',
      iconBgClass: 'bg-teal-500/10 dark:bg-teal-500/20',
    },
    {
      id: 'other_to_pdf',
      title: 'Andere Dateien in PDF',
      description: 'PDFs aus Präsentationen, Textdateien uvm. erstellen.',
      icon: <FilePlus className="w-5 h-5 text-teal-600 dark:text-teal-400" />,
      category: 'Erstellen',
      colorClass: 'border-teal-500/30 hover:border-teal-500/60 dark:hover:border-teal-400/60',
      iconBgClass: 'bg-teal-500/10 dark:bg-teal-500/20',
    },
    {
      id: 'empty_pdf',
      title: 'Leeres PDF',
      description: 'Ein neues, leeres PDF erstellen und Seiten hinzufügen.',
      icon: <FileCode className="w-5 h-5 text-teal-600 dark:text-teal-400" />,
      category: 'Erstellen',
      colorClass: 'border-teal-500/30 hover:border-teal-500/60 dark:hover:border-teal-400/60',
      iconBgClass: 'bg-teal-500/10 dark:bg-teal-500/20',
    },

    // 6. Konvertieren
    {
      id: 'pdf_to_word',
      title: 'PDF in Word',
      description: 'PDFs in bearbeitbare Word-Dokumente umwandeln.',
      icon: <FileText className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      category: 'Konvertieren',
      colorClass: 'border-amber-500/30 hover:border-amber-500/60 dark:hover:border-amber-400/60',
      iconBgClass: 'bg-amber-500/10 dark:bg-amber-500/20',
    },
    {
      id: 'pdf_to_image',
      title: 'PDF in Bild',
      description: 'PDF-Seiten als hochauflösende Bilder (JPG/PNG) speichern.',
      icon: <ImageIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      category: 'Konvertieren',
      colorClass: 'border-amber-500/30 hover:border-amber-500/60 dark:hover:border-amber-400/60',
      iconBgClass: 'bg-amber-500/10 dark:bg-amber-500/20',
    },
    {
      id: 'pdf_to_excel',
      title: 'PDF in Excel',
      description: 'Tabellenstrukturen aus einem PDF als Excel-Tabelle speichern.',
      icon: <FileSpreadsheet className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      category: 'Konvertieren',
      colorClass: 'border-amber-500/30 hover:border-amber-500/60 dark:hover:border-amber-400/60',
      iconBgClass: 'bg-amber-500/10 dark:bg-amber-500/20',
    },
    {
      id: 'pdf_to_ppt',
      title: 'PDF in PowerPoint',
      description: 'PDFs in PowerPoint-Folien konvertieren.',
      icon: <Presentation className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      category: 'Konvertieren',
      colorClass: 'border-amber-500/30 hover:border-amber-500/60 dark:hover:border-amber-400/60',
      iconBgClass: 'bg-amber-500/10 dark:bg-amber-500/20',
    },
  ];

  const categories: ToolCategory[] = [
    'Alle',
    'Organisieren',
    'Optimieren',
    'Schützen',
    'Überarbeiten',
    'Erstellen',
    'Konvertieren',
  ];

  const filteredCards = toolCards.filter((card) => {
    if (selectedCategory !== 'Alle' && card.category !== selectedCategory) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      card.title.toLowerCase().includes(q) ||
      card.description.toLowerCase().includes(q) ||
      card.category.toLowerCase().includes(q)
    );
  });

  const categoryDisplayList: Array<Exclude<ToolCategory, 'Alle'>> =
    selectedCategory === 'Alle'
      ? ['Organisieren', 'Optimieren', 'Schützen', 'Überarbeiten', 'Erstellen', 'Konvertieren']
      : [selectedCategory as Exclude<ToolCategory, 'Alle'>];

  return (
    <div
      id="tools-view-container"
      className="flex-1 flex flex-col h-screen overflow-y-auto bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
    >
      {/* Versteckte File-Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files) processFilesIntoStudio(Array.from(e.target.files));
          e.target.value = '';
        }}
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={folderInputRef}
        // @ts-ignore
        webkitdirectory=""
        directory=""
        onChange={(e) => {
          if (e.target.files) processFilesIntoStudio(Array.from(e.target.files));
          e.target.value = '';
        }}
        multiple
        className="hidden"
      />

      <div className="max-w-6xl w-full mx-auto p-6 md:p-8 space-y-6">
        {/* OBERE NAVIGATIONSLEISTE: ZURÜCK ZU SCANNY & ABBRECHEN */}
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <button
              type="button"
              id="tools-back-button"
              onClick={handleReturnToScanny}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
              title="Zurück zum Scanny Posteingang"
            >
              <ArrowLeft className="w-4 h-4 text-zinc-500" />
              <div className="w-5 h-5 rounded-md bg-blue-600 text-white flex items-center justify-center shadow-xs">
                <ScanLine className="w-3 h-3" />
              </div>
              <span>Zurück zu Scanny</span>
            </button>

            <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />

            {/* Breadcrumb-Pfad */}
            <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              {onOpenDashboard && (
                <>
                  <button
                    type="button"
                    onClick={onOpenDashboard}
                    className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                  >
                    Übersicht
                  </button>
                  <span>/</span>
                </>
              )}
              <button
                type="button"
                onClick={onOpenInbox}
                className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
              >
                Eingang
              </button>
              <span>/</span>
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">Tools</span>
            </div>
          </div>

          {/* Rechte Seite: Export-Button mit Dropdown & Abbrechen Button */}
          <div className="flex items-center gap-2">
            {/* EXPORT-BUTTON MIT DROPDOWN IN DER TOOLSVIEW */}
            <div className="relative" ref={toolsExportDropdownRef}>
              <button
                type="button"
                id="tools-export-dropdown-btn"
                onClick={() => setIsToolsExportDropdownOpen(!isToolsExportDropdownOpen)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
                title="Dokumente oder Seiten exportieren (PDF, JPG, PNG)"
              >
                <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Exportieren</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${
                    isToolsExportDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isToolsExportDropdownOpen && (
                <div
                  id="tools-export-menu"
                  className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-2 z-50 text-left animate-in fade-in zoom-in-95 duration-100"
                >
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Dokumenten-Export
                  </div>

                  {/* 1. PDF Export */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsToolsExportDropdownOpen(false);
                      if (studioPages.length > 0) {
                        setIsStudioOpen(true);
                      } else {
                        fileInputRef.current?.click();
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 flex items-center gap-2.5 transition-colors cursor-pointer group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-zinc-900 dark:text-white">Als PDF Dokument (.pdf)</div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {studioPages.length > 0
                          ? `${studioPages.length} Seiten als PDF speichern`
                          : 'Dateien wählen und als PDF exportieren'}
                      </div>
                    </div>
                  </button>

                  {/* 2. Alle Seiten als Bilder (.zip) */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsToolsExportDropdownOpen(false);
                      if (studioPages.length > 0) {
                        setIsStudioOpen(true);
                      } else {
                        fileInputRef.current?.click();
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 flex items-center gap-2.5 transition-colors cursor-pointer group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-zinc-900 dark:text-white">
                        Alle Seiten als Bilder (.zip)
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        Alle Seiten als hochauflösende Bilder im Archiv
                      </div>
                    </div>
                  </button>

                  <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-1.5 mx-1" />

                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Einzelne Seiten als Bild
                  </div>

                  {/* 3. Einzelne Seiten als Bild (JPG / PNG) */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsToolsExportDropdownOpen(false);
                      if (studioPages.length > 0) {
                        setIsStudioOpen(true);
                      } else {
                        fileInputRef.current?.click();
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 flex items-center gap-2.5 transition-colors cursor-pointer group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-zinc-900 dark:text-white flex items-center gap-1.5">
                        <span>Einzelseite als Bild (JPG / PNG)</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold">
                          JPG/PNG
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        Einzelne Dokumentseiten als JPG oder PNG herunterladen
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Abbrechen / Verlassen Button */}
            <button
              type="button"
              id="tools-close-button"
              onClick={handleReturnToScanny}
              className="px-3.5 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer border border-transparent hover:border-zinc-300 dark:hover:border-zinc-700"
              title="Tools verlassen und zu Scanny zurückkehren"
            >
              Abbrechen
            </button>
          </div>

        </div>

        {/* Titelzeile & Suche */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-400 font-semibold text-[11px] border border-blue-500/20">
                Dokumenten-Vorbereitung
              </span>
              <span className="text-xs text-zinc-400">•</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                16 praktische Werkzeuge
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mt-1">
              PDF-Tools für einen guten Start
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
              Dokumente vorbereiten vor der Ablage: Seiten <strong>drehen</strong>, per Drag & Drop{' '}
              <strong>verschieben</strong>, <strong>zusammenführen</strong> und lokal downloaden oder
              direkt an Scanny übergeben.
            </p>
          </div>

          {/* Suchleiste für Tools */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tools durchsuchen..."
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-9 pr-8 py-2 text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 shadow-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded cursor-pointer"
                title="Suche zurücksetzen"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* PROMINENTER WORKSPACE DROP-BEREICH (Ganzen Ordner oder beliebige Dateien reinziehen) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={handleDrop}
          className={`relative rounded-3xl border-2 border-dashed p-7 md:p-9 transition-all select-none overflow-hidden ${
            isDraggingOver
              ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 scale-[1.01] shadow-2xl'
              : 'border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 hover:border-blue-400/60 dark:hover:border-blue-500/40 shadow-xs'
          }`}
        >
          {isProcessingUpload ? (
            <div className="flex flex-col items-center justify-center text-center space-y-3 py-6">
              <Loader2 className="w-10 h-10 animate-spin text-blue-600 dark:text-blue-400" />
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {uploadProgressText}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Miniaturansichten werden in hoher Qualität generiert…
              </p>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4 text-center md:text-left">
                <div className="w-16 h-16 rounded-2xl bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
                  <FolderOpen className="w-8 h-8" />
                </div>
                <div>
                  <div className="flex items-center gap-2 justify-center md:justify-start">
                    <h2 className="text-base font-bold text-zinc-900 dark:text-white">
                      Ganzen Ordner oder beliebige Dateien hier hineinziehen
                    </h2>
                    <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                      Multi-Dateien Werkbank
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 max-w-xl leading-relaxed">
                    Ziehen Sie einen ganzen Ordner mit unterschiedlichsten Dateitypen (PDF, Fotos,
                    Dokumente) hinein. Sie erhalten eine visuelle Dokumentenvorschau aller Seiten zum{' '}
                    <strong>Zusammenführen</strong>, <strong>Drehen</strong> und{' '}
                    <strong>Verschieben</strong>.
                  </p>
                </div>
              </div>

              {/* Aktionsbuttons */}
              <div className="flex flex-wrap items-center justify-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Dateien wählen</span>
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer border border-zinc-200 dark:border-zinc-700"
                >
                  <FolderIcon className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Ganzen Ordner wählen</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* HERO-BEREICH: DIE 3 KERNAKTIONEN MIT KLAR VERSTÄNDLICHEN LUCIDE-ICONS */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 px-1">
              <Sparkles className="w-3.5 h-3.5 text-blue-500" />
              <span>Häufig genutzt • Seiten-Bearbeitung</span>
            </h3>
            <span className="text-[11px] text-zinc-400 hidden sm:inline">
              Mit einem Klick direkt in der Werkbank starten
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* 1. Zusammenführen mit Merge-Icon */}
            <button
              type="button"
              id="hero-tool-merge"
              onClick={() => handleToolClick('merge')}
              className="group p-4 bg-white dark:bg-zinc-900 border border-blue-200/80 dark:border-blue-900/50 hover:border-blue-500 dark:hover:border-blue-400 rounded-2xl text-left transition-all hover:shadow-md cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center transition-transform group-hover:scale-110">
                    <Merge className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    Zusammenführen
                  </span>
                </div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  PDFs zusammenführen
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                  Mehrere Dateien oder Bilder zu einem einheitlichen PDF verbinden.
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-xs font-semibold text-blue-600 dark:text-blue-400">
                <span>Dateien vereinen</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
              </div>
            </button>

            {/* 2. Drehen mit RotateCw-Icon */}
            <button
              type="button"
              id="hero-tool-rotate"
              onClick={() => handleToolClick('rotate')}
              className="group p-4 bg-white dark:bg-zinc-900 border border-amber-200/80 dark:border-amber-900/50 hover:border-amber-500 dark:hover:border-amber-400 rounded-2xl text-left transition-all hover:shadow-md cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center transition-transform group-hover:scale-110">
                    <RotateCw className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                    Drehen & Ausrichten
                  </span>
                </div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                  PDF & Seiten drehen
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                  Kopfstehende Seiten dauerhaft um 90° oder 180° aufrecht drehen.
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-xs font-semibold text-amber-600 dark:text-amber-400">
                <span>Seiten ausrichten</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
              </div>
            </button>

            {/* 3. Verschieben mit Move-Icon */}
            <button
              type="button"
              id="hero-tool-move"
              onClick={() => handleToolClick('manage_pages')}
              className="group p-4 bg-white dark:bg-zinc-900 border border-indigo-200/80 dark:border-indigo-900/50 hover:border-indigo-500 dark:hover:border-indigo-400 rounded-2xl text-left transition-all hover:shadow-md cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center transition-transform group-hover:scale-110">
                    <Move className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    Verschieben & Sortieren
                  </span>
                </div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  Seiten verschieben & anordnen
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                  Seiten per Drag & Drop frei verschieben, umsortieren oder löschen.
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                <span>Reihenfolge ordnen</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
              </div>
            </button>
          </div>
        </div>

        {/* KATEGORIE-FILTER-LEISTE */}
        <div className="pt-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mr-1 flex items-center gap-1">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Kategorie:</span>
            </span>
            {categories.map((cat) => {
              const count =
                cat === 'Alle' ? toolCards.length : toolCards.filter((c) => c.category === cat).length;
              const isSelected = selectedCategory === cat;

              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-xs'
                      : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  <span>{cat}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isSelected
                        ? 'bg-white/20 dark:bg-zinc-900/20 text-current'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <span className="text-xs text-zinc-400">
            {filteredCards.length} {filteredCards.length === 1 ? 'Werkzeug' : 'Werkzeuge'} verfügbar
          </span>
        </div>

        {/* KATEGORISIERTES TOOL-GRID */}
        <div className="space-y-8 pt-2">
          {categoryDisplayList.map((category) => {
            const cardsInCat = filteredCards.filter((c) => c.category === category);
            if (cardsInCat.length === 0) return null;

            return (
              <div key={category} className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {category}
                  </h3>
                  <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                  <span className="text-[11px] text-zinc-400">{cardsInCat.length} Tools</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {cardsInCat.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      id={`tool-card-${card.id}`}
                      onClick={() => handleToolClick(card.id)}
                      className={`group p-4 bg-white dark:bg-zinc-900 border rounded-2xl text-left transition-all flex items-start gap-3.5 cursor-pointer hover:shadow-md min-h-[104px] ${card.colorClass} border-zinc-200 dark:border-zinc-800`}
                    >
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${card.iconBgClass}`}
                      >
                        {card.icon}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <h4 className="text-sm font-semibold text-zinc-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                              {card.title}
                            </h4>
                            {card.badge && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0">
                                {card.badge}
                              </span>
                            )}
                          </div>
                          <ArrowRight className="w-4 h-4 text-zinc-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0" />
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                          {card.description}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* HAUPT-MODAL: Seiten- & Dokumenten-Studio */}
      <DocumentStudioModal
        isOpen={isStudioOpen}
        initialPages={studioPages}
        initialSessionId={studioSessionId}
        initialMode={studioMode}
        folders={folders}
        onClose={() => setIsStudioOpen(false)}
        onRefresh={onRefresh}
        onOpenInbox={onOpenInbox}
      />

      {/* SPEZIALISIERTE MODALE */}
      <PdfCompressModal
        isOpen={isCompressModalOpen}
        onClose={() => setIsCompressModalOpen(false)}
        onRefresh={onRefresh}
      />

      <PdfOcrModal
        isOpen={isOcrModalOpen}
        onClose={() => setIsOcrModalOpen(false)}
      />

      <PdfCompareModal
        isOpen={isCompareModalOpen}
        onClose={() => setIsCompareModalOpen(false)}
      />

      <PdfRedactModal
        isOpen={isRedactModalOpen}
        onClose={() => setIsRedactModalOpen(false)}
      />
    </div>
  );
}
