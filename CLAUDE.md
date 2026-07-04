# CLAUDE.md

Leitfaden für die Arbeit an diesem Projekt. Bitte vor Änderungen lesen.

## Was das Projekt ist

CompareCast ruft Wettervorhersagen von mehreren Websites ab und stellt sie in
einer Ansicht als vergleichende Graphen gegenüber. Die Daten aktualisieren sich
automatisch im Hintergrund. Alles läuft über Docker Compose.

Aktuell angebunden: **Windfinder** (Modelle GFS und Superforecast) für den Ammersee
bei Herrsching. Angezeigte Werte: Windgeschwindigkeit, Böen, Temperatur,
Niederschlag; Gewitter-Zeitpunkte werden hervorgehoben. Wichtiges Merkmal: die
Quellen können unterschiedliche Zeitpunkte/Auflösungen haben (GFS 3-stündlich,
Superforecast stündlich) — das muss überall berücksichtigt werden.

## Technik

- **Node.js 20 + TypeScript**, bewusst wenige Abhängigkeiten: nur `express`
  (Server/API) und `cheerio` (HTML-Parsing) zur Laufzeit.
- HTTP über das **eingebaute** `fetch`, Zeitplanung über das **eingebaute**
  `setInterval` — keine Extra-Pakete für HTTP, Cron oder Datenbank.
- Speicherung als JSON-Dateien pro Quelle unter `data/`.
- **Frontend**: statische Seite mit **Chart.js** (per CDN, Datei ist
  `chart.umd.js` — es gibt kein `chart.umd.min.js`).

## Wichtige Arbeitsprinzipien (bitte einhalten)

- **Erst eingebaute Funktion oder Bibliothek** verwenden, wo möglich. Geht das
  nicht, zuerst prüfen, ob nicht auch eine einzelne Zeile reicht, bevor größere
  Konstruktionen gebaut werden. Code schlank halten.
- **Alles über Docker Compose.** Neue Services/Abhängigkeiten so integrieren, dass
  `docker compose up` genügt.
- **Einfach aufzusetzen und zu bedienen.** Setup und Nutzung dürfen nicht
  komplizierter werden als nötig.
- **Erweiterbarkeit ist zentral**: sowohl weitere Orte als auch weitere Websites
  müssen ohne größeren Umbau möglich bleiben (siehe unten).
- **Selbstaktualisierung** in sinnvollen Abständen beibehalten (Standard: alle 3
  Stunden, `UPDATE_INTERVAL_MINUTES`).
- **Die `README.md` aktuell halten** — sie enthält getrennte User- und
  Developer-Dokumentation.
- **Bei Unklarheiten oder mehreren gleich guten Optionen nachfragen**, statt zu
  raten.
- Antworten knapp und direkt halten, ohne unnötige Ausschmückung.

## Projektstruktur

```
config/sources.json     Quellen (zur Laufzeit editierbar, kein Rebuild)
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
Dockerfile              Multi-Stage-Build
docker-compose.yml      Service-Definition (public/, config/, data/ als Volumes)
```

## Entwickeln & Testen

```bash
docker compose up --build      # starten, dann http://localhost:3000

# Frontend-Änderungen (public/) greifen ohne Rebuild:
docker compose restart         # oder einfach im Browser hart neu laden

# Lokal ohne Docker (Node >=20):
npm install && npm run dev
npm run scrape -- <url>        # eine Quelle einmalig abrufen und prüfen
```

`public/`, `config/` und `data/` sind als Volumes gemountet — Änderungen daran
brauchen keinen Neu-Build.

## Erweitern

- **Anderer Ort bei Windfinder**: Eintrag in `config/sources.json` ergänzen. Kein
  Code nötig. `url` ist die Vorhersage-Seite (`/forecast/…` = GFS,
  `/weatherforecast/…` = Superforecast).
- **Andere Website**: neue Datei `src/providers/<name>.ts` mit einem Objekt vom
  Typ `Provider` (Pflichtmethode `parse(html, source): ParseResult`, optional
  `fetch`), in `src/providers/index.ts` registrieren, dann Quellen mit
  `"provider": "<name>"` anlegen.
- **Weiterer Messwert im Graphen**: Array `METRICS` in `public/app.js` ergänzen
  (`key` = Feldname aus `ForecastPoint`). Der Parser liefert bereits zusätzlich
  `direction` und `cloudCover`.

## Frontend-Verhalten (bereits umgesetzt, beim Ändern beachten)

- Ein Graph pro Messwert, alle Quellen überlagert, feste Farbe pro Quelle.
- Jeder Graph zeigt genau **einen Tag**; mit ◀/▶ (oder Pfeiltasten) blättert man
  durch die Tage. Verfügbare Tage werden aus den Daten abgeleitet (`computeDays`),
  das Zeitfenster (`dayWindow`) begrenzt die X-Achse; die Datensätze enthalten
  weiterhin alle Punkte.
- Vertikale Gitterlinien liegen auf den Zeitpunkten des Modells mit den größten
  Zeitabständen (dynamisch berechnet, aktuell GFS alle 3 h).
- Quellen sind im Bereich „sources" nach **Ort gruppiert** (Feld `location` in
  `sources.json`, Fallback: Ort aus dem Label in Klammern). Jede Quelle einzeln
  und jeder ganze Ort (Gruppen-Checkbox, tri-state) lassen sich ein-/ausblenden;
  mehrere Orte gleichzeitig sind möglich. Auswahl wird websiteweit im Browser
  gespeichert (`localStorage`, Set ausgeblendeter Quellen-IDs).
- Hover/Tippen auf einen Zeitpunkt markiert ihn synchron in allen Graphen
  (Fadenkreuz + Tooltips). Verlässt die Maus den Graphen, werden Fadenkreuz und
  Detail-Box wieder ausgeblendet (`clearAll`); auf Touch bleibt der getippte
  Punkt sichtbar (kein Hover). Ein `lastWasTouch`-Flag unterscheidet beide Fälle.
- Position beim Hovern wird aus dem echten Pixel→Zeit-Wert bestimmt und auf den
  nächsten **tatsächlichen** Zeitpunkt aller Quellen eingerastet (nicht auf das
  grobe GFS-Raster). Beim Einbau neuer Quellen mit anderer Auflösung diese Logik
  nicht brechen.
- Mobil optimiert: einspaltig, Touch-Scrubbing für das Fadenkreuz, ausgedünnte
  Achsenbeschriftung auf schmalen Displays.

## Zum Windfinder-Parser

**Primärquelle ist JSON, nicht die Tabelle.** Windfinder bettet die komplette
Mehrtages-Vorhersage als JSON in die Props seiner Astro-Komponenten ein
(`<astro-island props="…">`, u. a. `ForecastSection` = nahe Tage,
`ForecastDataInit` = weitere Tage). Der Parser sammelt aus allen Inseln die
`fcData`-Objekte, entdoppelt nach UTC-Zeitstempel (`dt`) und rechnet SI in
Anzeige-Einheiten um (`at` Kelvin→°C, `ws`/`wg` m/s→Knoten). Damit werden **alle
Zeitpunkte** geholt, so weit das Modell reicht (GFS ~10 Tage, Super ~3 Tage).
Wichtig: die ersten Tage stehen NICHT in `ForecastDataInit`, sondern in
`ForecastSection` — deshalb immer über alle `astro-island`-Props iterieren.

**Fallback**: Findet sich kein JSON, parst der Provider die serverseitig
gerenderten Tabellenzellen (stabile Klassen `cell-ws`, `cell-wg`, `cell-at`,
`cell-p`, `cell-pt`, `cell-ts`, `cell-wd`, `cell-cl`; Tageswechsel am Zurück-
springen der Uhrzeit). Diese decken nur die ersten Tage ab. Einzige anzupassende
Stelle bei Windfinder-Änderungen: `src/providers/windfinder.ts`.

## Hinweis

Daten stammen aus öffentlich abrufbaren HTML-Seiten. Aktualisierungsintervall
moderat halten und die Nutzungsbedingungen der Anbieter beachten.
