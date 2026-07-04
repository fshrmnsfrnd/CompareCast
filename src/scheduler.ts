import { loadSources } from "./config";
import { getProvider } from "./providers";
import { Store } from "./store";
import { Forecast, Provider, Source } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Standard-Abruf: holt das HTML einer Seite (Node >=18 hat global fetch). */
async function defaultFetch(source: Source): Promise<string> {
  const res = await fetch(source.url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "de" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fuer ${source.url}`);
  return res.text();
}

/** Aktualisiert eine einzelne Quelle und speichert das Ergebnis. */
async function updateSource(store: Store, source: Source): Promise<void> {
  const provider: Provider = getProvider(source.provider);
  try {
    const html = await (provider.fetch ?? defaultFetch)(source);
    const result = provider.parse(html, source);
    if (result.points.length === 0) {
      throw new Error("Keine Datenpunkte gefunden (Seitenstruktur geaendert?).");
    }
    const forecast: Forecast = {
      sourceId: source.id,
      label: source.label,
      provider: source.provider,
      url: source.url,
      location: source.location,
      fetchedAt: new Date().toISOString(),
      ...result,
    };
    store.set(forecast);
    console.log(`[update] ${source.id}: ${result.points.length} Punkte`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[update] ${source.id} fehlgeschlagen: ${message}`);
    // Vorherige Daten behalten, nur Fehler markieren.
    const prev = store.get(source.id);
    store.set({
      sourceId: source.id,
      label: source.label,
      provider: source.provider,
      url: source.url,
      location: source.location,
      fetchedAt: new Date().toISOString(),
      model: prev?.model ?? null,
      lastUpdate: prev?.lastUpdate ?? null,
      points: prev?.points ?? [],
      error: message,
    });
  }
}

/** Aktualisiert alle konfigurierten Quellen. */
export async function updateAll(store: Store): Promise<void> {
  const sources = loadSources();
  await Promise.all(sources.map((s) => updateSource(store, s)));
}

/** Startet den periodischen Abruf (sofort + danach im festen Intervall). */
export function startScheduler(store: Store): void {
  const minutes = Number(process.env.UPDATE_INTERVAL_MINUTES || 180);
  const run = () => updateAll(store).catch((e) => console.error("[scheduler]", e));
  run();
  setInterval(run, minutes * 60 * 1000);
  console.log(`[scheduler] Auto-Update alle ${minutes} Minuten aktiv.`);
}
