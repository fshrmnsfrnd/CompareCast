import { getProvider } from "./providers";
import { Source } from "./types";

/**
 * Kleiner Test-Helfer: eine Quelle einmalig abrufen und das Ergebnis ausgeben.
 * Nutzung:  npm run scrape -- <url> [providerId]
 * Beispiel: npm run scrape -- https://de.windfinder.com/forecast/ammersee_herrsching
 */
async function main() {
  const url = process.argv[2];
  const providerId = process.argv[3] || "windfinder";
  if (!url) {
    console.error("Bitte eine URL angeben: npm run scrape -- <url> [providerId]");
    process.exit(1);
  }
  const source: Source = { id: "cli", label: "CLI", provider: providerId, url };
  const provider = getProvider(providerId);
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "de",
    },
  });
  const html = await res.text();
  const result = provider.parse(html, source);
  console.log(`Modell: ${result.model}  |  Stand: ${result.lastUpdate}`);
  console.log(`Punkte: ${result.points.length}`);
  console.table(
    result.points.map((p) => ({
      Zeit: p.localTime,
      Wind: p.windspeed,
      Boeen: p.gust,
      Temp: p.temperature,
      Regen: p.precip,
      Art: p.precipType ?? "",
    }))
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
