# Scanny - Architektur & Entwicklungsrichtlinien

Scanny ist eine leichtgewichtige, selbst gehostete Web-Applikation für das Home Office zur Erfassung, Aufbereitung und Archivierung von Belegen (Rechnungen, Quittungen, Steuerunterlagen).

Scanny ist bewusst **kein** schwerfälliger Paperless-Klon: Entwickelt für eine einzelne Person, ohne Benutzeranmeldung, ohne Cloud-Abhängigkeiten und vollständig lokal in Docker auf macOS bzw. Linux lauffähig.

---

## 1. Technischer Stack

- **Frontend**: Vite, React 19, TypeScript, Tailwind CSS, `lucide-react` Icons.
- **Backend**: Node 22, Express, TypeScript – läuft im **selben Prozess** wie das Frontend.
  - In Produktion liefert Express das gebaute Frontend aus `/dist` aus und beantwortet `/api/*`.
  - In der Entwicklung wird Vite als Middleware per dynamischem `import('vite')` eingebunden.
- **Datenbank**: SQLite via `better-sqlite3`, gespeichert unter `$DATA_DIR/scanny.db`.
  - WAL-Modus (`PRAGMA journal_mode = WAL`) und Fremdschlüssel aktiviert.
  - Schema-Migrationen per `PRAGMA user_version`.
  - Volltextsuche über SQLite FTS5 (`documents_fts`).
- **Bildbearbeitung** *(späterer Schritt)*: Python 3 + OpenCV (`python3-opencv`), aufgerufen per `child_process` vom Node-Server.
- **OCR** *(späterer Schritt)*: `ocrmypdf` + `tesseract` (deu + eng), aufgerufen per `child_process`.
- **UI-Sprache**: Ausschließlich Deutsch, ohne i18n-Framework.

---

## 2. Projekt- und Ordnerstruktur

```text
/
├── index.html              # Vite Entry-Point
├── src/                    # React Frontend
│   ├── components/         # Modulare React-Komponenten (Sidebar, Modals, Views)
│   ├── types.ts            # Geteilte TypeScript-Typen & Farbdefinitionen
│   ├── App.tsx             # Hauptanwendungskomponente
│   ├── main.tsx            # React DOM Bootstrapper
│   └── index.css           # Tailwind CSS Direktiven
├── server/                 # Express Backend
│   ├── index.ts            # Server-Einstiegspunkt (Express + Vite/Static)
│   ├── db.ts               # SQLite-Setup, Pfadauflösung & Migrationen
│   ├── routes/             # API-Routen (folders.ts, health.ts, settings.ts)
│   └── pipeline/           # Pipeline-Skripte (Watcher, Queue, OpenCV/OCR)
├── docs/
│   └── ARCHITEKTUR.md      # Diese Dokumentation
├── data/                   # [Nicht im Git] SQLite-DB, Originale, Thumbnails
├── scanny/                 # [Nicht im Git] Sichtbare Benutzer-Ordner
│   ├── Upload/             # Überwachter Eingangsordner (WATCH_DIR)
│   └── Archiv/             # Sortierte DIN A4-PDFs (ARCHIVE_DIR)
├── Dockerfile              # Multi-Stage Dockerfile (node:22-bookworm-slim)
├── docker-compose.yml      # Docker Compose Konfiguration
├── Makefile                # Komfortable CLI-Befehle (setup, dev, prod, logs)
└── package.json            # Abhängigkeiten und Build-Skripte
```

---

## 3. Umgebungsvariablen

Alle Pfade werden über `process.cwd()`-relative Defaults aufgelöst und beim Serverstart automatisch angelegt:

| Variable | Standardwert | Beschreibung |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port des Express-Servers (niemals hartkodiert) |
| `DATA_DIR` | `./data` | Internes Verzeichnis für `scanny.db`, Originale und Cache |
| `SCANNY_DIR` | `./scanny` | Basisordner für den Benutzer auf dem Rechner |
| `WATCH_DIR` | `$SCANNY_DIR/Upload` | Überwachter Ordner für neue Belege (Eingang) |
| `ARCHIVE_DIR` | `$SCANNY_DIR/Archiv` | Fertige, im Finder lesbare PDF-Archive |
| `SCANNY_PATH` | – | Host-Pfad für Docker-Mount auf macOS (in `.env`) |
| `WATCH_POLLING` | `true` | Polling-Fallback für Dateisystem-Events über Bind-Mounts |

---

## 4. Wichtige Regeln ("Nicht verändern")

Entwickler müssen die folgenden 8 Regeln zwingend beachten:

1. **Dockerfile**: Im Builder-Stage immer `COPY package.json ./` verwenden (NICHT `package*.json`). Die lokale `package-lock.json` stammt von macOS und bricht native Rollup-/Binary-Pakete unter Linux (`npm/cli#4828`).
2. **PORT nie hartkodieren**: Immer `process.env.PORT` mit Fallback auslesen (`parseInt(process.env.PORT || '3000', 10)`).
3. **Kein Top-Level-Import von `vite` im Server-Code**: Vite darf im Server ausschließlich über `await import('vite')` dynamisch im Entwicklungsmodus eingebunden werden. Andernfalls schlägt der Start im schlanken Produktions-Container fehl, da `vite` dort in den `devDependencies` liegt.
4. **Keine Daten im Git**: Verzeichnisse `data/`, `scanny/`, `server/dist/`, `dist/` und `.env` dürfen niemals committet werden (siehe `.gitignore`).
5. **Vollständige Imports**: Jede neue Komponente, Funktion oder Schnittstelle muss explizit importiert werden. Vor Abschluss jeder Änderung müssen alle Imports und TypeScript-Builds validiert werden.
6. **Alles lokal**: Keine Cloud-Dienste, keine Cloud-KI (z. B. Gemini, OpenAI), keine externen Web-APIs mit Dokumenteninhalten und keine CDN-Abhängigkeiten zur Laufzeit. Private Steuerbelege bleiben zu 100% auf dem Rechner des Nutzers.
7. **Dateisystem zuerst, dann DB**: Bei Datei- und Ordneroperationen (Erstellen, Umbenennen, Verschieben, Löschen) wird immer zuerst die Dateisystem-Operation ausgeführt und validiert. Erst bei fehlerfreiem Erfolg wird der entsprechende Datenbank-Eintrag aktualisiert oder angelegt. Dateisystem-Fehler niemals verschlucken, sondern mit aussagekräftiger Meldung als HTTP-Fehlerstatus (409 oder 500) beantworten.
8. **Dokumentenecken (corners) und Drehung**: Die gespeicherten Ecken (`corners`) beziehen sich IMMER auf das bereits gedrehte Arbeitsbild (nach Anwendung von `rotation`). Ändert sich die Drehung (`rotation`), werden gespeicherte `corners` in der Datenbank zurückgesetzt (`NULL`, automatische Neuerkennung), sofern nicht explizit neue Ecken im selben Aufruf übergeben werden.

---

## 5. Erkennung, Ablage & Suche (Schritt 5)

- **Erkennung** läuft nach der OCR in `processDocument.ts` (`applyDetection`), rein regelbasiert:
  - `server/pipeline/classifyRules.ts` – Stichwörter + Gewichte je Dokumenttyp (hier erweitern).
  - `server/pipeline/classify.ts` – Punktwertung, OCR-tolerant, Sicherheit + Zweitvorschlag.
  - `server/pipeline/extract.ts` – Datum, Betrag, Absender inkl. Fundstellen (`span`) im OCR-Text.
  - `server/pipeline/title.ts` – Titel-Vorschlag; wird **auch vom Frontend** importiert (keine Imports darin).
  - Ergebnis als JSON in `documents.extraction`. Gesetzt werden nur Felder, die **nicht** in `user_edited` stehen.
- **Archiv-PDF**: Ziel = `Archiv/<Ordner>/` bzw. `Archiv/_Eingang/`, Name `YYYY-MM-DD Titel.pdf`.
  `planArchivePdf()` berechnet das Ziel, `syncArchivePdf(id)` gleicht nach DB-Werten ab.
  PATCH verschiebt **zuerst** die Datei und schreibt erst danach die DB (Regel 7).
- **Ablegen**: `POST /api/documents/:id/file`, `/unfile` und `/file-bulk` sind dünne Hüllen um `patchDocument()`
  – es gibt nur eine Stelle, die Ordner, Status und Archiv-PDF ändert.
- **Automatisch ablegen**: Einstellung `auto_file` (Standard aus); nur bei sicher erkanntem Datum und passendem
  Steuerjahr-/Jahr-Ordner.
- **Suche**: `GET /api/search` (FTS5, bm25, `snippet()` mit Steuerzeichen `\u0001…\u0002` als Markierung).
  Nutzereingaben immer über `buildFtsQuery()` (`server/search.ts`) escapen.
- **Tests**: `npm test` (vitest) – `server/**/*.test.ts`, vom Server-Build ausgeschlossen.

---

## 6. Nachbearbeitung (Schritt 6)

- **Ecken-Editor** (`src/components/CornerEditor.tsx`), geöffnet über „Zuschnitt anpassen“ im Detail-Drawer:
  SVG-Overlay über `GET /api/documents/:id/work-preview`, 4 Griffe (Pointer Events, Maus + Touch),
  Lupe mit 2-facher Vergrößerung beim Ziehen, „Automatisch erkennen“, „Ganzes Bild“, Drehen, Farbmodus.
  Das SVG nutzt `viewBox` in Bildkoordinaten – damit stimmen Vorschau- und Originalmaße immer überein.
- **Koordinatensystem**: Ecken und Vorschau beziehen sich auf das **gedrehte** Arbeitsbild (Regel 8).
  `work-preview` liefert deshalb gedreht aus; `?rotation=` überschreibt die gespeicherte Drehung
  (Vorschau im Editor, bevor gespeichert wird).
- **Arbeitsbild**: `DATA_DIR/work/<id>.jpg` (EXIF-korrigiert) bleibt als Cache liegen und wird von
  `ensureWorkImage(id)` bei Bedarf aus dem Original neu erzeugt (HEIC über `heif-convert`).
- **Endpunkte**: `GET /api/documents/:id/work-meta` (Maße im Ecken-Koordinatensystem, gespeicherte Ecken),
  `POST /api/documents/:id/detect` (scan.py `--detect-only`, optional mit abweichender Drehung),
  `POST /api/documents/:id/reprocess` `{ corners?, rotation?, color_mode? }` – prüft die Werte und
  läuft über `patchDocument()`; PDFs werden mit 409 abgelehnt.
- **Erneutes Verarbeiten** füllt bei der Erkennung nur noch **leere** Felder (`applyDetection`, `isRerun`),
  damit geprüfte Werte erhalten bleiben. Ordner und Ablageort bleiben unverändert, das PDF wird ersetzt.
- Die Schnellaktionen (Drehen, Farbmodus) in Drawer und Import-Dialog nutzen denselben `/reprocess`-Endpunkt.

---

## 7. Mehrseitige Dokumente & Papierkorb (Schritt 7)

### Zusammenfügen

- **Auslöser**: Mehrfachauswahl im Eingang → „Zu einem Dokument zusammenfügen“ öffnet
  `src/components/MergeDialog.tsx` (Reihenfolge per Drag & Drop, zusätzlich Pfeiltasten für
  Tastatur und Touch; Standardreihenfolge = Erfassungszeit aufsteigend).
- **`POST /api/documents/merge { ids }`** (`server/pipeline/merge.ts`): PDFs werden mit `pdf-lib`
  in dieser Reihenfolge verbunden, OCR-Texte mit `----- Seite N -----` getrennt aneinandergehängt.
  Titel, Datum, Betrag, Absender, Typ und **Ordner** kommen vom ERSTEN Beleg, das Vorschaubild
  ebenfalls (Kopie). Das Ergebnis ist ein **neues** Dokument ohne `original_path` – es kann daher
  nicht neu aufbereitet werden (`/reprocess`, `/detect` antworten mit 409).
- **Reihenfolge der Schritte** (Regel 7): PDF im Speicher bauen → Quellen in den Papierkorb legen
  (erst dadurch wird der Dateiname im Archiv frei) → neues PDF schreiben → DB-Eintrag samt
  `document_pages` anlegen. Schlägt ein späterer Schritt fehl, werden die Quellen wiederhergestellt
  und das neue PDF gelöscht.
- **`document_pages(document_id, page_no, source_document_id)`**: `page_no` zählt die
  **Quelldokumente**, nicht die PDF-Seiten (ein Quelldokument kann mehrere Seiten haben).
  `source_document_id` wird bei endgültigem Löschen der Quelle auf NULL gesetzt
  (`ON DELETE SET NULL`) – das zusammengefügte Dokument bleibt intakt, diese Seite lässt sich dann
  aber nicht mehr trennen.
- **`POST /api/documents/:id/split`**: holt die Quellen aus dem Papierkorb zurück und verwirft
  das zusammengefügte Dokument endgültig. Erst wenn mindestens eine Quelle zurück ist, wird
  gelöscht.
- **`POST /api/documents/:id/add-page { source_id }`** („Seite hinzufügen“ im Detail-Drawer)
  ist bewusst ein `merge([id, source_id])`: Nur so gibt es für **beide** Teile einen Eintrag in
  `document_pages` und „Seiten wieder trennen“ funktioniert auch hier. Das Dokument bekommt dadurch
  eine neue ID, behält aber Titel, Datum und Ablageort – der Drawer springt auf das neue Dokument.

### Papierkorb

- **`documents.deleted_at`** (Migration 7). `DELETE /api/documents/:id` setzt nur noch diese Spalte
  und verschiebt das PDF nach `ARCHIVE_DIR/_Papierkorb/`; Original, Vorschaubild und Arbeitsdateien
  bleiben liegen, damit Wiederherstellen möglich ist.
- **`POST /api/documents/:id/restore`** verschiebt das PDF zurück nach `Archiv/<Ordner>/` bzw.
  `_Eingang/` und leitet den Status wieder aus dem Ordner ab (Fehler-Belege bleiben `error`).
- **`DELETE /api/documents/:id/purge`** löscht endgültig: Original, PDF, Vorschaubild,
  Arbeitsdateien und den DB-Eintrag.
- **Automatisch** nach `TRASH_RETENTION_DAYS` (30) Tagen: `startTrashCleanup()` läuft beim
  Serverstart und danach täglich (`server/index.ts`).
- **Gelöschte Belege sind überall unsichtbar**: `GET /api/documents` (außer mit `?deleted=1`),
  `/api/stats` (dort als eigener Zähler `trash`), `/api/search`, die Duplikatserkennung, die
  Dokumentzähler der Ordner und `initQueue()` filtern auf `deleted_at IS NULL`.
  `patchDocument()` lehnt Änderungen an Belegen im Papierkorb mit 409 ab.
- Der Ordnername `_Papierkorb` kollidiert nicht mit Benutzerordnern: `validateFolderName()`
  verbietet führende Unterstriche.
- **Tests**: `server/pipeline/trash.test.ts` deckt Papierkorb-Lebenszyklus, 30-Tage-Aufräumen,
  Zusammenfügen und Trennen gegen eine echte SQLite-DB mit echten PDFs ab.
