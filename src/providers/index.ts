import { Provider } from "../types";
import { windfinder } from "./windfinder";

/**
 * Registry aller verfuegbaren Provider.
 *
 * Neue Website einbinden:
 *   1. Neue Datei src/providers/<name>.ts mit einem Objekt vom Typ `Provider`.
 *   2. Hier importieren und unten in die Liste aufnehmen.
 *   3. In config/sources.json Quelle(n) mit "provider": "<name>" ergaenzen.
 */
const providers: Provider[] = [windfinder];

const byId = new Map(providers.map((p) => [p.id, p]));

export function getProvider(id: string): Provider {
  const p = byId.get(id);
  if (!p) {
    throw new Error(
      `Unbekannter Provider "${id}". Verfuegbar: ${[...byId.keys()].join(", ")}`
    );
  }
  return p;
}
