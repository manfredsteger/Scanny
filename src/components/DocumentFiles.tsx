import React from 'react';
import { Download, ExternalLink, FileCode, FileText, FolderOpen, ImageIcon, Layers } from 'lucide-react';
import { DocumentPageInfo, ScannyDocument } from '../types';

const baseName = (p: string | null | undefined) => (p ? p.split('/').pop() || p : '');

/** "/app/scanny/Archiv/_Eingang/x.pdf" → "Archiv/_Eingang" (so heißt der Ordner auch im Finder) */
const archiveFolder = (p: string | null | undefined) => {
  if (!p) return '';
  const parts = p.split('/');
  const i = parts.lastIndexOf('Archiv');
  return i >= 0 ? parts.slice(i, -1).join('/') : parts.slice(0, -1).join('/');
};

function iconFor(name: string) {
  if (/\.(md|markdown|txt)$/i.test(name)) return FileCode;
  if (/\.(jpe?g|png|heic|heif|webp)$/i.test(name)) return ImageIcon;
  return FileText;
}

function FileRow({ name, label, url }: { name: string; label: string; url: string }) {
  const Icon = iconFor(name);
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <Icon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11px] text-zinc-800 dark:text-zinc-200 truncate" title={name}>
          {name}
        </div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{label}</div>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title="Öffnen"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
      <a
        href={`${url}?download=1`}
        download={name}
        className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title="Herunterladen"
      >
        <Download className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

/**
 * Abschnitt "Dateien" im Detail-Drawer: zeigt die Dateigruppe so, wie sie im Archiv liegt –
 * erzeugtes PDF, Original mit gleichem Namen und bei zusammengefügten Dokumenten die Teile.
 */
export function DocumentFiles({ doc, pages }: { doc: ScannyDocument; pages: DocumentPageInfo[] }) {
  const [showParts, setShowParts] = React.useState(false);
  const pdfName = baseName(doc.pdf_path);
  const originalName = baseName(doc.original_path);
  const partsDir = pdfName ? pdfName.replace(/\.pdf$/i, '') + ' (Originale)' : '';
  const parts = pages.filter((p) => p.source_document_id !== null);
  if (!pdfName && !originalName) return null;

  return (
    <div id="drawer-files" className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Dateien</h3>
        <span className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 font-mono" title="Ordner im Scanny-Ordner">
          <FolderOpen className="w-3 h-3" />
          {archiveFolder(doc.pdf_path || doc.original_path)}
        </span>
      </div>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-1 divide-y divide-zinc-100 dark:divide-zinc-800/70">
        {pdfName && <FileRow name={pdfName} label="Durchsuchbares PDF" url={`/api/documents/${doc.id}/pdf`} />}
        {originalName && (
          <FileRow
            name={originalName}
            label={doc.kind === 'text' ? 'Original – Quelltext, bearbeitbar unter „Quelltext“' : 'Original'}
            url={`/api/documents/${doc.id}/original`}
          />
        )}
        {parts.length > 0 && (
          <div className="py-1.5">
            <div className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300 py-1">
              <Layers className="w-3.5 h-3.5 text-zinc-500" />
              <span className="font-mono text-[11px] truncate" title={partsDir}>
                {partsDir}/
              </span>
              {parts.length > 3 ? (
                <button
                  type="button"
                  id="drawer-files-toggle-parts"
                  onClick={() => setShowParts((v) => !v)}
                  className="ml-auto text-[10px] text-blue-600 dark:text-blue-400 shrink-0 cursor-pointer hover:underline"
                >
                  {showParts ? 'Teile ausblenden' : `${parts.length} Teile anzeigen`}
                </button>
              ) : (
                <span className="text-[10px] text-zinc-500 shrink-0">{parts.length} Teile</span>
              )}
            </div>
            {(showParts || parts.length <= 3) && (
            <div className="pl-5">
              {parts.map((part) => (
                <React.Fragment key={part.page_no}>
                  {part.source_pdf_file && (
                    <FileRow
                      name={part.source_pdf_file}
                      label={`Teil ${part.page_no} – PDF`}
                      url={`/api/documents/${part.source_document_id}/pdf`}
                    />
                  )}
                  {part.source_original_file && (
                    <FileRow
                      name={part.source_original_file}
                      label={`Teil ${part.page_no} – Original`}
                      url={`/api/documents/${part.source_document_id}/original`}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
