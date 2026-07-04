import * as cheerio from "cheerio";
import { ForecastPoint, ParseResult, Provider, Source } from "../types";

/**
 * Provider fuer windfinder.com.
 *
 * PRIMAER: Windfinder bettet die komplette Mehrtages-Vorhersage als JSON in die
 * Props seiner Astro-Komponenten ein (`<astro-island ... props="...">`, u. a.
 * `ForecastSection` fuer die naechsten und `ForecastDataInit` fuer die weiteren
 * Tage). Dort stehen ALLE Zeitpunkte, so weit das Modell reicht (GFS ~10 Tage,
 * Superforecast ~3 Tage stuendlich) — mit UTC-Zeitstempel (`dt`) und SI-Einheiten
 * (Temperatur `at` in Kelvin, Wind `ws`/`wg` in m/s). Wir sammeln die Punkte aus
 * allen Inseln, entdoppeln nach `dt` und rechnen in die Anzeige-Einheiten um
 * (Knoten, Grad Celsius).
 *
 * FALLBACK: Falls kein JSON gefunden wird (z. B. nach einem Umbau der Seite),
 * werden die serverseitig gerenderten Tabellenzellen geparst (nur die ersten
 * Tage). Dann bitte die JSON-Erkennung bzw. die Zell-Klassen unten pruefen.
 */

const MS_TO_KT = 1.94384;
const K_TO_C = 273.15;

export const windfinder: Provider = {
  id: "windfinder",

  parse(html: string, source: Source): ParseResult {
    const $ = cheerio.load(html);
    const lastUpdate = parseLastUpdate(html);
    const model = detectModel(html, source.url);

    let points = parseFromJson($);
    if (points.length === 0) points = parseFromCells($, html);

    return { model, lastUpdate, points };
  },
};

/* ---------------------------------------------------------------- JSON-Quelle */

// Astro serialisiert Werte als [typ, wert] (0 = Skalar/Objekt, 1 = Array).
function unwrapAstro(n: any): any {
  if (Array.isArray(n) && n.length === 2 && typeof n[0] === "number") {
    return n[0] === 1 ? n[1].map(unwrapAstro) : unwrapAstro(n[1]);
  }
  if (Array.isArray(n)) return n.map(unwrapAstro);
  if (n && typeof n === "object") {
    const o: any = {};
    for (const k of Object.keys(n)) o[k] = unwrapAstro(n[k]);
    return o;
  }
  return n;
}

type CheerioRoot = ReturnType<typeof cheerio.load>;

function parseFromJson($: CheerioRoot): ForecastPoint[] {
  const byTime = new Map<string, any>();

  $("astro-island").each((_i, el) => {
    const raw = $(el).attr("props");
    if (!raw || raw.indexOf("fcData") === -1) return;
    let obj: any;
    try {
      obj = unwrapAstro(JSON.parse(raw));
    } catch {
      return;
    }
    // Baum durchlaufen und alle fcData-Objekte (haben dt/ws/at) einsammeln.
    const stack: any[] = [obj];
    while (stack.length) {
      const x = stack.pop();
      if (Array.isArray(x)) {
        for (const v of x) stack.push(v);
      } else if (x && typeof x === "object") {
        if ("dt" in x && "ws" in x && "at" in x) {
          if (!byTime.has(x.dt)) byTime.set(x.dt, x);
        } else {
          for (const k of Object.keys(x)) stack.push(x[k]);
        }
      }
    }
  });

  const raws = [...byTime.values()].sort((a, b) => (a.dt < b.dt ? -1 : a.dt > b.dt ? 1 : 0));
  return raws.map(toPoint);
}

function toPoint(d: any): ForecastPoint {
  const p = isNum(d.p) ? d.p : 0;
  const hasPrecip = p > 0;
  const pt = typeof d.pt === "string" ? d.pt : null;
  const dtl = typeof d.dtl === "string" ? d.dtl : null;
  return {
    time: new Date(d.dt).toISOString(),
    localTime: dtl ? `${dtl.slice(0, 10)} ${dtl.slice(11, 16)}` : new Date(d.dt).toISOString(),
    windspeed: isNum(d.ws) ? Math.round(d.ws * MS_TO_KT) : null,
    gust: isNum(d.wg) ? Math.round(d.wg * MS_TO_KT) : null,
    temperature: isNum(d.at) ? Math.round(d.at - K_TO_C) : null,
    precip: p,
    precipType: hasPrecip ? mapPrecipType(pt) : null,
    thunderstorm: hasPrecip && !!pt && /ts/i.test(pt),
    direction: isNum(d.wd) ? Math.round(d.wd) : null,
    cloudCover: isNum(d.cl) ? Math.round(d.cl) : null,
  };
}

function mapPrecipType(pt: string | null): string {
  if (!pt) return "Niederschlag";
  const key = pt.toLowerCase();
  if (key.includes("ts")) return "Gewitter";
  if (key.includes("sn")) return "Schnee";
  if (key.includes("dz")) return "Niesel";
  if (key.includes("ra")) return "Regen";
  return "Niederschlag";
}

function isNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/* --------------------------------------------------- Fallback: Tabellenzellen */

const MONTHS: Record<string, number> = {
  Januar: 1, Februar: 2, "März": 3, Maerz: 3, April: 4, Mai: 5, Juni: 6,
  Juli: 7, August: 8, September: 9, Oktober: 10, November: 11, Dezember: 12,
};
const WEEKDAYS = "Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag";

function firstNumber(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function parseFromCells($: CheerioRoot, html: string): ForecastPoint[] {
  const text = (el: any) => $(el).text().trim();
  const imgAlt = (el: any) => $(el).find("img").first().attr("alt") || "";

  const ts = $(".cell-ts").toArray();
  const ws = $(".cell-ws").toArray();
  const wg = $(".cell-wg").toArray();
  const at = $(".cell-at").toArray();
  const pAmt = $(".cell-p").toArray();
  const pType = $(".cell-pt").toArray();
  const wd = $(".cell-wd").toArray();
  const cl = $(".cell-cl").toArray();

  const dayRe = new RegExp(`(?:${WEEKDAYS}),\\s*(\\d{1,2})\\.\\s*([A-Za-zä]+)`, "g");
  const days: Array<{ day: number; month: number }> = [];
  for (const m of html.matchAll(dayRe)) days.push({ day: parseInt(m[1], 10), month: MONTHS[m[2]] ?? 1 });

  const offsetMatch = html.match(/utcOffset&quot;:\[0,(-?\d+)\]/);
  const offsetMinutes = offsetMatch ? parseInt(offsetMatch[1], 10) : 0;
  const base = parseLastUpdate(html);
  const baseDate = base ? new Date(base) : new Date();
  const baseYear = baseDate.getUTCFullYear();
  const baseMonth = baseDate.getUTCMonth() + 1;

  const points: ForecastPoint[] = [];
  let dayIndex = -1;
  let prevHour: number | null = null;

  for (let i = 0; i < ts.length; i++) {
    const hourMatch = text(ts[i]).match(/(\d+)/);
    if (!hourMatch) continue;
    const hour = parseInt(hourMatch[1], 10);
    if (prevHour === null || hour < prevHour) dayIndex++;
    prevHour = hour;

    const d = days[Math.min(dayIndex, days.length - 1)] ?? { day: 1, month: baseMonth };
    const year = baseMonth === 12 && d.month === 1 ? baseYear + 1 : baseYear;
    const wallMs = Date.UTC(year, d.month - 1, d.day, hour, 0, 0);
    const iso = new Date(wallMs - offsetMinutes * 60000).toISOString();
    const pad = (x: number) => String(x).padStart(2, "0");

    const precipType = pType[i] ? imgAlt(pType[i]).trim() || null : null;
    points.push({
      time: iso,
      localTime: `${year}-${pad(d.month)}-${pad(d.day)} ${pad(hour)}:00`,
      windspeed: ws[i] ? firstNumber(text(ws[i])) : null,
      gust: wg[i] ? firstNumber(text(wg[i])) : null,
      temperature: at[i] ? firstNumber(text(at[i])) : null,
      precip: pAmt[i] ? firstNumber(text(pAmt[i])) ?? 0 : 0,
      precipType,
      thunderstorm: /gewitter|thunder/i.test(precipType || ""),
      direction: wd[i] ? firstNumber(imgAlt(wd[i])) : null,
      cloudCover: cl[i] ? firstNumber(imgAlt(cl[i])) : null,
    });
  }
  return points;
}

/* ------------------------------------------------------------------- Metadaten */

function parseLastUpdate(html: string): string | null {
  const m = html.match(/lastUpdate&quot;:\[0,&quot;([^&]+GMT)&quot;\]/);
  return m ? new Date(m[1]).toISOString() : null;
}

function detectModel(html: string, url: string): string | null {
  // Die "Superforecast"-Seite hat den Pfad /weatherforecast/ (das Wort selbst
  // steht als Tab-Link auch auf der GFS-Seite, taugt also nicht zur Erkennung).
  if (/weatherforecast/.test(url)) return "Superforecast (ICON)";
  const m = html.match(/basiert auf dem\s+([A-Za-z0-9-]+)[- ]?Modell/);
  if (m) return m[1].replace(/-$/, "");
  if (/GFS/.test(html)) return "GFS";
  return null;
}
