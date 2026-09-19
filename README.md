# Scanny 📄✨

**Scanny** ist eine schlanke, selbst gehostete Web-Anwendung für das Home Office zur automatischen Erfassung, Entzerrung, OCR-Verarbeitung und geordneten Ablage von Belegen (Rechnungen, Quittungen, Steuerdokumente).

Entwickelt für eine Person, ohne Login, ohne Cloud-Dienste und vollständig lokal in Docker auf dem Mac lauffähig.

---

## Schnellstart mit Docker

### 1. Einrichtung (`make setup`)

```bash
make setup
```

Der Befehl führt folgende Schritte automatisch aus:
1. Erstellt `.env` aus `.env.example` (falls noch nicht vorhanden).
2. Baut das schlanke Multi-Stage Docker-Image.
3. Startet Scanny im Hintergrund auf Port **3004** (`http://localhost:3004`).

*Tipp:* Passe in der erzeugten `.env` den Pfad `SCANNY_PATH` an deinen gewünschten Dokumentenordner an (z. B. `/Users/max/Documents/Scanny`).

---

## Wichtige Makefile-Befehle

| Befehl | Beschreibung |
| :--- | :--- |
| `make setup` | Ersteinrichtung & Start (`http://localhost:3004`) |
| `make prod` | Produktions-Container neu bauen und starten |
| `make dev` | Lokalen Entwicklungsserver auf Port 3005 starten (`PORT=3005 npm run dev`) |
| `make logs` | Live-Logs des Scanny-Containers ansehen |
| `make stop` | Container stoppen |
| `make restart` | Container neu starten |
| `make shell` | Bash-Shell im laufenden Container öffnen |

---

## Umgebungsvariablen

Konfigurierbar über die Datei `.env`:

```env
# Host-Pfad auf deinem Mac für Eingangs- und Archivordner
SCANNY_PATH=/Users/DEINNAME/Documents/Scanny

# Dateisystem-Polling für Docker auf macOS aktivieren
WATCH_POLLING=true
```

---

## Architektur & Regeln

Details zur Architektur, dem SQLite-Datenmodell und verbindlichen Entwicklerregeln findest du in [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).
