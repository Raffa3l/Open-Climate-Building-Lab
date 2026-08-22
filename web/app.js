/**
 * Open Climate Building Lab — Frontend.
 *
 * Der Rechenkern ist derselbe, der im CLI und in den Tests läuft: aus
 * core/src, per tsc nach ESM übersetzt (ADR 0006). Es gibt keine zweite
 * Implementierung im Browser — genau darum ist «Berechnung anzeigen» kein
 * nachträglicher Anbau, sondern die Rückgabe der Funktion selbst.
 */

import {
  adaptiveComfortBand,
  dailyMean,
  exceedanceHours,
  getVariable,
  localDayIndex,
  readPacked,
  runningMeanOutdoorTemperature,
  shortHash,
  simulate5R1C,
  warmupHours,
} from "./vendor/core/index.js";
import { drawChart, drawCrosshair } from "./chart.js";

const OCCUPANCY = { fromHour: 7, toHour: 19, weekdaysOnly: true, gainsUnoccupied: 2, airChangeOccupied: 1.5 };
const OCCUPIED_FROM = 7;
const OCCUPIED_TO = 19;
const FACADE_AREA = 9.8;
const CATEGORY = "II";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

let catalog = null;
let loaded = null;    // { series, band, runningMean, station, year }
let geometry = null;
let lastResult = null;
let pending = false;

// --- Zustand aus den Bedienelementen ----------------------------------------

function readState() {
  return {
    station: $("station").value,
    year: $("year").value,
    azimuth: Number($("azimuth").value),
    massClass: $("massClass").value,
    skyModel: $("skyModel").value,
    windowFraction: Number($("windowFraction").value) / 100,
    shading: Number($("shading").value),
    gains: Number($("gains").value),
    nightVent: Number($("nightVent").value),
    nightVentOn: $("nightVentOn").checked,
  };
}

function applyState(s) {
  for (const [id, value] of Object.entries(s)) {
    const el = $(id);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = value === "1" || value === true;
    else el.value = value;
  }
}

/** Permalink: der Zustand steht in der Adresszeile, nicht im Speicher. */
function writeUrl(s) {
  const p = new URLSearchParams({
    station: s.station,
    year: s.year,
    azimuth: String(s.azimuth),
    massClass: s.massClass,
    skyModel: s.skyModel,
    windowFraction: String(Math.round(s.windowFraction * 100)),
    shading: String(s.shading),
    gains: String(s.gains),
    nightVent: String(s.nightVent),
    nightVentOn: s.nightVentOn ? "1" : "0",
  });
  history.replaceState(null, "", `#${p}`);
}

function readUrl() {
  if (!location.hash.startsWith("#")) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  return p.size ? Object.fromEntries(p) : null;
}

// --- Raumbeschreibung aus dem Zustand ---------------------------------------

/**
 * Rundet Eingabegeometrie auf sechs Nachkommastellen.
 *
 * 9.8 − 9.8·0.4 ergibt in Gleitkomma 5.880000000000001. Der Rest ist
 * physikalisch bedeutungslos, wandert aber in den Berechnungs-Hash und macht
 * ihn damit vom Rechenweg abhängig statt vom Sachverhalt.
 */
function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function buildRoom(s) {
  const windowArea = round6(FACADE_AREA * s.windowFraction);
  return {
    floorArea: 20,
    height: 2.8,
    opaqueArea: round6(FACADE_AREA - windowArea),
    opaqueUValue: 0.2,
    thermalBridges: 0.5,
    windows: [
      {
        area: windowArea,
        orientation: { tilt: 90, azimuth: s.azimuth },
        uValue: 1.0,
        gValue: 0.5,
        frameFraction: 0.25,
        // Der Regler stellt g_tot; daraus folgt der Abminderungsfaktor
        // gegenüber der ungeschützten Verglasung.
        shading: s.shading >= 1
          ? { factorClosed: 1, activationIrradiance: Infinity }
          : { factorClosed: round6(s.shading / 0.5), activationIrradiance: 200 },
      },
    ],
    massClass: s.massClass,
    skyModel: s.skyModel,
    airChangeRate: 0.3,
    internalGains: s.gains,
    occupancy: OCCUPANCY,
    nightVentilation: s.nightVentOn && s.nightVent > 0
      ? { airChangeRate: s.nightVent, fromHour: 22, toHour: 6, minIndoorC: 22, minDeltaK: 2 }
      : undefined,
  };
}

// --- Daten laden -------------------------------------------------------------

async function loadYear(stationAbbr, year) {
  const entry = catalog.stations[stationAbbr];
  const meta = entry.years[year];
  const res = await fetch(`data/${meta.path}`);
  if (!res.ok) throw new Error(`${res.status} beim Laden von ${meta.path}`);
  const buffer = await res.arrayBuffer();

  // Prüfsumme gegen den Katalog — dieselbe Prüfung wie im CLI.
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const actual = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (actual !== meta.sha256) {
    throw new Error(`Prüfsumme von ${meta.path} weicht ab: ${actual.slice(0, 12)} statt ${meta.sha256.slice(0, 12)}`);
  }

  const series = readPacked(buffer, meta.sha256);
  const outdoor = getVariable(series, "tre200h0");
  const inputs = [series.source];

  const runningMean = runningMeanOutdoorTemperature(dailyMean(outdoor, series.axis), inputs);
  const band = adaptiveComfortBand(runningMean.value, inputs, { category: CATEGORY });

  return { series, band, runningMean, entry, meta, station: stationAbbr, year: Number(year) };
}

// --- Rechnen und Zeichnen ----------------------------------------------------

async function recompute() {
  const s = readState();
  writeUrl(s);

  const { series, band, entry, meta } = loaded;
  const inputs = [series.source];
  const room = buildRoom(s);

  const t0 = performance.now();
  const simulation = simulate5R1C(room, {
    outdoorTemperature: getVariable(series, "tre200h0"),
    globalHorizontal: getVariable(series, "gre000h0"),
    diffuseHorizontal: series.variables.has("ods000h0") ? getVariable(series, "ods000h0") : undefined,
    downwellingLongwave: series.variables.has("oli000h0") ? getVariable(series, "oli000h0") : undefined,
    axis: series.axis,
    latitude: entry.lat,
    longitude: entry.lon,
  }, inputs);

  // Einschwingphase verwerfen: der Massenknoten startet auf der Aussen-
  // temperatur der ersten Stunde und erinnert sich daran tagelang.
  const skip = warmupHours(room);
  const operative = simulation.value.operativeTemperature.slice();
  operative.fill(NaN, 0, skip);

  const uts = exceedanceHours(operative, series.axis, band.value.upper, inputs, {
    category: CATEGORY,
    occupiedFromHour: OCCUPIED_FROM,
    occupiedToHour: OCCUPIED_TO,
  });
  const elapsed = performance.now() - t0;

  // Tagesmaxima der operativen Temperatur für die Darstellung
  const days = band.value.upper.length;
  const dailyMax = new Float64Array(days).fill(NaN);
  const hoursOver = new Int32Array(days);
  for (let i = 0; i < series.axis.length; i++) {
    const v = operative[i];
    if (!Number.isFinite(v)) continue;
    const d = localDayIndex(series.axis, i);
    if (!(v <= dailyMax[d])) dailyMax[d] = v;
    const hour = new Date(series.axis.startUtcMs + i * 3_600_000).getUTCHours();
    if (Number.isFinite(band.value.upper[d]) && v > band.value.upper[d]) {
      const local = (hour + series.axis.localOffsetMin / 60 + 23) % 24;
      if (local >= OCCUPIED_FROM && local < OCCUPIED_TO) hoursOver[d]++;
    }
  }

  lastResult = { s, simulation, uts, dailyMax, hoursOver, skip, elapsed, band, meta, entry };
  render();
}

function render() {
  const { s, simulation, uts, dailyMax, skip, elapsed, band, entry } = lastResult;

  $("utsValue").textContent = uts.value.hours.toLocaleString("de-CH");
  $("utsNote").textContent = `von ${uts.value.evaluatedHours.toLocaleString("de-CH")} bewerteten Stunden`;
  $("khValue").innerHTML = `${Math.round(uts.value.kelvinHours).toLocaleString("de-CH")}<span class="tile-unit">Kh</span>`;

  const finitePeak = [...dailyMax].filter(Number.isFinite);
  const peak = finitePeak.length ? Math.max(...finitePeak) : NaN;
  $("peakValue").innerHTML = `${peak.toFixed(1)}<span class="tile-unit">°C</span>`;
  $("nvValue").innerHTML = `${simulation.value.nightVentilationHours.toLocaleString("de-CH")}<span class="tile-unit">h</span>`;
  $("shadeNote").textContent = `Sonnenschutz ${simulation.value.shadedHours.toLocaleString("de-CH")} h`;

  $("chartSub").textContent =
    `${entry.name} · ${s.year} · Tagesmaximum gegen die adaptive Komfortgrenze Kat. ${CATEGORY}` +
    ` · erste ${skip} h als Einschwingphase verworfen`;

  const state = { dailyMax, limit: band.value.upper, year: lastResult.meta ? Number(s.year) : 2000 };
  geometry = drawChart($("chart"), state);
  renderTable();
  renderProof(elapsed);
}

function renderTable() {
  const { dailyMax, hoursOver, band, s } = lastResult;
  const body = $("dayTable").querySelector("tbody");
  const rows = [];
  const yearNum = Number(s.year);

  for (let d = 0; d < dailyMax.length; d++) {
    const limit = band.value.upper[d];
    if (!Number.isFinite(limit) || !Number.isFinite(dailyMax[d]) || dailyMax[d] <= limit) continue;
    const date = new Date(Date.UTC(yearNum, 0, 1) + d * 86_400_000);
    rows.push(
      `<tr><td>${date.toLocaleDateString("de-CH", { day: "2-digit", month: "short", timeZone: "UTC" })}</td>` +
        `<td class="over">${dailyMax[d].toFixed(1)}</td>` +
        `<td>${limit.toFixed(1)}</td>` +
        `<td>+${(dailyMax[d] - limit).toFixed(1)}</td>` +
        `<td>${hoursOver[d]}</td></tr>`,
    );
  }
  body.innerHTML = rows.length
    ? rows.join("")
    : `<tr><td colspan="5">Keine Überschreitung im bewerteten Zeitraum.</td></tr>`;
  $("tableDetails").querySelector("summary").textContent =
    `Tabelle der überschrittenen Tage (${rows.length})`;
}

async function renderProof(elapsed) {
  const { simulation, uts, meta, skip } = lastResult;
  const [simHash, utsHash] = await Promise.all([shortHash(simulation), shortHash(uts)]);

  const paramRows = Object.entries(uts.params)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join("");
  const roomRows = Object.entries(simulation.params)
    .map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`)
    .join("");
  const d = simulation.value.derived;

  $("proof").innerHTML = `
    <h3>Verfahren</h3>
    <dl class="kv">
      <dt>Raummodell</dt><dd>${simulation.method.id}@${simulation.method.version}</dd>
      <dt>Herleitung</dt><dd>${simulation.method.doc}</dd>
      <dt>Quellen</dt><dd>${simulation.method.sources.join(", ")}</dd>
      <dt>Bewertung</dt><dd>${uts.method.id}@${uts.method.version}</dd>
      <dt>Herleitung</dt><dd>${uts.method.doc}</dd>
      <dt>Quellen</dt><dd>${uts.method.sources.join(", ")}</dd>
    </dl>

    <h3>Berechnungs-Hash</h3>
    <dl class="kv">
      <dt>Simulation</dt><dd>${simHash}</dd>
      <dt>Übertemperaturstunden</dt><dd>${utsHash}</dd>
    </dl>

    <h3>Abgeleitete Kenngrössen</h3>
    <dl class="kv">
      <dt>A_m wirksame Speicherfläche</dt><dd>${d.effectiveMassArea.toFixed(1)} m²</dd>
      <dt>C_m Speicherfähigkeit</dt><dd>${(d.effectiveCapacity / 1e6).toFixed(2)} MJ/K</dd>
      <dt>H_tr,w Fenster</dt><dd>${d.windowConductance.toFixed(2)} W/K</dd>
      <dt>H_tr,op opak</dt><dd>${d.opaqueConductance.toFixed(2)} W/K</dd>
      <dt>H_tr,em Masse ↔ aussen</dt><dd>${d.externalMassConductance.toFixed(2)} W/K</dd>
      <dt>Einschwingphase</dt><dd>${skip} h verworfen</dd>
      <dt>Belegte Stunden</dt><dd>${simulation.value.occupiedHours}</dd>
      <dt>Himmelstemperatur</dt><dd>${simulation.value.longwaveSource}</dd>
      <dt>Ø Abstrahlungsverlust</dt><dd>${meanFinite(simulation.value.skyLoss).toFixed(1)} W</dd>
    </dl>

    <h3>Parameter Raummodell</h3>
    <dl class="kv">${roomRows}</dl>

    <h3>Parameter Bewertung</h3>
    <dl class="kv">${paramRows}</dl>

    <h3>Eingangsdaten</h3>
    <dl class="kv">
      <dt>Collection</dt><dd>${simulation.inputs[0].collection}</dd>
      <dt>Station / Jahr</dt><dd>${simulation.inputs[0].station} / ${simulation.inputs[0].year}</dd>
      <dt>Variablen</dt><dd>${simulation.inputs[0].variables.join(", ")}</dd>
      <dt>SHA-256</dt><dd>${meta.sha256}</dd>
      <dt>Lizenz</dt><dd>${simulation.inputs[0].license}</dd>
      <dt>Quellenangabe</dt><dd>${simulation.inputs[0].attribution}</dd>
    </dl>

    <p style="color: var(--ink-muted); margin-top: 16px">
      Gerechnet im Browser in ${elapsed.toFixed(0)} ms — derselbe Rechenkern wie im CLI und in den Tests.
    </p>`;
}

function meanFinite(values) {
  let sum = 0;
  let n = 0;
  for (const v of values) if (Number.isFinite(v)) { sum += v; n++; }
  return n ? sum / n : 0;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// --- Zeigerinteraktion -------------------------------------------------------

function setupHover() {
  const canvas = $("chart");
  const tip = $("tooltip");

  canvas.addEventListener("pointermove", (event) => {
    if (!geometry || !lastResult) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const { plot, n } = geometry;
    if (x < plot.x || x > plot.x + plot.w) return hideTip();

    const day = Math.round(((x - plot.x) / plot.w) * (n - 1));
    const { dailyMax, band, hoursOver, s } = lastResult;
    const value = dailyMax[day];
    const limit = band.value.upper[day];
    if (!Number.isFinite(value)) return hideTip();

    drawChart(canvas, { dailyMax, limit: band.value.upper, year: Number(s.year) });
    drawCrosshair(canvas, geometry, { dailyMax, limit: band.value.upper }, day);

    const date = new Date(Date.UTC(Number(s.year), 0, 1) + day * 86_400_000);
    const over = Number.isFinite(limit) && value > limit;
    tip.innerHTML =
      `<b>${date.toLocaleDateString("de-CH", { day: "2-digit", month: "long", timeZone: "UTC" })}</b>` +
      `<div class="row"><span>θ_op max</span><span>${value.toFixed(1)} °C</span></div>` +
      (Number.isFinite(limit)
        ? `<div class="row"><span>Grenze</span><span>${limit.toFixed(1)} °C</span></div>` +
          (over
            ? `<div class="row"><span>Überschreitung</span><span>+${(value - limit).toFixed(1)} K, ${hoursOver[day]} h</span></div>`
            : "")
        : `<div class="row"><span>Grenze</span><span>nicht definiert</span></div>`);

    tip.classList.add("on");
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(geometry.xOf(day) - tw / 2, 0), canvas.clientWidth - tw)}px`;
    tip.style.top = `${plot.y}px`;
  });

  canvas.addEventListener("pointerleave", () => {
    hideTip();
    if (lastResult) render();
  });

  function hideTip() {
    tip.classList.remove("on");
  }
}

// --- Darstellung -------------------------------------------------------------

/**
 * Auto → Hell → Dunkel. "Auto" folgt der Systemeinstellung und setzt kein
 * data-theme; die beiden anderen setzen es ausdrücklich und gewinnen damit
 * gegen die Media Query — in beide Richtungen.
 */
function setupTheme() {
  const button = $("theme");
  const labels = { auto: "Auto", light: "Hell", dark: "Dunkel" };
  const order = ["auto", "light", "dark"];

  const apply = (mode) => {
    if (mode === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    button.textContent = labels[mode];
    localStorage.setItem("ocbl-theme", mode);
    if (lastResult) render();
  };

  apply(localStorage.getItem("ocbl-theme") ?? "auto");
  button.addEventListener("click", () => {
    const current = localStorage.getItem("ocbl-theme") ?? "auto";
    apply(order[(order.indexOf(current) + 1) % order.length]);
  });
}

// --- Start -------------------------------------------------------------------

function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(async () => {
    pending = false;
    try {
      await recompute();
    } catch (error) {
      statusEl.hidden = false;
      statusEl.className = "status error";
      statusEl.textContent = String(error.message ?? error);
    }
  });
}

function fillSelect(select, values, current) {
  select.innerHTML = values.map((v) => `<option value="${v}">${v}</option>`).join("");
  if (current && values.includes(current)) select.value = current;
}

async function reloadData() {
  const station = $("station").value;
  fillSelect($("year"), Object.keys(catalog.stations[station].years).sort(), $("year").value);
  loaded = await loadYear(station, $("year").value);
  schedule();
}

async function main() {
  try {
    catalog = await fetch("data/catalog.json").then((r) => {
      if (!r.ok) throw new Error("data/catalog.json nicht gefunden — scripts/build-web.sh ausführen");
      return r.json();
    });

    const stations = Object.keys(catalog.stations).sort();
    $("station").innerHTML = stations
      .map((a) => `<option value="${a}">${a} — ${catalog.stations[a].name}</option>`)
      .join("");

    const fromUrl = readUrl();
    if (fromUrl?.station && stations.includes(fromUrl.station)) $("station").value = fromUrl.station;
    fillSelect($("year"), Object.keys(catalog.stations[$("station").value].years).sort(), fromUrl?.year);
    if (fromUrl) applyState(fromUrl);

    loaded = await loadYear($("station").value, $("year").value);

    for (const id of ["azimuth", "massClass", "skyModel", "windowFraction", "shading", "gains", "nightVent", "nightVentOn"]) {
      $(id).addEventListener("input", () => {
        syncLabels();
        schedule();
      });
    }
    $("station").addEventListener("change", () => reloadData().catch(showError));
    $("year").addEventListener("change", () => reloadData().catch(showError));
    window.addEventListener("resize", () => lastResult && render());
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => lastResult && render());

    setupHover();
    setupTheme();
    syncLabels();

    $("footer").innerHTML =
      `Daten: ${catalog.attribution} · ${catalog.license} · Katalogstand ${catalog.generated}. ` +
      `Code unter Apache-2.0. Methoden in <code>docs/methods/</code>.`;

    statusEl.hidden = true;
    $("app").hidden = false;
    await recompute();
  } catch (error) {
    showError(error);
  }
}

function showError(error) {
  statusEl.hidden = false;
  statusEl.className = "status error";
  statusEl.textContent = String(error.message ?? error);
}

function syncLabels() {
  $("windowFractionValue").textContent = `${$("windowFraction").value} %`;
  $("shadingValue").textContent = Number($("shading").value) >= 1 ? "kein Schutz" : Number($("shading").value).toFixed(2);
  $("gainsValue").textContent = `${$("gains").value} W/m²`;
  $("nightVentValue").textContent = $("nightVentOn").checked
    ? `${Number($("nightVent").value).toFixed(1)} 1/h`
    : "aus";
}

main();
