// Abgelegte Dateien UND Ordner einsammeln.
// dataTransfer.files enthält bei einem abgelegten Ordner nur den Ordner selbst als
// unlesbare "Datei" – fetch bricht dann mit "Failed to fetch" ab. Deshalb werden
// Ordner über die Entry-API rekursiv aufgelöst.

function isHidden(name: string): boolean {
  return name.startsWith('.');
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  // readEntries liefert in Blöcken (Chrome max. 100) – so lange lesen, bis nichts mehr kommt
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject)
    );
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

async function collectEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (isHidden(entry.name)) return;
  if (entry.isFile) {
    out.push(await readFile(entry as FileSystemFileEntry));
  } else if (entry.isDirectory) {
    const children = await readAllEntries(entry as FileSystemDirectoryEntry);
    children.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    for (const child of children) await collectEntry(child, out);
  }
}

// Muss SYNCHRON im drop-Handler aufgerufen werden (vor dem ersten await),
// danach sind dataTransfer.items nicht mehr lesbar.
export function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  const fallback: File[] = [];
  for (const item of Array.from(dt.items || [])) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) fallback.push(f);
    }
  }
  if (entries.length === 0 && fallback.length === 0) {
    return Promise.resolve(Array.from(dt.files || []));
  }
  return (async () => {
    const out: File[] = [...fallback];
    for (const entry of entries) await collectEntry(entry, out);
    return out;
  })();
}
