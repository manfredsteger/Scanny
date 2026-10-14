import path from 'node:path';
import fs from 'node:fs';
import { getDb, paths } from '../db.js';

/**
 * Dateihaushalt: Jeder Beleg ist eine DATEIGRUPPE mit gemeinsamem, sprechendem Grundnamen
 * ("YYYY-MM-DD Titel") im selben Ordner:
 *
 *   2026-10-03 Rechnung Bäckerei Müller.pdf          erzeugtes PDF          (documents.pdf_path)
 *   2026-10-03 Rechnung Bäckerei Müller.heic         Original               (documents.original_path)
 *   2026-10-03 Rechnung Bäckerei Müller (Original).pdf   Original, das schon ein PDF war
 *   2026-10-03 Rechnung Bäckerei Müller (Originale)/     Teile eines zusammengefügten Dokuments
 *
 * Die Gruppe wird IMMER gemeinsam verschoben/umbenannt (planGroup → executePlan → applyPlanToDb),
 * Dateisystem zuerst, dann DB (Regel 7), bei Fehlern zurückgerollt.
 */

export const INBOX_DIR_NAME = '_Eingang';
export const TRASH_DIR_NAME = '_Papierkorb';
export const PARTS_SUFFIX = ' (Originale)';
export const ORIGINAL_PDF_SUFFIX = ' (Original)';

/** Maximale Länge des Grundnamens (ohne Endung/Zusatz), damit Dateinamen handlich bleiben. */
const MAX_BASE_LENGTH = 100;

/**
 * Ordner rekursiv kopieren. Bewusst ohne fs.cpSync: das scheitert unter Docker Desktop auf
 * macOS-Bind-Mounts (virtiofs) mit EACCES, während copyFileSync dort funktioniert.
 */
export function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

/**
 * Verschiebt eine Datei oder einen Ordner; fällt bei EXDEV (unterschiedliche Mountpoints) auf
 * Kopieren + Löschen zurück.
 */
export function moveOrCopySync(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (err: any) {
    if (err && (err.code === 'EXDEV' || err.code === 'EPERM')) {
      if (fs.statSync(src).isDirectory()) {
        copyDirSync(src, dest);
        fs.rmSync(src, { recursive: true, force: true });
      } else {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      }
    } else {
      throw err;
    }
  }
}

/** Liefert YYYY-MM-DD in lokaler Zeit (TZ des Containers), nicht UTC. */
export function localDateString(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const valid = isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(valid.getDate())}`;
}

/** Bereinigt einen Titel für das Dateisystem (keine ungültigen Zeichen, kein führender Punkt). */
export function sanitizeFilenameTitle(rawTitle: string): string {
  return (
    rawTitle
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^\.+/, '')
      .trim() || 'Beleg'
  );
}

/** Archivverzeichnis für einen Ordner (bzw. _Eingang, wenn kein Ordner gesetzt ist). */
export function archiveDirForFolder(folderId: number | null | undefined): string {
  if (folderId) {
    const folder = getDb().prepare('SELECT name FROM folders WHERE id = ?').get(folderId) as
      | { name: string }
      | undefined;
    if (folder?.name) return path.join(paths.archiveDir, folder.name);
  }
  return path.join(paths.archiveDir, INBOX_DIR_NAME);
}

export function trashDir(): string {
  return path.join(paths.archiveDir, TRASH_DIR_NAME);
}

/** Dateizusatz des Originals: eigene Endung, bei PDFs " (Original).pdf" (sonst gleicher Name wie das Archiv-PDF). */
export function originalSuffix(originalPathOrName: string): string {
  const ext = path.extname(originalPathOrName).toLowerCase();
  return ext === '.pdf' ? `${ORIGINAL_PDF_SUFFIX}.pdf` : ext;
}

/** Ordner mit den Teilen eines zusammengefügten Dokuments: liegt neben dessen PDF. */
export function partsDirFor(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/i, '') + PARTS_SUFFIX;
}

/** Grundname "YYYY-MM-DD Titel" aus den Belegwerten. */
export function groupLabel(doc: {
  title: string | null;
  doc_date: string | null;
  original_name: string | null;
  created_at: string | null;
  file_date?: string | null;
}): string {
  const date =
    doc.doc_date && /^\d{4}-\d{2}-\d{2}$/.test(doc.doc_date.trim())
      ? doc.doc_date.trim()
      : localDateString(doc.created_at);
  const title = (doc.title && doc.title.trim()) || (doc.original_name ? path.parse(doc.original_name).name : 'Beleg');
  return `${date} ${sanitizeFilenameTitle(title)}`;
}

/**
 * Sucht einen Grundnamen in `dir`, unter dem ALLE Mitglieder der Gruppe (`suffixes`) frei sind.
 * Pfade aus `own` gelten als frei (gehören bereits zu dieser Gruppe). Kollision → " (2)", " (3)" …
 */
export function reserveBase(dir: string, label: string, suffixes: string[], own: Set<string> = new Set()): string {
  const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max).trim() : s);
  const isFree = (p: string) => !fs.existsSync(p) || own.has(p);
  for (let n = 1; n < 10000; n++) {
    const extra = n === 1 ? '' : ` (${n})`;
    const base = cut(label, MAX_BASE_LENGTH - extra.length) + extra;
    if (suffixes.every((suffix) => isFree(path.join(dir, base + suffix)))) return base;
  }
  throw new Error(`Kein freier Dateiname für "${label}" in ${dir}.`);
}

export interface GroupDoc {
  id: number;
  title: string | null;
  doc_date: string | null;
  folder_id: number | null;
  pdf_path: string | null;
  original_path: string | null;
  original_name: string | null;
  created_at: string | null;
  deleted_at?: string | null;
  merged_into?: number | null;
  status?: string;
}

export interface GroupPlan {
  id: number;
  /** Neue Pfade (null = Mitglied existiert nicht) */
  pdf_path: string | null;
  original_path: string | null;
  /** Auszuführende Verschiebungen (Dateien und ggf. der Teile-Ordner) */
  moves: { from: string; to: string }[];
  /** Teile-Ordner umbenannt → Pfade der Teile in der DB mitziehen */
  prefixRewrite: { from: string; to: string } | null;
}

/** Belege in Arbeit nicht anfassen – die Pipeline legt sie am Ende selbst mit frischen Werten ab. */
export function isBusy(doc: { status?: string }): boolean {
  return doc.status === 'queued' || doc.status === 'processing';
}

/** Heimatordner der Gruppe: Teile-Ordner des Stapels, Papierkorb oder Archivordner. */
export function homeDirFor(doc: GroupDoc): string {
  if (doc.merged_into) {
    const parent = getDb().prepare('SELECT pdf_path FROM documents WHERE id = ?').get(doc.merged_into) as
      | { pdf_path: string | null }
      | undefined;
    if (parent?.pdf_path) return partsDirFor(parent.pdf_path);
  }
  if (doc.deleted_at) return trashDir();
  return archiveDirForFolder(doc.folder_id);
}

/**
 * Plant, wohin die Gruppe eines Belegs gehört (Ordner + kollisionsfreier Grundname).
 * - targetDir/label überschreiben Heimatordner bzw. "YYYY-MM-DD Titel" (z. B. "01 Titel" im Stapel).
 * - withNewPdf: es kommt gleich ein (neues) PDF dazu, sein Name wird mit reserviert.
 */
export function planGroup(
  doc: GroupDoc,
  opts: { targetDir?: string; label?: string; withNewPdf?: boolean } = {}
): GroupPlan {
  const targetDir = opts.targetDir ?? homeDirFor(doc);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const pdf = doc.pdf_path && fs.existsSync(doc.pdf_path) ? doc.pdf_path : null;
  const original = doc.original_path && fs.existsSync(doc.original_path) ? doc.original_path : null;
  const parts = pdf && fs.existsSync(partsDirFor(pdf)) ? partsDirFor(pdf) : null;
  const hasPdf = Boolean(pdf) || Boolean(opts.withNewPdf);

  const suffixes: string[] = [];
  if (hasPdf) suffixes.push('.pdf');
  if (original) suffixes.push(originalSuffix(original));
  if (parts) suffixes.push(PARTS_SUFFIX);

  const own = new Set([pdf, original, parts].filter(Boolean) as string[]);
  const base = reserveBase(targetDir, opts.label ?? groupLabel(doc), suffixes, own);

  const plan: GroupPlan = {
    id: doc.id,
    pdf_path: hasPdf ? path.join(targetDir, `${base}.pdf`) : null,
    original_path: original ? path.join(targetDir, base + originalSuffix(original)) : doc.original_path,
    moves: [],
    prefixRewrite: null,
  };
  if (pdf && plan.pdf_path !== pdf) plan.moves.push({ from: pdf, to: plan.pdf_path! });
  if (original && plan.original_path !== original) plan.moves.push({ from: original, to: plan.original_path! });
  if (parts) {
    const newParts = path.join(targetDir, base + PARTS_SUFFIX);
    if (newParts !== parts) {
      plan.moves.push({ from: parts, to: newParts });
      plan.prefixRewrite = { from: parts + path.sep, to: newParts + path.sep };
    }
  }
  return plan;
}

/** Führt die Verschiebungen aus; scheitert eine, werden die bereits erledigten zurückgenommen. */
export function executePlan(plan: GroupPlan): void {
  const done: { from: string; to: string }[] = [];
  try {
    for (const move of plan.moves) {
      fs.mkdirSync(path.dirname(move.to), { recursive: true });
      moveOrCopySync(move.from, move.to);
      done.push(move);
    }
  } catch (err) {
    revertMoves(done);
    throw err;
  }
}

/** Nimmt ausgeführte Verschiebungen in umgekehrter Reihenfolge zurück (bestmöglich). */
export function revertPlan(plan: GroupPlan): void {
  revertMoves(plan.moves);
}

function revertMoves(moves: { from: string; to: string }[]): void {
  for (const move of [...moves].reverse()) {
    try {
      if (fs.existsSync(move.to)) moveOrCopySync(move.to, move.from);
    } catch (err) {
      console.error(`[Dateien] Rücknahme ${move.to} → ${move.from} fehlgeschlagen:`, err);
    }
  }
}

/** Pfade aller Belege unter `from` auf `to` umschreiben (Teile-Ordner, umbenannte Archivordner). */
export function rewritePathPrefix(from: string, to: string): void {
  const db = getDb();
  for (const column of ['pdf_path', 'original_path']) {
    db.prepare(
      `UPDATE documents SET ${column} = ? || substr(${column}, ?) WHERE substr(${column}, 1, ?) = ?`
    ).run(to, from.length + 1, from.length, from);
  }
}

/** Neue Pfade aus dem Plan in die DB schreiben (innerhalb der Transaktion des Aufrufers). */
export function applyPlanToDb(plan: GroupPlan): void {
  getDb()
    .prepare('UPDATE documents SET pdf_path = ?, original_path = ? WHERE id = ?')
    .run(plan.pdf_path, plan.original_path, plan.id);
  if (plan.prefixRewrite) rewritePathPrefix(plan.prefixRewrite.from, plan.prefixRewrite.to);
}

function loadGroupDoc(id: number): (GroupDoc & { status: string }) | undefined {
  return getDb()
    .prepare(
      `SELECT id, title, doc_date, folder_id, pdf_path, original_path, original_name, created_at,
              deleted_at, merged_into, status
       FROM documents WHERE id = ?`
    )
    .get(id) as (GroupDoc & { status: string }) | undefined;
}

/**
 * Bringt die Dateigruppe eines Belegs in Einklang mit den aktuellen DB-Werten (Ordner, Titel,
 * Datum, Papierkorb). Belege in Arbeit werden übersprungen. Liefert den ausgeführten Plan.
 */
export function syncDocumentFiles(id: number, opts: { force?: boolean } = {}): GroupPlan | null {
  const doc = loadGroupDoc(id);
  if (!doc) return null;
  if (isBusy(doc) && !opts.force) return null;
  const plan = planGroup(doc);
  if (plan.moves.length === 0) return plan;
  executePlan(plan);
  try {
    getDb().transaction(() => applyPlanToDb(plan))();
  } catch (err) {
    revertPlan(plan);
    throw err;
  }
  return plan;
}

/** Alle Dateien der Gruppe entfernen (PDF, Original, leerer Teile-Ordner samt macOS-Resten). */
export function deleteGroupFiles(doc: { pdf_path: string | null; original_path: string | null }): void {
  const targets = [doc.pdf_path, doc.original_path].filter(Boolean) as string[];
  for (const file of targets) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.warn(`[Dateien] Konnte ${file} nicht löschen:`, err);
    }
  }
  if (doc.pdf_path) {
    const parts = partsDirFor(doc.pdf_path);
    try {
      if (fs.existsSync(parts)) fs.rmSync(parts, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[Dateien] Konnte Teile-Ordner ${parts} nicht löschen:`, err);
    }
  }
}

/**
 * Legt ein frisch erzeugtes PDF (Arbeitsdatei) als Teil der Gruppe ab: altes Archiv-PDF weg,
 * gemeinsamer Grundname für PDF + Original nach den AKTUELLEN DB-Werten (Titel/Datum/Ordner können
 * sich während der Verarbeitung geändert haben), Pfade sofort in die DB.
 */
export function placeNewPdf(id: number, workPdfPath: string): { pdfPath: string; originalPath: string | null } {
  const doc = loadGroupDoc(id);
  if (!doc) throw new Error(`Dokument ${id} nicht gefunden.`);

  if (doc.pdf_path && fs.existsSync(doc.pdf_path)) {
    try {
      fs.unlinkSync(doc.pdf_path);
    } catch (err) {
      console.warn(`[Dateien] Konnte altes PDF ${doc.pdf_path} nicht löschen:`, err);
    }
  }

  const plan = planGroup({ ...doc, pdf_path: null }, { withNewPdf: true });
  executePlan(plan);
  try {
    moveOrCopySync(workPdfPath, plan.pdf_path!);
  } catch (err) {
    revertPlan(plan);
    throw err;
  }
  try {
    getDb().transaction(() => applyPlanToDb(plan))();
  } catch (err) {
    moveOrCopySync(plan.pdf_path!, workPdfPath);
    revertPlan(plan);
    throw err;
  }
  return { pdfPath: plan.pdf_path!, originalPath: plan.original_path };
}
