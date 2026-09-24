# Scanny 📄✨

**Scanny** ist eine schlanke, selbst gehostete Web-Anwendung für das Home Office: Belege
fotografieren oder einwerfen, und Scanny richtet sie gerade, erkennt den Text, schlägt Titel,
Datum, Betrag und Ordner vor und legt am Ende ein durchsuchbares PDF im Finder ab.

Entwickelt für eine Person, ohne Login, **ohne Cloud-Dienste und ohne Cloud-KI** – alles läuft
lokal in Docker auf dem Mac. Private Steuerbelege verlassen den Rechner nicht.

---

## Der Arbeitsablauf

1. **Beleg hereinholen** – zwei Wege, beide führen zum selben Ergebnis:
   - Foto mit dem iPhone machen und **per AirDrop auf den Mac** schicken, dann die Datei ins
     Scanny-Fenster ziehen (funktioniert überall in der App).
   - Oder die Datei in den Ordner **`Scanny/Upload`** legen – Scanny überwacht ihn und zieht
     alles Neue von selbst ein.

   Unterstützt werden JPG, PNG, HEIC und PDF.

2. **Scanny bereitet auf** – Ränder erkennen, entzerren, auf DIN A4 mit 300 dpi bringen,
   Texterkennung (deutsch + englisch) und ein durchsuchbares PDF/A erzeugen.

3. **Import-Dialog bestätigen** – Scanny schlägt Dokumenttyp, Titel, Absender, Datum, Betrag und
   den passenden Ordner vor. Werte prüfen, bei Bedarf korrigieren, bestätigen. Von Hand geänderte
   Felder überschreibt Scanny später nie wieder.

4. **Ablegen** – der Beleg landet als `YYYY-MM-DD Titel.pdf` in `Scanny/Archiv/<Ordner>/`,
   direkt im Finder lesbar. Auch ohne Scanny kommst du jederzeit an deine Unterlagen.

### Tastenkürzel im Eingang

| Taste | Wirkung |
| :--- | :--- |
| `←` `→` `↑` `↓` | Zwischen den Belegen blättern |
| `Enter` | Beleg öffnen |
| `A` | In den vorgeschlagenen Ordner ablegen |
| `Entf` | In den Papierkorb verschieben |
| `Esc` | Detailansicht schließen |
| `/` | Suchfeld fokussieren |

---

## Was Scanny sonst noch kann

- **Mehrseitige Belege**: Mehrere Fotos im Eingang markieren und zu einem Dokument zusammenfügen
  (Reihenfolge per Ziehen). Über „Seiten wieder trennen" kommen die Einzelbelege zurück.
- **Papierkorb**: Gelöschtes bleibt 30 Tage wiederherstellbar, danach räumt Scanny selbst auf.
- **Volltextsuche** über den erkannten Text, Titel und Absender (Tastenkürzel `/`).
- **Export für die Steuer**: In jedem Ordner auf „Exportieren…" – wahlweise ZIP mit allen PDFs,
  eine CSV-Übersicht für Excel/Numbers oder ein Sammel-PDF mit Übersichtsseite und Summe.
  Zeitraum und einzelne Belege lassen sich eingrenzen.

---

## Schnellstart mit Docker

### 1. Einrichtung (`make setup`)

```bash
make setup
```

Der Befehl führt folgende Schritte automatisch aus:
1. Erstellt `.env` aus `.env.example` (falls noch nicht vorhanden) und setzt deinen Benutzernamen ein.
2. Legt den in `SCANNY_PATH` angegebenen Ordner an.
3. Baut das schlanke Multi-Stage Docker-Image.
4. Startet Scanny im Hintergrund auf Port **3004** (`http://localhost:3004`).

*Tipp:* Prüfe in der erzeugten `.env` den Pfad `SCANNY_PATH` – dort legt Scanny die Unterordner
`Upload/` und `Archiv/` an (z. B. `/Users/max/Documents/Scanny`).

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

Tests laufen mit `npm test`, ein Typ- und Build-Check mit `npm run build`.

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

## Datensicherung

Scanny hält seine Daten an **zwei** Stellen – für ein vollständiges Backup brauchst du beide:

| Ort | Inhalt | Ohne dieses Backup … |
| :--- | :--- | :--- |
| `SCANNY_PATH` (z. B. `~/Documents/Scanny`) | `Archiv/` mit allen fertigen PDFs, `Upload/` | … sind die Belege selbst weg. |
| `data/` im Projektverzeichnis | SQLite-Datenbank, Originaldateien, Vorschaubilder | … fehlen Metadaten, Suche und Originale. |

Beide Ordner einfach mitsichern (Time Machine, externe Platte, was du ohnehin nutzt). Die PDFs im
Archiv sind normale Dateien mit sprechenden Namen – selbst wenn nur dieser Ordner übrig bleibt,
bleiben deine Unterlagen lesbar und durchsuchbar.

---

## Architektur & Regeln

Details zur Architektur, dem SQLite-Datenmodell und verbindlichen Entwicklerregeln findest du in
[docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).
