/** Eine konfigurierte Wetterquelle (aus config/sources.json). */
export interface Source {
  id: string;
  label: string;
  /** Name eines registrierten Providers, z. B. "windfinder". */
  provider: string;
  url: string;
  /** Ort, nach dem im Frontend gruppiert wird (z. B. "Herrsching"). */
  location?: string;
}

/** Ein einzelner Vorhersagezeitpunkt. Werte koennen null sein, wenn die Quelle sie nicht liefert. */
export interface ForecastPoint {
  /** Zeitpunkt als ISO-8601 in UTC. */
  time: string;
  /** Menschlich lesbare Ortszeit der Quelle, z. B. "2026-07-03 14:00". */
  localTime: string;
  windspeed: number | null; // Knoten
  gust: number | null; // Knoten (max)
  temperature: number | null; // Grad Celsius
  precip: number | null; // mm pro Zeitschritt
  precipType: string | null; // z. B. "Regen", "Schnee", "Gewitter"
  thunderstorm: boolean;
  direction: number | null; // Grad
  cloudCover: number | null; // Prozent
}

/** Ergebnis, das ein Provider aus einer Seite extrahiert. */
export interface ParseResult {
  model: string | null;
  lastUpdate: string | null; // ISO-8601, falls die Seite es angibt
  points: ForecastPoint[];
}

/** Eine gespeicherte Vorhersage inkl. Metadaten. */
export interface Forecast extends ParseResult {
  sourceId: string;
  label: string;
  provider: string;
  url: string;
  location?: string;
  fetchedAt: string; // ISO-8601, wann wir die Daten geholt haben
  error?: string; // gesetzt, falls der letzte Abruf fehlschlug
}

/** Provider-Schnittstelle: neue Websites implementieren genau diese. */
export interface Provider {
  id: string;
  /**
   * Optionaler eigener Abruf. Ohne Angabe wird der Standard-HTML-Abruf verwendet.
   */
  fetch?: (source: Source) => Promise<string>;
  /** Wandelt die abgerufene Seite in strukturierte Vorhersagepunkte um. */
  parse: (html: string, source: Source) => ParseResult;
}
