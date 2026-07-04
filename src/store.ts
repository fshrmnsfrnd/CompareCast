import fs from "fs";
import path from "path";
import { Forecast } from "./types";

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");

/**
 * Haelt die zuletzt abgerufenen Vorhersagen im Speicher und persistiert sie als
 * JSON, damit nach einem Neustart sofort die letzten Daten vorliegen.
 */
export class Store {
  private forecasts = new Map<string, Forecast>();

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.load();
  }

  private fileFor(id: string): string {
    return path.join(DATA_DIR, `${id}.json`);
  }

  private load(): void {
    for (const file of fs.readdirSync(DATA_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const f = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
        this.forecasts.set(f.sourceId, f);
      } catch {
        /* beschaedigte Datei ignorieren */
      }
    }
  }

  set(forecast: Forecast): void {
    this.forecasts.set(forecast.sourceId, forecast);
    fs.writeFileSync(this.fileFor(forecast.sourceId), JSON.stringify(forecast, null, 2));
  }

  get(id: string): Forecast | undefined {
    return this.forecasts.get(id);
  }

  all(): Forecast[] {
    return [...this.forecasts.values()];
  }
}
