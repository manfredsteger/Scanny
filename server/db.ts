import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Basisverzeichnisse auflösen
const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || './data');
const scannyDir = path.resolve(process.cwd(), process.env.SCANNY_DIR || './scanny');
const watchDir = path.resolve(process.env.WATCH_DIR || path.join(scannyDir, 'Upload'));
const archiveDir = path.resolve(process.env.ARCHIVE_DIR || path.join(scannyDir, 'Archiv'));
const originalsDir = path.join(dataDir, 'originals');
const thumbsDir = path.join(dataDir, 'thumbs');
const tmpDir = path.join(dataDir, 'tmp');
const workDir = path.join(dataDir, 'work');
const dbPath = path.join(dataDir, 'scanny.db');

export const paths = {
  dataDir,
  scannyDir,
  watchDir,
  archiveDir,
  originalsDir,
  thumbsDir,
  tmpDir,
  workDir,
  dbPath,
};

// Verzeichnisse beim Import/Start anlegen, falls sie noch nicht existieren
export function ensureDirectories(): void {
  for (const dir of [dataDir, scannyDir, watchDir, archiveDir, originalsDir, thumbsDir, tmpDir, workDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// Ordnernamen für das Dateisystem säubern (keine Steuerzeichen, keine / \ : * ? " < > |)
export function sanitizeFolderName(rawName: string): string {
  return rawName
    .replace(/[\x00-\x1F\x7F]/g, '') // Steuerzeichen entfernen
    .replace(/[/\\:*?"<>|]/g, '_')   // Ungültige Dateisystemzeichen ersetzen
    .replace(/\s+/g, ' ')            // Mehrfache Leerzeichen normieren
    .trim();
}

// Validiert Ordnernamen nach strengen Regeln (Punkt, Unterstrich, Länge)
export function validateFolderName(rawName: unknown): { valid: boolean; error?: string; cleanName?: string } {
  if (!rawName || typeof rawName !== 'string' || rawName.trim().length === 0) {
    return { valid: false, error: 'Ordnername ist erforderlich.' };
  }

  const trimmed = rawName.trim();
  if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.') || trimmed.startsWith('_')) {
    return {
      valid: false,
      error: 'Ordnernamen dürfen nicht ".", ".." sein oder mit "." oder "_" beginnen (reserviert).',
    };
  }

  const cleanName = sanitizeFolderName(trimmed);
  if (cleanName.length === 0) {
    return { valid: false, error: 'Der Ordnername enthält nur ungültige Zeichen.' };
  }

  if (cleanName === '.' || cleanName === '..' || cleanName.startsWith('.') || cleanName.startsWith('_')) {
    return {
      valid: false,
      error: 'Ordnernamen dürfen nicht ".", ".." sein oder mit "." oder "_" beginnen (reserviert).',
    };
  }

  if (cleanName.length > 80) {
    return { valid: false, error: 'Der Ordnername darf maximal 80 Zeichen lang sein.' };
  }

  return { valid: true, cleanName };
}

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    ensureDirectories();
    dbInstance = new Database(dbPath);
    // Performance & Fremdschlüssel aktivieren
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');

    migrate(dbInstance);
  }
  return dbInstance;
}

function migrate(db: Database.Database): void {
  const versionRow = db.pragma('user_version', { simple: true }) as number;
  const currentVersion = typeof versionRow === 'number' ? versionRow : 0;

  if (currentVersion < 1) {
    // Migration 1: Basistabellen und FTS5-Suche in Transaktion ausführen
    const runMigration1 = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL CHECK(kind IN ('steuerjahr', 'jahr', 'frei')),
          year INTEGER NULL,
          color TEXT NULL,
          sort INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_folders_kind ON folders(kind);
        CREATE INDEX IF NOT EXISTS idx_folders_year ON folders(year);

        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'inbox', 'filed', 'error')),
          folder_id INTEGER NULL REFERENCES folders(id) ON DELETE SET NULL,
          title TEXT,
          doc_date TEXT NULL,
          amount_cents INTEGER NULL,
          sender TEXT NULL,
          doc_type TEXT NULL,
          user_edited TEXT NULL,
          original_name TEXT,
          original_path TEXT,
          pdf_path TEXT NULL,
          thumb_path TEXT NULL,
          page_count INTEGER DEFAULT 1,
          color_mode TEXT DEFAULT 'bw' CHECK(color_mode IN ('bw', 'gray', 'color')),
          corners TEXT NULL,
          rotation INTEGER DEFAULT 0,
          ocr_text TEXT NULL,
          error TEXT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
        CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
        CREATE INDEX IF NOT EXISTS idx_documents_doc_date ON documents(doc_date);

        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
          title,
          sender,
          ocr_text,
          content='documents',
          content_rowid='id'
        );

        -- FTS-Trigger zum synchronen Aktualisieren des Volltextindex
        CREATE TRIGGER IF NOT EXISTS trg_documents_ai AFTER INSERT ON documents BEGIN
          INSERT INTO documents_fts(rowid, title, sender, ocr_text)
          VALUES (new.id, new.title, new.sender, new.ocr_text);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_documents_ad AFTER DELETE ON documents BEGIN
          INSERT INTO documents_fts(documents_fts, rowid, title, sender, ocr_text)
          VALUES ('delete', old.id, old.title, old.sender, old.ocr_text);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_documents_au AFTER UPDATE ON documents BEGIN
          INSERT INTO documents_fts(documents_fts, rowid, title, sender, ocr_text)
          VALUES ('delete', old.id, old.title, old.sender, old.ocr_text);
          INSERT INTO documents_fts(rowid, title, sender, ocr_text)
          VALUES (new.id, new.title, new.sender, new.ocr_text);
        END;

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );

        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('app_version', '0.1.0');

        PRAGMA user_version = 1;
      `);
    });
    runMigration1();
  }

  if (currentVersion < 2) {
    // Migration 2: Transaktional ausführen
    const runMigration2 = db.transaction(() => {
      // 1. VOR dem CREATE UNIQUE INDEX doppelte (kind, year)-Einträge auflösen:
      // Je (kind, year) bleibt der älteste Ordner (kleinste id) erhalten, alle weiteren werden zu frei/NULL
      const duplicates = db.prepare(`
        SELECT id, name, kind, year
        FROM folders
        WHERE year IS NOT NULL
          AND kind IN ('steuerjahr', 'jahr')
          AND id NOT IN (
            SELECT MIN(id)
            FROM folders
            WHERE year IS NOT NULL
              AND kind IN ('steuerjahr', 'jahr')
            GROUP BY kind, year
          )
      `).all() as { id: number; name: string; kind: string; year: number }[];

      for (const dup of duplicates) {
        console.warn(
          `[Scanny Migration 2] Duplikat aufgelöst: Ordner "${dup.name}" (ID ${dup.id}, Typ "${dup.kind}", Jahr ${dup.year}) wird zu kind='frei', year=NULL umgestellt.`
        );
        db.prepare(`
          UPDATE folders
          SET kind = 'frei', year = NULL
          WHERE id = ?
        `).run(dup.id);
      }

      // 2. Unique-Index auf (kind, year) anlegen, Zeitstempel normalisieren, watch_polling entfernen
      db.exec(`
        -- Eindeutiger Index: Pro Jahr nur ein Steuerjahr und nur ein Jahr
        CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_kind_year_unique
        ON folders(kind, year) WHERE year IS NOT NULL;

        -- Vorhandene Zeitstempel in UTC ISO-8601 mit 'Z' normalisieren
        UPDATE folders
        SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', created_at)
        WHERE created_at NOT LIKE '%Z';

        UPDATE documents
        SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', created_at)
        WHERE created_at NOT LIKE '%Z';

        UPDATE documents
        SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', updated_at)
        WHERE updated_at NOT LIKE '%Z';

        -- watch_polling aus settings entfernen (Umgebungsvariable ist einzige Quelle)
        DELETE FROM settings WHERE key = 'watch_polling';

        PRAGMA user_version = 2;
      `);
    });
    runMigration2();
  }

  if (currentVersion < 3) {
    // Migration 3: source ('folder' | 'upload') und import_batch auf documents
    const runMigration3 = db.transaction(() => {
      const docTableInfo = db.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[];
      const colNames = new Set(docTableInfo.map((c) => c.name));

      if (!colNames.has('source')) {
        db.exec(`ALTER TABLE documents ADD COLUMN source TEXT DEFAULT 'upload';`);
      }
      if (!colNames.has('import_batch')) {
        db.exec(`ALTER TABLE documents ADD COLUMN import_batch TEXT NULL;`);
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_documents_import_batch ON documents(import_batch);
        CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
        PRAGMA user_version = 3;
      `);
    });
    runMigration3();
  }

  if (currentVersion < 4) {
    // Migration 4: file_date und sha256 für Dokumente, Index auf sha256, doc_type Normalisierung
    const runMigration4 = db.transaction(() => {
      const docTableInfo = db.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[];
      const colNames = new Set(docTableInfo.map((c) => c.name));

      if (!colNames.has('file_date')) {
        db.exec(`ALTER TABLE documents ADD COLUMN file_date TEXT NULL;`);
      }
      if (!colNames.has('sha256')) {
        db.exec(`ALTER TABLE documents ADD COLUMN sha256 TEXT NULL;`);
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256);

        -- Normalisierung alter doc_type Anzeigenamen auf standardisierte DB-Schlüssel
        UPDATE documents SET doc_type = 'rechnung' WHERE LOWER(doc_type) = 'rechnung';
        UPDATE documents SET doc_type = 'quittung' WHERE LOWER(doc_type) LIKE 'quittung%';
        UPDATE documents SET doc_type = 'kontoauszug' WHERE LOWER(doc_type) = 'kontoauszug';
        UPDATE documents SET doc_type = 'vertrag' WHERE LOWER(doc_type) = 'vertrag';
        UPDATE documents SET doc_type = 'bescheid' WHERE LOWER(doc_type) = 'bescheid';
        UPDATE documents SET doc_type = 'lohnabrechnung' WHERE LOWER(doc_type) = 'lohnabrechnung';
        UPDATE documents SET doc_type = 'spendenquittung' WHERE LOWER(doc_type) = 'spendenquittung';
        UPDATE documents SET doc_type = 'versicherung' WHERE LOWER(doc_type) = 'versicherung';
        UPDATE documents SET doc_type = 'brief' WHERE LOWER(doc_type) = 'brief';
        UPDATE documents SET doc_type = 'sonstiges' WHERE LOWER(doc_type) = 'sonstiges';

        PRAGMA user_version = 4;
      `);
    });
    runMigration4();
  }

  if (currentVersion < 5) {
    // Migration 5: detected Spalte für Dokumente, default_color_mode in settings
    const runMigration5 = db.transaction(() => {
      const docTableInfo = db.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[];
      const colNames = new Set(docTableInfo.map((c) => c.name));

      if (!colNames.has('detected')) {
        db.exec(`ALTER TABLE documents ADD COLUMN detected INTEGER DEFAULT 1;`);
      }

      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('default_color_mode', 'bw');
        PRAGMA user_version = 5;
      `);
    });
    runMigration5();
  }

  if (currentVersion < 6) {
    // Migration 6: Erkennungsergebnis (Typ/Datum/Betrag/Absender + Fundstellen) als JSON, auto_file-Einstellung
    const runMigration6 = db.transaction(() => {
      const docTableInfo = db.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[];
      const colNames = new Set(docTableInfo.map((c) => c.name));

      if (!colNames.has('extraction')) {
        db.exec(`ALTER TABLE documents ADD COLUMN extraction TEXT NULL;`);
      }

      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_file', 'false');
        PRAGMA user_version = 6;
      `);
    });
    runMigration6();
  }
}
