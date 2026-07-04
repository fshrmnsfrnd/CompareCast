// Welche Werte als Graphen angezeigt werden. Erweiterbar: einfach Eintrag ergaenzen
// (key muss einem Feld in ForecastPoint entsprechen).
const METRICS = [
  { key: "windspeed", label: "Windgeschwindigkeit (kn)" },
  { key: "gust", label: "Böen (kn)" },
  { key: "temperature", label: "Temperatur (°C)" },
  { key: "precip", label: "Niederschlag (mm)", fill: true },
];

const COLORS = ["#4aa3ff", "#ff9f40", "#4ade80", "#f472b6", "#facc15", "#a78bfa"];

const charts = {};

// Feste Farbe pro Quelle (per id), damit sie beim Ein-/Ausblenden nicht springt.
let colorById = {};
function colorFor(id) {
  return colorById[id] || "#888888";
}

// Zuletzt geladene Vorhersagen (fuer Neu-Rendern ohne erneuten Abruf).
let lastForecasts = [];

// Websiteweit (im Browser) gespeicherte Auswahl, welche Quellen ausgeblendet sind.
const HIDDEN_KEY = "wv.hiddenSources";
function loadHidden() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveHidden() {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}
let hidden = loadHidden();

// Gemeinsamer hervorgehobener Zeitpunkt (in ms), null = nichts hervorgehoben.
let activeX = null;
// Merkt, ob die letzte Interaktion per Touch war (fuer das mouseleave-Verhalten).
let lastWasTouch = false;

// Plugin, das eine vertikale Linie am hervorgehobenen Zeitpunkt zeichnet.
const crosshairPlugin = {
  id: "crosshair",
  afterDraw(chart) {
    if (activeX == null) return;
    const x = chart.scales.x.getPixelForValue(activeX);
    const area = chart.chartArea;
    if (x == null || Number.isNaN(x) || x < area.left || x > area.right) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#e6edf3aa";
    ctx.stroke();
    ctx.restore();
  },
};
if (typeof Chart !== "undefined") Chart.register(crosshairPlugin);

// Denselben Zeitpunkt in allen Graphen hervorheben (Fadenkreuz + Tooltips).
function syncAll(xVal) {
  activeX = xVal;
  for (const key in charts) {
    const c = charts[key];
    const elems = [];
    c.data.datasets.forEach((ds, di) => {
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < ds.data.length; i++) {
        const d = Math.abs(ds.data[i].x - xVal);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      if (best >= 0) elems.push({ datasetIndex: di, index: best });
    });
    c.setActiveElements(elems);
    if (c.tooltip) {
      const px = c.scales.x.getPixelForValue(xVal);
      c.tooltip.setActiveElements(elems, { x: px, y: c.chartArea.top });
    }
    c.update("none");
  }
}

function clearAll() {
  activeX = null;
  for (const key in charts) {
    const c = charts[key];
    c.setActiveElements([]);
    if (c.tooltip) c.tooltip.setActiveElements([], { x: 0, y: 0 });
    c.update("none");
  }
}

// Zeit-Wert unter dem Cursor ermitteln und auf den naechsten TATSAECHLICHEN
// Zeitpunkt (ueber alle Quellen) einrasten. Wichtig: nicht auf das grobe
// GFS-Raster einrasten, sondern auf die feinste vorhandene Aufloesung.
function clientXOf(evt) {
  if (evt.clientX != null) return evt.clientX;
  const t = (evt.touches && evt.touches[0]) || (evt.changedTouches && evt.changedTouches[0]);
  return t ? t.clientX : null;
}

function xValueAt(chart, evt) {
  if (!allX.length) return null;
  const cx = clientXOf(evt);
  if (cx == null) return null;
  const rect = chart.canvas.getBoundingClientRect();
  const px = cx - rect.left; // CSS-Pixel ab linkem Canvas-Rand
  const raw = chart.scales.x.getValueForPixel(px);
  if (raw == null || Number.isNaN(raw)) return null;
  let best = allX[0];
  let bestDist = Infinity;
  for (const v of allX) {
    const d = Math.abs(v - raw);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best;
}

// Hover-/Touch-Synchronisation einmalig an alle Canvas-Elemente haengen.
let syncAttached = false;
function attachSync() {
  if (syncAttached || Object.keys(charts).length < METRICS.length) return;
  syncAttached = true;
  for (const key in charts) {
    const c = charts[key];
    c.canvas.addEventListener("mousemove", (e) => {
      lastWasTouch = false;
      const x = xValueAt(c, e);
      if (x != null) syncAll(x);
    });
    // Maus verlaesst den Graphen -> Fadenkreuz + Detail-Box ausblenden.
    // (Touch loest teils ein emuliertes mouseleave aus; dort NICHT loeschen,
    // damit ein getippter Punkt auf dem Handy sichtbar bleibt.)
    c.canvas.addEventListener("mouseleave", () => {
      if (!lastWasTouch) clearAll();
    });

    // Touch (Mobil): Tippen/Wischen scrubbt das Fadenkreuz und haelt den Punkt
    // fest (mangels Hover). preventDefault verhindert das Seitenscrollen nur,
    // solange der Finger auf dem Graphen ist.
    const onTouch = (e) => {
      lastWasTouch = true;
      const x = xValueAt(c, e);
      if (x == null) return;
      e.preventDefault();
      syncAll(x);
    };
    c.canvas.addEventListener("touchstart", onTouch, { passive: false });
    c.canvas.addEventListener("touchmove", onTouch, { passive: false });
  }
}

function fmtTime(ms) {
  return new Date(ms).toLocaleString("de-DE", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Positionen der vertikalen Gitterlinien + sichtbarer X-Bereich, gemeinsam fuer
// alle Graphen. Werden bei jedem Laden aus den Daten neu berechnet.
let gridTicks = [];
let xRange = { min: undefined, max: undefined };
// Alle tatsaechlich vorkommenden Zeitpunkte (Union ueber alle sichtbaren Quellen),
// aufsteigend sortiert. Dient dem Einrasten beim Hovern.
let allX = [];

// Tages-Navigation: verfuegbare Tage + aktuell gewaehlter Tag. Jeder Graph zeigt
// immer genau einen Tag; das Zeitfenster (dayWindow) begrenzt die X-Achse.
let days = []; // [{ key:"YYYY-MM-DD", label, start(ms), end(ms) }]
let selectedDayKey = null;
let dayWindow = { min: undefined, max: undefined };

// Aus den sichtbaren Punkten die vorhandenen (lokalen) Kalendertage ableiten.
// localTime ("YYYY-MM-DD HH:00") liefert den Kalendertag; start/end werden aus
// dem echten Zeitstempel (UTC-ms) berechnet, damit sie zur X-Achse passen.
function computeDays(forecasts) {
  const map = new Map();
  for (const f of forecasts) {
    for (const p of f.points) {
      const x = Date.parse(p.time);
      if (Number.isNaN(x) || !p.localTime) continue;
      const key = p.localTime.slice(0, 10);
      const hour = parseInt(p.localTime.slice(11, 13), 10) || 0;
      const start = x - hour * 3600000; // lokale Mitternacht als UTC-ms
      if (!map.has(key)) map.set(key, start);
    }
  }
  days = [...map.entries()]
    .map(([key, start]) => ({ key, start, end: start + 24 * 3600000, label: dayLabel(key) }))
    .sort((a, b) => a.start - b.start);

  // Auswahl beibehalten; sonst den Tag mit "jetzt" waehlen, sonst den ersten.
  if (!days.some((d) => d.key === selectedDayKey)) {
    const now = Date.now();
    const today = days.find((d) => now >= d.start && now < d.end);
    selectedDayKey = today ? today.key : days.length ? days[0].key : null;
  }
}

function dayLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

function currentDay() {
  return days.find((d) => d.key === selectedDayKey) || days[0] || null;
}

function renderDayNav() {
  const day = currentDay();
  const idx = day ? days.findIndex((d) => d.key === day.key) : -1;
  document.getElementById("day-label").textContent = day ? day.label : "–";
  document.getElementById("day-prev").disabled = idx <= 0;
  document.getElementById("day-next").disabled = idx < 0 || idx >= days.length - 1;
}

// Nur das Zeitfenster der Graphen auf den gewaehlten Tag setzen (ohne Neuaufbau).
function applyDay() {
  const day = currentDay();
  dayWindow = day ? { min: day.start, max: day.end } : { min: undefined, max: undefined };
  for (const key in charts) {
    const c = charts[key];
    c.options.scales.x.min = dayWindow.min;
    c.options.scales.x.max = dayWindow.max;
    c.update("none");
  }
  renderDayNav();
}

function stepDay(delta) {
  const idx = days.findIndex((d) => d.key === selectedDayKey);
  const next = idx + delta;
  if (next < 0 || next >= days.length) return;
  selectedDayKey = days[next].key;
  applyDay();
}

// Gitterlinien am Modell mit den GROESSTEN Zeitabstaenden ausrichten (z. B. GFS,
// alle 3 h). Der sichtbare Bereich umfasst weiterhin alle Quellen.
function computeGrid(forecasts) {
  let coarseTicks = [];
  let coarsestGap = -1;
  let min = Infinity;
  let max = -Infinity;
  const union = new Set();

  for (const f of forecasts) {
    const xs = f.points
      .map((p) => Date.parse(p.time))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    if (xs.length === 0) continue;
    xs.forEach((v) => union.add(v));
    min = Math.min(min, xs[0]);
    max = Math.max(max, xs[xs.length - 1]);
    if (xs.length < 2) continue;
    let sum = 0;
    for (let i = 1; i < xs.length; i++) sum += xs[i] - xs[i - 1];
    const avgGap = sum / (xs.length - 1);
    if (avgGap > coarsestGap) {
      coarsestGap = avgGap;
      coarseTicks = xs;
    }
  }

  gridTicks = coarseTicks;
  allX = [...union].sort((a, b) => a - b);
  xRange = {
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined,
  };
}

// Ort einer Quelle (explizites Feld, sonst aus dem Label in Klammern abgeleitet).
function locationOf(f) {
  if (f.location) return f.location;
  const m = /\(([^)]+)\)\s*$/.exec(f.label || "");
  return m ? m[1] : f.label || "Unbekannt";
}

// Label ohne den " (Ort)"-Zusatz am Ende (der Ort steht schon in der Gruppe).
function shortLabel(f) {
  return (f.label || "").replace(/\s*\([^)]*\)\s*$/, "").trim() || f.label || "";
}

function renderSources(forecasts) {
  const el = document.getElementById("sources");
  el.innerHTML = "";

  // Nach Ort gruppieren (Reihenfolge des ersten Auftretens beibehalten).
  const groups = new Map();
  forecasts.forEach((f) => {
    const loc = locationOf(f);
    if (!groups.has(loc)) groups.set(loc, []);
    groups.get(loc).push(f);
  });

  groups.forEach((list, loc) => {
    const shownCount = list.filter((f) => !hidden.has(f.sourceId)).length;
    const allShown = shownCount === list.length;
    const anyShown = shownCount > 0;

    const group = document.createElement("div");
    group.className = "source-group";

    // Kopfzeile mit Ort-Checkbox (blendet den ganzen Ort ein/aus).
    const header = document.createElement("label");
    header.className = "group-header";
    header.innerHTML = `<input type="checkbox"/><span class="group-name">${loc}</span>`;
    const gcb = header.querySelector("input");
    gcb.checked = allShown;
    gcb.indeterminate = anyShown && !allShown;
    gcb.addEventListener("change", () => {
      const showAll = !allShown; // nicht alles sichtbar -> alle ein; sonst alle aus
      list.forEach((f) => {
        if (showAll) hidden.delete(f.sourceId);
        else hidden.add(f.sourceId);
      });
      saveHidden();
      render();
    });
    group.appendChild(header);

    // Einzelne Quellen des Ortes.
    list.forEach((f) => {
      const shown = !hidden.has(f.sourceId);
      const card = document.createElement("div");
      card.className = "source-card" + (shown ? "" : " hidden-src");
      card.style.borderLeftColor = colorFor(f.sourceId);
      const stand = f.lastUpdate ? new Date(f.lastUpdate).toLocaleString("de-DE") : "–";
      card.innerHTML =
        `<label class="src-toggle"><input type="checkbox" ${shown ? "checked" : ""}/>` +
        `<span class="label">${shortLabel(f)}</span></label>` +
        `<div class="meta">Modell: ${f.model || "–"}<br>Stand der Vorhersage: ${stand}</div>` +
        (f.error ? `<div class="err">Fehler: ${f.error}</div>` : "");
      card.querySelector("input").addEventListener("change", (ev) => {
        if (ev.target.checked) hidden.delete(f.sourceId);
        else hidden.add(f.sourceId);
        saveHidden();
        render();
      });
      group.appendChild(card);
    });

    el.appendChild(group);
  });
}

function datasetFor(metric, forecast) {
  const color = colorFor(forecast.sourceId);
  const data = forecast.points.map((p) => ({ x: Date.parse(p.time), y: p[metric.key] }));
  // Gewitter-Zeitpunkte hervorheben (groessere, rote Punkte).
  const pointColor = forecast.points.map((p) => (p.thunderstorm ? "#ff4d4d" : color));
  const pointRadius = forecast.points.map((p) => (p.thunderstorm ? 6 : 2));
  return {
    label: forecast.label,
    data,
    borderColor: color,
    backgroundColor: metric.fill ? color + "33" : color,
    pointBackgroundColor: pointColor,
    pointRadius,
    borderWidth: 2,
    tension: 0.25,
    fill: !!metric.fill,
    spanGaps: true,
  };
}

function renderCharts(forecasts) {
  const container = document.getElementById("charts");
  METRICS.forEach((metric) => {
    let panel = document.getElementById("panel-" + metric.key);
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "chart-panel";
      panel.id = "panel-" + metric.key;
      panel.innerHTML =
        `<h2>${metric.label}</h2><div class="chart-wrap"><canvas id="c-${metric.key}"></canvas></div>`;
      container.appendChild(panel);
    }
    const datasets = forecasts.map((f) => datasetFor(metric, f));

    if (charts[metric.key]) {
      const c = charts[metric.key];
      c.data.datasets = datasets;
      c.options.scales.x.min = dayWindow.min;
      c.options.scales.x.max = dayWindow.max;
      c.update();
      return;
    }
    charts[metric.key] = new Chart(document.getElementById("c-" + metric.key), {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Chart-eigenes Hover-Handling aus; Hervorhebung wird manuell synchronisiert.
        events: [],
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "linear",
            min: dayWindow.min,
            max: dayWindow.max,
            // Ticks/Gitterlinien exakt auf die Zeitpunkte des grobkoernigsten
            // Modells legen (statt automatischer Verteilung).
            afterBuildTicks: (axis) => {
              if (!gridTicks.length) return;
              const lo = dayWindow.min ?? -Infinity;
              const hi = dayWindow.max ?? Infinity;
              axis.ticks = gridTicks
                .filter((v) => v >= lo && v <= hi)
                .map((value) => ({ value }));
            },
            ticks: {
              autoSkip: false,
              maxRotation: 60,
              minRotation: 45,
              font: { size: 11 },
              // Auf schmalen Displays nur jede zweite Beschriftung zeigen
              // (die Gitterlinien bleiben aber an jedem Zeitpunkt).
              callback: (v, index) =>
                window.innerWidth < 640 && index % 2 !== 0 ? "" : fmtTime(v),
              color: "#93a1ad",
            },
            grid: { color: "#2a3947" },
          },
          y: { ticks: { color: "#93a1ad", font: { size: 11 } }, grid: { color: "#2a3947" } },
        },
        plugins: {
          legend: { labels: { color: "#e6edf3" } },
          tooltip: {
            callbacks: { title: (items) => fmtTime(items[0].parsed.x) },
          },
        },
      },
    });
  });
}

// Zeichnet Karten + Graphen aus den zuletzt geladenen Daten neu. Die Graphen
// enthalten nur die nicht ausgeblendeten Quellen; die Karten zeigen alle (mit
// Checkbox). Kein erneuter Serverabruf noetig.
function render() {
  const visible = lastForecasts.filter((f) => !hidden.has(f.sourceId));
  computeGrid(visible);
  computeDays(visible);
  const day = currentDay();
  dayWindow = day ? { min: day.start, max: day.end } : { min: undefined, max: undefined };
  renderSources(lastForecasts);
  renderDayNav();
  renderCharts(visible);
  attachSync();
}

async function load() {
  const status = document.getElementById("status");
  if (typeof Chart === "undefined") {
    status.textContent = "Chart.js konnte nicht geladen werden (Internetzugang/CDN prüfen).";
    return;
  }
  try {
    const res = await fetch("/api/forecasts");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const forecasts = await res.json();
    forecasts.sort((a, b) => a.label.localeCompare(b.label));
    // Farben stabil pro Quelle vergeben (Reihenfolge unabhaengig von Sichtbarkeit).
    forecasts.forEach((f, i) => {
      colorById[f.sourceId] = COLORS[i % COLORS.length];
    });
    lastForecasts = forecasts;
    render();
    status.textContent = "Aktualisiert: " + new Date().toLocaleTimeString("de-DE");
  } catch (e) {
    console.error(e);
    status.textContent = "Fehler beim Laden: " + (e && e.message ? e.message : e);
  }
}

document.getElementById("refresh").addEventListener("click", async (ev) => {
  const btn = ev.target;
  btn.disabled = true;
  btn.textContent = "Aktualisiere…";
  try {
    await fetch("/api/refresh", { method: "POST" });
    await load();
  } finally {
    btn.disabled = false;
    btn.textContent = "Jetzt aktualisieren";
  }
});

document.getElementById("day-prev").addEventListener("click", () => stepDay(-1));
document.getElementById("day-next").addEventListener("click", () => stepDay(1));
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") stepDay(-1);
  else if (e.key === "ArrowRight") stepDay(1);
});

load();
setInterval(load, 5 * 60 * 1000); // Ansicht alle 5 Minuten neu laden
