import { describe, it, expect } from 'vitest';
import { collectDroppedFiles } from './dropFiles';

// Nachbau der Browser-Entry-API (FileSystemEntry) für Tests ohne DOM
function fileEntry(name: string): any {
  return { name, isFile: true, isDirectory: false, file: (ok: (f: any) => void) => ok({ name }) };
}

function dirEntry(name: string, children: any[], chunk = 100): any {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let pos = 0;
      return {
        readEntries: (ok: (e: any[]) => void) => {
          const part = children.slice(pos, pos + chunk);
          pos += part.length;
          ok(part);
        },
      };
    },
  };
}

function transfer(entries: any[]): any {
  return {
    files: entries.map((e) => ({ name: e.name })),
    items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e, getAsFile: () => null })),
  };
}

describe('collectDroppedFiles', () => {
  it('löst abgelegte Ordner rekursiv auf und überspringt versteckte Dateien', async () => {
    const dt = transfer([
      dirEntry('Belege', [
        fileEntry('b.pdf'),
        fileEntry('.DS_Store'),
        dirEntry('Unterordner', [fileEntry('c.pdf')]),
        fileEntry('a.pdf'),
      ]),
      fileEntry('einzeln.pdf'),
    ]);
    const files = await collectDroppedFiles(dt);
    expect(files.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf', 'einzeln.pdf']);
  });

  it('liest große Ordner vollständig, auch wenn readEntries in Blöcken liefert', async () => {
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`Beleg ${i + 1}.pdf`));
    const files = await collectDroppedFiles(transfer([dirEntry('Viele', many)]));
    expect(files).toHaveLength(250);
    expect(files[0].name).toBe('Beleg 1.pdf');
    expect(files[249].name).toBe('Beleg 250.pdf');
  });

  it('fällt auf dataTransfer.files zurück, wenn es keine Einträge gibt', async () => {
    const files = await collectDroppedFiles({ files: [{ name: 'x.pdf' }], items: [] } as any);
    expect(files.map((f) => f.name)).toEqual(['x.pdf']);
  });
});
