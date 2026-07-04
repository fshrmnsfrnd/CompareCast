# CompareCast

Ruft Wettervorhersagen von mehreren Websites ab und stellt sie in einer Ansicht
als vergleichende Graphen gegenüber. Die Daten werden automatisch im Hintergrund
aktualisiert. Läuft komplett über Docker Compose.

Aktuell angebunden: **Windfinder** (Modelle GFS und Superforecast) für den Ammersee
bei Herrsching. Sowohl weitere Orte als auch weitere Websites lassen sich ergänzen
(siehe [Erweitern](#erweitern)).

Angezeigte Werte: Windgeschwindigkeit, Böen, Temperatur und Niederschlag.
Gewitter-Zeitpunkte werden in den Graphen rot markiert.

---

## User-Dokumentation

### Voraussetzungen

Nur **Docker** mit **Docker Compose** (in Docker Desktop enthalten). Sonst nichts.

### Starten

Im Projektordner:

```bash
docker compose up -d --build
```

Danach im Browser öffnen: **http://localhost:3000**

Beim ersten Start werden die Daten sofort geholt; die Ansicht zeigt für jede
Quelle eine Karte (Modell + Stand der Vorhersage) und darunter je einen Graphen
pro Wert, in dem alle Quellen übereinandergelegt sind.

### Bedienen

- Jeder Graph zeigt genau einen Tag. Mit den Pfeilen ◀/▶ über den Graphen (oder
  den Pfeiltasten links/rechts) blätterst du durch die verfügbaren Tage.
- Die Ansicht lädt sich alle 5 Minuten selbst neu.
- Im Bereich „sources" sind die Quellen nach Ort gruppiert. Du kannst einzelne
  Quellen per Checkbox ein-/ausblenden oder mit der Checkbox neben dem Ortsnamen
  einen ganzen Ort auf einmal. Mehrere Orte gleichzeitig sind möglich; die Auswahl
  bleibt im Browser gespeichert.
- Über einen Klick auf einen Namen in der Graph-Legende lässt sich eine Quelle
  ebenfalls ein-/ausblenden.
- Der Button **„Jetzt aktualisieren"** holt sofort frische Daten (statt auf das
  nächste automatische Update zu warten).
- Rote, größere Punkte in einem Graphen markieren einen vorhergesagten Gewitter-Zeitpunkt.

### Aktualisierungsintervall

Standardmäßig werden die Daten **alle 3 Stunden** neu geholt (Windfinder rechnet
sein Vorhersagemodell etwa 4× täglich). Das Intervall lässt sich in
`docker-compose.yml` über `UPDATE_INTERVAL_MINUTES` ändern (Wert in Minuten).

### Stoppen

```bash
docker compose down
```

Die zuletzt geholten Daten bleiben im Ordner `data/` erhalten und sind nach einem
Neustart sofort wieder da.

### Weitere Orte / Quellen hinzufügen

Die Datei `config/sources.json` bearbeiten und einen Eintrag ergänzen — kein
Neu-Bauen nötig, ein `docker compose restart` genügt. Für einen anderen
Windfinder-Ort einfach die passende Seiten-URL eintragen. Beispiel:

```json
{
  "id": "windfinder-forecast-fehmarn",
  "label": "Windfinder GFS (Fehmarn)",
  "location": "Fehmarn",
  "provider": "windfinder",
  "url": "https://de.windfinder.com/forecast/wulfen_fehmarn"
}
```

`id` muss eindeutig sein, `label` erscheint in der Ansicht, `location` ist der Ort,
nach dem im Bereich „sources" gruppiert wird (mehrere Quellen mit gleichem
`location` landen in einer Gruppe und lassen sich gemeinsam ein-/ausblenden),
`provider` bleibt bei Windfinder-Seiten `windfinder`, `url` ist die jeweilige
Vorhersage-Seite (`/forecast/…` = GFS, `/weatherforecast/…` = Superforecast).

---

## Developer-Dokumentation

### Technik

- **Node.js 20 + TypeScript**, bewusst wenige Abhängigkeiten:
  - `express` — Webserver / API + Auslieferung des Frontends
  - `cheerio` — HTML-Parsing der Wetterseiten
  - HTTP-Abruf über das **eingebaute** `fetch` (Node ≥ 18), kein extra Client.
  - Zeitplanung über das **eingebaute** `setInterval`, kein Cron-Paket.
- **Frontend**: eine statische HTML-Seite mit **Chart.js** (per CDN), ein Graph
  pro Messwert, jede Quelle als eigene Linie.
- **Speicherung**: JSON-Dateien pro Quelle im Ordner `data/` (kein Datenbank-Setup nötig).

### Projektstruktur

```
config/sources.json     Liste der Quellen (zur Laufzeit editierbar)
src/
  index.ts              Einstiegspunkt: Store + Server + Scheduler starten
  server.ts             Express-Routen (/api/forecasts, /api/sources, /api/refresh)
  scheduler.ts          Abruf + automatisches Update aller Quellen
  store.ts              In-Memory-Cache mit JSON-Persistenz
  config.ts             Laden/Validieren von sources.json
  types.ts              Gemeinsame Typen (Source, Forecast, ForecastPoint, Provider)
  cli.ts                Testhelfer: eine URL einmalig abrufen und ausgeben
  providers/
    index.ts            Provider-Registry
    windfinder.ts       Parser für windfinder.com
public/                 Frontend (index.html, app.js, style.css)
Dockerfile              Multi-Stage-Build (kompiliert TS, schlanke Runtime)
docker-compose.yml      Service-Definition
```

### Datenfluss

`scheduler` holt für jede Quelle das HTML → der zuständige `Provider` parst es zu
`ForecastPoint[]` → `Store` legt das Ergebnis als `data/<id>.json` ab → die API
`GET /api/forecasts` liefert alle Vorhersagen → das Frontend zeichnet daraus die
Graphen. Schlägt ein Abruf fehl, bleiben die vorherigen Daten erhalten und die
Quelle wird mit einem `error`-Feld markiert.

### API

| Route               | Methode | Zweck                                            |
| ------------------- | ------- | ------------------------------------------------ |
| `/api/forecasts`    | GET     | Alle zuletzt bekannten Vorhersagen (JSON-Array)  |
| `/api/sources`      | GET     | Konfigurierte Quellen                            |
| `/api/refresh`      | POST    | Sofortiges Neu-Laden aller Quellen anstoßen      |
| `/api/health`       | GET     | Health-Check                                     |

### Erweitern

**Anderen Ort bei Windfinder:** Eintrag in `config/sources.json` ergänzen
(siehe User-Doku). Kein Code nötig.

**Andere Website anbinden:**

1. `src/providers/<name>.ts` anlegen und ein Objekt vom Typ `Provider`
   exportieren. Pflicht ist die Methode `parse(html, source): ParseResult`, die
   das HTML in `ForecastPoint[]` umwandelt. Optional kann `fetch(source)` einen
   eigenen Abruf definieren (z. B. für APIs statt HTML).
2. Den Provider in `src/providers/index.ts` importieren und in die Liste
   aufnehmen.
3. In `config/sources.json` Quellen mit `"provider": "<name>"` anlegen.

**Weiteren Messwert im Graphen zeigen:** In `public/app.js` das Array `METRICS`
um einen Eintrag ergänzen (`key` = Feldname aus `ForecastPoint`). Der Parser
liefert bereits zusätzlich Windrichtung (`direction`) und Bewölkung (`cloudCover`).

### Wie der Windfinder-Parser funktioniert

Windfinder bettet die **komplette Mehrtages-Vorhersage als JSON** in die Props
seiner Astro-Komponenten ein (`<astro-island props="…">`). Der Parser sammelt aus
allen Inseln die Vorhersagepunkte (`fcData`) ein, entdoppelt sie nach ihrem
UTC-Zeitstempel (`dt`) und rechnet die SI-Werte in die Anzeige-Einheiten um
(Temperatur `at` Kelvin → °C, Wind `ws`/`wg` m/s → Knoten). So werden **alle
Zeitpunkte geholt, so weit das jeweilige Modell reicht** (GFS ~10 Tage in
3-Stunden-Schritten, Superforecast ~3 Tage stündlich).

Als **Fallback** (falls Windfinder das JSON einmal entfernt) parst der Provider
die serverseitig gerenderten Tabellenzellen mit stabilen CSS-Klassen (`cell-ws`,
`cell-wg`, `cell-at`, `cell-p`, `cell-pt`, `cell-ts`, `cell-wd`, `cell-cl`) — die
decken allerdings nur die ersten Tage ab. Ändert Windfinder sein Markup, ist
`src/providers/windfinder.ts` die einzige anzupassende Stelle.

### Lokal ohne Docker (optional)

```bash
npm install
npm run dev        # kompiliert und startet auf Port 3000

# Einzelne Quelle testen, ohne Server:
npm run scrape -- https://de.windfinder.com/forecast/ammersee_herrsching
```

### Konfiguration (Umgebungsvariablen)

| Variable                   | Standard              | Bedeutung                            |
| -------------------------- | --------------------- | ------------------------------------ |
| `PORT`                     | `3000`                | Port des Webservers                  |
| `UPDATE_INTERVAL_MINUTES`  | `180`                 | Intervall des Auto-Updates (Minuten) |
| `SOURCES_FILE`             | `config/sources.json` | Pfad zur Quellen-Konfiguration       |
| `DATA_DIR`                 | `data`                | Ablageort der JSON-Daten             |

### Hinweis

Die Daten werden aus öffentlich abrufbaren HTML-Seiten gelesen. Bitte das
Aktualisierungsintervall moderat halten (Standard: 3 Stunden) und die
Nutzungsbedingungen der jeweiligen Anbieter beachten.
