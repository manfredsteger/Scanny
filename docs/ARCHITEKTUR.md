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

Entwickler müssen die folgenden 7 Regeln zwingend beachten:

1. **Dockerfile**: Im Builder-Stage immer `COPY package.json ./` verwenden (NICHT `package*.json`). Die lokale `package-lock.json` stammt von macOS und bricht native Rollup-/Binary-Pakete unter Linux (`npm/cli#4828`).
2. **PORT nie hartkodieren**: Immer `process.env.PORT` mit Fallback auslesen (`parseInt(process.env.PORT || '3000', 10)`).
3. **Kein Top-Level-Import von `vite` im Server-Code**: Vite darf im Server ausschließlich über `await import('vite')` dynamisch im Entwicklungsmodus eingebunden werden. Andernfalls schlägt der Start im schlanken Produktions-Container fehl, da `vite` dort in den `devDependencies` liegt.
4. **Keine Daten im Git**: Verzeichnisse `data/`, `scanny/`, `server/dist/`, `dist/` und `.env` dürfen niemals committet werden (siehe `.gitignore`).
5. **Vollständige Imports**: Jede neue Komponente, Funktion oder Schnittstelle muss explizit importiert werden. Vor Abschluss jeder Änderung müssen alle Imports und TypeScript-Builds validiert werden.
6. **Alles lokal**: Keine Cloud-Dienste, keine Cloud-KI (z. B. Gemini, OpenAI), keine externen Web-APIs mit Dokumenteninhalten und keine CDN-Abhängigkeiten zur Laufzeit. Private Steuerbelege bleiben zu 100% auf dem Rechner des Nutzers.
7. **Dateisystem zuerst, dann DB**: Bei Datei- und Ordneroperationen (Erstellen, Umbenennen, Verschieben, Löschen) wird immer zuerst die Dateisystem-Operation ausgeführt und validiert. Erst bei fehlerfreiem Erfolg wird der entsprechende Datenbank-Eintrag aktualisiert oder angelegt. Dateisystem-Fehler niemals verschlucken, sondern mit aussagekräftiger Meldung als HTTP-Fehlerstatus (409 oder 500) beantworten.
