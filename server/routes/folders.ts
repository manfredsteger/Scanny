import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, paths, validateFolderName } from '../db.js';

export const foldersRouter = Router();

interface FolderRow {
  id: number;
  name: string;
  kind: 'steuerjahr' | 'jahr' | 'frei';
  year: number | null;
  color: string | null;
  sort: number;
  created_at: string;
  document_count: number;
}

// Hilfsfunktion: Jahr strikt validieren (ganze Zahl zwischen 1900 und 2100)
function parseAndValidateYear(rawYear: unknown): { valid: boolean; year: number | null; error?: string } {
  if (rawYear === null || rawYear === undefined || rawYear === '') {
    return { valid: false, year: null, error: 'Bitte ein gültiges Jahr (1900–2100) angeben.' };
  }
  let num: number;
  if (typeof rawYear === 'number') {
    num = rawYear;
  } else if (typeof rawYear === 'string') {
    const trimmed = rawYear.trim();
    if (!/^\d+$/.test(trimmed)) {
      return { valid: false, year: null, error: 'Bitte ein gültiges Jahr (1900–2100) angeben.' };
    }
    num = Number(trimmed);
  } else {
    return { valid: false, year: null, error: 'Bitte ein gültiges Jahr (1900–2100) angeben.' };
  }

  if (!Number.isInteger(num) || num < 1900 || num > 2100) {
    return { valid: false, year: null, error: 'Bitte ein gültiges Jahr (1900–2100) angeben.' };
  }

  return { valid: true, year: num };
}

// GET /api/folders -> Alle Ordner inkl. Anzahl Dokumente
foldersRouter.get('/folders', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const query = `
      SELECT 
        f.id, 
        f.name, 
        f.kind, 
        f.year, 
        f.color, 
        f.sort, 
        f.created_at,
        COUNT(d.id) AS document_count
      FROM folders f
      LEFT JOIN documents d ON d.folder_id = f.id AND d.status = 'filed'
      GROUP BY f.id
      ORDER BY 
        CASE f.kind
          WHEN 'steuerjahr' THEN 1
          WHEN 'jahr' THEN 2
          ELSE 3
        END ASC,
        f.year DESC,
        f.sort ASC,
        f.name ASC
    `;
    const rows = db.prepare(query).all() as FolderRow[];
    res.json(rows);
  } catch (error) {
    console.error('Fehler beim Abrufen der Ordner:', error);
    res.status(500).json({ error: 'Ordner konnten nicht geladen werden.' });
  }
});

// POST /api/folders -> Neuen Ordner anlegen
foldersRouter.post('/folders', (req: Request, res: Response) => {
  try {
    const { name, kind, year, color } = req.body;

    // 1. Validierung des Namens
    const nameCheck = validateFolderName(name);
    if (!nameCheck.valid || !nameCheck.cleanName) {
      return res.status(400).json({ error: nameCheck.error || 'Ungültiger Ordnername.' });
    }
    const cleanName = nameCheck.cleanName;

    // 2. Validierung des Typs
    if (!['steuerjahr', 'jahr', 'frei'].includes(kind)) {
      return res.status(400).json({ error: 'Ungültiger Ordnertyp (steuerjahr, jahr oder frei).' });
    }

    // 3. Validierung des Jahres bei steuerjahr und jahr
    let parsedYear: number | null = null;
    if (kind === 'steuerjahr' || kind === 'jahr') {
      const yearCheck = parseAndValidateYear(year);
      if (!yearCheck.valid || yearCheck.year === null) {
        return res.status(400).json({ error: yearCheck.error || 'Bitte ein gültiges Jahr (1900–2100) angeben.' });
      }
      parsedYear = yearCheck.year;
    }

    const db = getDb();

    // 4. Prüfung auf Namens-Eindeutigkeit (409 bei Konflikt)
    const existingName = db.prepare('SELECT id, name FROM folders WHERE LOWER(name) = LOWER(?)').get(cleanName) as FolderRow | undefined;
    if (existingName) {
      return res.status(409).json({ error: `Ein Ordner mit dem Namen "${cleanName}" existiert bereits.` });
    }

    // 5. Prüfung: Pro Jahr nur EIN Steuerjahr-Ordner und nur EIN Jahr-Ordner (409 bei Konflikt)
    if ((kind === 'steuerjahr' || kind === 'jahr') && parsedYear !== null) {
      const existingKindYear = db
        .prepare('SELECT id, name, kind, year FROM folders WHERE kind = ? AND year = ?')
        .get(kind, parsedYear) as FolderRow | undefined;
      if (existingKindYear) {
        const kindLabel = kind === 'steuerjahr' ? 'Steuerjahr-Ordner' : 'Jahr-Ordner';
        return res.status(409).json({
          error: `Für ${parsedYear} gibt es schon den ${kindLabel} »${existingKindYear.name}«.`,
        });
      }
    }

    // 6. Verzeichnis im Dateisystem unter ARCHIVE_DIR anlegen (Dateisystem zuerst)
    const archiveFolderPath = path.join(paths.archiveDir, cleanName);
    try {
      if (!fs.existsSync(archiveFolderPath)) {
        fs.mkdirSync(archiveFolderPath, { recursive: true });
      }
    } catch (fsErr: any) {
      console.error('Fehler beim Erstellen des Verzeichnisses im Dateisystem:', fsErr);
      return res.status(500).json({
        error: `Archivordner konnte im Dateisystem nicht erstellt werden: ${fsErr?.message || fsErr}`,
      });
    }

    // 7. In Datenbank speichern
    const stmt = db.prepare(`
      INSERT INTO folders (name, kind, year, color, sort)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      cleanName,
      kind,
      parsedYear,
      color && typeof color === 'string' ? color.trim() : null,
      0
    );

    // 8. Frisch gespeicherten Datensatz inkl. echtem SQLite-Zeitstempel aus der DB abfragen
    const newFolder = db.prepare(`
      SELECT 
        f.id, 
        f.name, 
        f.kind, 
        f.year, 
        f.color, 
        f.sort, 
        f.created_at,
        0 AS document_count
      FROM folders f
      WHERE f.id = ?
    `).get(result.lastInsertRowid) as FolderRow;

    res.status(201).json(newFolder);
  } catch (error: any) {
    console.error('Fehler beim Anlegen des Ordners:', error);
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ein Ordner mit diesem Namen oder Jahr existiert bereits.' });
    }
    res.status(500).json({ error: 'Ordner konnte nicht angelegt werden.' });
  }
});

// PUT /api/folders/:id -> Ordner bearbeiten / umbenennen (echte Teil-Aktualisierung)
foldersRouter.put('/folders/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Ordner-ID.' });
    }

    const { name, kind, year, color } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Ordner nicht gefunden.' });
    }

    // 1. Name prüfen (falls übergeben, sonst bestehenden Namen behalten)
    let finalName = existing.name;
    if (name !== undefined) {
      const nameCheck = validateFolderName(name);
      if (!nameCheck.valid || !nameCheck.cleanName) {
        return res.status(400).json({ error: nameCheck.error || 'Ungültiger Ordnername.' });
      }
      finalName = nameCheck.cleanName;

      // Prüfen ob anderer Ordner bereits so heißt (409)
      const duplicateName = db
        .prepare('SELECT id FROM folders WHERE LOWER(name) = LOWER(?) AND id != ?')
        .get(finalName, id);
      if (duplicateName) {
        return res.status(409).json({ error: `Ein Ordner mit dem Namen "${finalName}" existiert bereits.` });
      }
    }

    // 2. Kind prüfen (falls übergeben, sonst behalten)
    let finalKind = existing.kind;
    if (kind !== undefined) {
      if (!['steuerjahr', 'jahr', 'frei'].includes(kind)) {
        return res.status(400).json({ error: 'Ungültiger Ordnertyp (steuerjahr, jahr oder frei).' });
      }
      finalKind = kind;
    }

    // 3. Jahr prüfen (Teil-Aktualisierung: wenn nicht übergeben, bisherigen Wert behalten)
    let finalYear = existing.year;
    if (finalKind === 'frei') {
      finalYear = null;
    } else {
      // finalKind ist steuerjahr oder jahr
      if (year !== undefined) {
        const yearCheck = parseAndValidateYear(year);
        if (!yearCheck.valid || yearCheck.year === null) {
          return res.status(400).json({ error: yearCheck.error || 'Bitte ein gültiges Jahr (1900–2100) angeben.' });
        }
        finalYear = yearCheck.year;
      } else {
        // year wurde nicht übergeben: altes Jahr muss gültig sein
        if (!finalYear) {
          return res.status(400).json({ error: 'Bitte ein gültiges Jahr (1900–2100) angeben.' });
        }
      }

      // Eindeutigkeit prüfen: (kind, year) pro Jahr nur einmal (409)
      const kindConflict = db
        .prepare('SELECT id, name, kind, year FROM folders WHERE kind = ? AND year = ? AND id != ?')
        .get(finalKind, finalYear, id) as FolderRow | undefined;
      if (kindConflict) {
        const kindLabel = finalKind === 'steuerjahr' ? 'Steuerjahr-Ordner' : 'Jahr-Ordner';
        return res.status(409).json({
          error: `Für ${finalYear} gibt es schon den ${kindLabel} »${kindConflict.name}«.`,
        });
      }
    }

    // 4. Farbe (falls übergeben)
    const finalColor = color !== undefined ? (typeof color === 'string' ? color.trim() : null) : existing.color;

    // 5. DATEISYSTEM ZUERST: Verzeichnis im Dateisystem umbenennen
    if (finalName !== existing.name) {
      const oldPath = path.join(paths.archiveDir, existing.name);
      const newPath = path.join(paths.archiveDir, finalName);
      const isCaseOnlyChange = existing.name.toLowerCase() === finalName.toLowerCase();

      // Existiert das Zielverzeichnis schon (und ist es nicht derselbe Ordner) -> 409
      if (!isCaseOnlyChange && fs.existsSync(newPath)) {
        return res.status(409).json({
          error: `Das Archivverzeichnis "${finalName}" existiert bereits im Dateisystem.`,
        });
      }

      if (fs.existsSync(oldPath)) {
        if (isCaseOnlyChange) {
          // Reine Groß-/Kleinschreibungs-Änderung über temporären Zwischennamen umbenennen
          // (macOS-Dateisystem ist per Default case-insensitive!)
          const tempPath = path.join(paths.archiveDir, `__temp_${Date.now()}_${finalName}`);
          try {
            fs.renameSync(oldPath, tempPath);
          } catch (fsErr: any) {
            console.error('Fehler beim ersten Umbenennen auf temporären Zwischennamen:', fsErr);
            return res.status(500).json({
              error: `Verzeichnis im Dateisystem konnte nicht umbenannt werden: ${fsErr?.message || fsErr}`,
            });
          }

          try {
            fs.renameSync(tempPath, newPath);
          } catch (fsErr: any) {
            console.error('Fehler beim zweiten Umbenennen auf Zielnamen - mache ersten Schritt rückgängig:', fsErr);
            try {
              if (fs.existsSync(tempPath) && !fs.existsSync(oldPath)) {
                fs.renameSync(tempPath, oldPath);
              }
            } catch (rollbackErr) {
              console.error('Rollback des temporären Zwischennamens fehlgeschlagen:', rollbackErr);
            }
            return res.status(500).json({
              error: `Verzeichnis im Dateisystem konnte nicht umbenannt werden: ${fsErr?.message || fsErr}`,
            });
          }
        } else {
          try {
            fs.renameSync(oldPath, newPath);
          } catch (fsErr: any) {
            console.error('Fehler beim Umbenennen des Archivordners im Dateisystem:', fsErr);
            return res.status(500).json({
              error: `Verzeichnis im Dateisystem konnte nicht umbenannt werden: ${fsErr?.message || fsErr}`,
            });
          }
        }
      } else {
        // Fehlt das alte Verzeichnis, einfach das neue anlegen
        try {
          if (!fs.existsSync(newPath)) {
            fs.mkdirSync(newPath, { recursive: true });
          }
        } catch (fsErr: any) {
          console.error('Fehler beim Anlegen des neuen Archivverzeichnisses:', fsErr);
          return res.status(500).json({
            error: `Archivverzeichnis konnte im Dateisystem nicht angelegt werden: ${fsErr?.message || fsErr}`,
          });
        }
      }
    }

    // 6. DB erst nach fehlerfreiem Dateisystem-Schritt aktualisieren
    db.prepare(`
      UPDATE folders
      SET name = ?, kind = ?, year = ?, color = ?
      WHERE id = ?
    `).run(finalName, finalKind, finalYear, finalColor, id);

    // Zählung der abgelegten Dokumente abrufen
    const docCountRow = db
      .prepare("SELECT COUNT(*) as count FROM documents WHERE folder_id = ? AND status = 'filed'")
      .get(id) as { count: number };

    const updatedFolder: FolderRow = {
      id,
      name: finalName,
      kind: finalKind,
      year: finalYear,
      color: finalColor,
      sort: existing.sort,
      created_at: existing.created_at,
      document_count: docCountRow?.count || 0,
    };

    res.json(updatedFolder);
  } catch (error: any) {
    console.error('Fehler beim Aktualisieren des Ordners:', error);
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ein Ordner mit diesem Namen oder Jahr existiert bereits.' });
    }
    res.status(500).json({ error: 'Ordner konnte nicht aktualisiert werden.' });
  }
});

// DELETE /api/folders/:id -> Ordner löschen (nur wenn leer!)
foldersRouter.delete('/folders/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Ungültige Ordner-ID.' });
    }

    const db = getDb();
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined;
    if (!folder) {
      return res.status(404).json({ error: 'Ordner nicht gefunden.' });
    }

    // Prüfen, ob noch Dokumente im Ordner liegen
    const docCountRow = db
      .prepare('SELECT COUNT(*) as count FROM documents WHERE folder_id = ?')
      .get(id) as { count: number };

    if (docCountRow && docCountRow.count > 0) {
      return res.status(409).json({
        error: `Ordner "${folder.name}" enthält noch ${docCountRow.count} Dokument(e) und kann nicht gelöscht werden.`,
      });
    }

    // Dateisystem zuerst: Physikalisches Archiv-Verzeichnis entfernen, falls es existiert
    const folderPath = path.join(paths.archiveDir, folder.name);
    if (fs.existsSync(folderPath)) {
      try {
        const allEntries = fs.readdirSync(folderPath);

        // macOS-Systemdateien (.DS_Store und alle Dateien mit "._") ignorieren
        const isMacJunk = (name: string) => name === '.DS_Store' || name.startsWith('._');
        const userEntries = allEntries.filter((entry) => !isMacJunk(entry));

        // Nur ANDERE Dateien führen zu 409
        if (userEntries.length > 0) {
          return res.status(409).json({
            error: `Das Verzeichnis "${folder.name}" im Archiv enthält noch Dateien und kann nicht gelöscht werden.`,
          });
        }

        // Gefundene macOS-Systemdateien vor dem rmdir löschen
        const junkEntries = allEntries.filter(isMacJunk);
        for (const junk of junkEntries) {
          try {
            fs.unlinkSync(path.join(folderPath, junk));
          } catch (unlinkErr) {
            console.warn(`Konnte macOS-Datei ${junk} nicht löschen:`, unlinkErr);
          }
        }

        fs.rmdirSync(folderPath);
      } catch (fsErr: any) {
        console.error('Fehler beim Löschen des Archivordners im Dateisystem:', fsErr);
        return res.status(500).json({
          error: `Archivverzeichnis konnte nicht vom Dateisystem entfernt werden: ${fsErr?.message || fsErr}`,
        });
      }
    }

    // Erst bei Erfolg die DB bereinigen
    db.prepare('DELETE FROM folders WHERE id = ?').run(id);

    res.json({ ok: true, message: `Ordner "${folder.name}" wurde gelöscht.` });
  } catch (error: any) {
    console.error('Fehler beim Löschen des Ordners:', error);
    res.status(500).json({ error: 'Ordner konnte nicht gelöscht werden.' });
  }
});
