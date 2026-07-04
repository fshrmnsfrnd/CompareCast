import fs from "fs";
import path from "path";
import { Source } from "./types";

const CONFIG_PATH =
  process.env.SOURCES_FILE || path.resolve(process.cwd(), "config/sources.json");

/** Liest die Quellen zur Laufzeit aus config/sources.json (kein Neu-Build noetig). */
export function loadSources(): Source[] {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  const data = JSON.parse(raw) as { sources?: Source[] };
  if (!Array.isArray(data.sources)) {
    throw new Error(`config/sources.json enthaelt kein "sources"-Array.`);
  }
  for (const s of data.sources) {
    if (!s.id || !s.provider || !s.url) {
      throw new Error(`Ungueltige Quelle in sources.json: ${JSON.stringify(s)}`);
    }
  }
  return data.sources;
}
