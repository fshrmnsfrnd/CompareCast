import express from "express";
import path from "path";
import { loadSources } from "./config";
import { Store } from "./store";
import { updateAll } from "./scheduler";

export function createServer(store: Store) {
  const app = express();

  // Statisches Frontend.
  app.use(express.static(path.resolve(process.cwd(), "public")));

  // Alle zuletzt bekannten Vorhersagen.
  app.get("/api/forecasts", (_req, res) => res.json(store.all()));

  // Konfigurierte Quellen.
  app.get("/api/sources", (_req, res) => res.json(loadSources()));

  // Manuelles Neuladen anstossen.
  app.post("/api/refresh", async (_req, res) => {
    await updateAll(store);
    res.json({ ok: true, forecasts: store.all().length });
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  return app;
}
