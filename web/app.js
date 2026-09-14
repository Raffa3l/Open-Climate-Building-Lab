/**
 * Open Climate Building Lab — Frontend.
 *
 * Der Rechenkern ist derselbe, der im CLI und in den Tests läuft: aus
 * core/src, per tsc nach ESM übersetzt (ADR 0006). Es gibt keine zweite
 * Implementierung im Browser — genau darum ist «Berechnung anzeigen» kein
 * nachträglicher Anbau, sondern die Rückgabe der Funktion selbst.
 */

import {
  REFERENCE_EVALUATION,
  alignDailyToCalendarYear,
  citations,
  climateLabel,
  climateShortLabel,
  evaluateReferenceCase,
  isScenarioKey,
  localDayIndex,
  peakOperativeTemperature,
  readPacked,
  referenceCaseExport,
  referenceComfortBand,
  roomSettingsToParams,
  shortHash,
} from "./vendor/core/index.js";
import { drawChart, drawCrosshair } from "./chart.js";

// Raum, Belegungsfenster und Permalink-Lesart liegen im Kern
// (core/src/reference-case.ts), damit der CLI-Export denselben Fall rechnet.
const CATEGORY = REFERENCE_EVALUATION.category;

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

let catalog = null;
let scenarios = null;
let loaded = null;          // Basis-Klimastand
let comparedTo = null;      // zweiter Klimastand oder null
let geometry = null;
let lastResult = null;
let pending = false;

// --- Zustand aus den Bedienelementen ----------------------------------------

function readState() {
  return {
    station: $("station").value,
    year: $("year").value,
    compare: $("compare").value,
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
  const p = new URLSearchParams([["station", s.station], ["year", s.year], ...roomSettingsToParams(s)]);
  // Ohne Vergleich bleibt der Schlüssel weg, damit alte Links unverändert
  // dieselbe Adresse ergeben wie zuvor.
  if (s.compare) p.set("compare", s.compare);
  history.replaceState(null, "", `#${p}`);
}

function readUrl() {
  if (!location.hash.startsWith("#")) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  return p.size ? Object.fromEntries(p) : null;
}

// --- Daten laden -------------------------------------------------------------

/** Detailindizes, gecacht — die Hauptkataloge tragen sie nicht mehr. */
const indexCache = new Map();

async function detailIndex(path) {
  if (!indexCache.has(path)) {
    const res = await fetch(`data/${path}`);
    if (!res.ok) throw new Error(`Index data/${path} nicht ladbar (${res.status})`);
    indexCache.set(path, await res.json());
  }
  return indexCache.get(path);
}

/**
 * Alle wählbaren Klimastände einer Station: gemessene Jahre und, wo
 * vorhanden, die DRY-Szenarien. Der Wert trägt ein Präfix, damit beide
 * Quellen in einem Auswahlfeld nebeneinander stehen können.
 */
function climateOptions(stationAbbr) {
  const options = [];
  const measured = catalog.stations[stationAbbr];
  // Nur Jahre mit Temperatur und Globalstrahlung. Viele Stationen messen die
  // Strahlung erst seit etwa 2010; ein früheres Jahr bräche beim Laden ab.
  for (const year of [...measured.roomModelYears].sort((a, b) => b - a)) {
    options.push({ value: `y${year}`, label: `gemessen ${year}` });
  }
  const scen = scenarios?.stations?.[stationAbbr];
  if (scen) {
    // Beschriftung aus dem Kürzel statt aus dem Detailindex: Der Katalog trägt
    // nur die Kürzel, und ein Ladevorgang nur für Beschriftungen wäre Verschwendung.
    for (const slug of scen.variants) options.push({ value: `s${slug}`, label: climateLabel(`s${slug}`) });
  }
  return options;
}

async function loadClimate(stationAbbr, key) {
  const isScenario = isScenarioKey(key);
  const entry = isScenario ? scenarios.stations[stationAbbr] : catalog.stations[stationAbbr];
  if (!entry) throw new Error(`${stationAbbr} hat keinen Datensatz für ${key}`);

  const meta = (await detailIndex(entry.index))[key.slice(1)];
  if (!meta) throw new Error(`${stationAbbr} ${key.slice(1)} nicht im Index`);
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

  return {
    // Das Komfortband hängt nur am Klima und wird je Klimastand einmal gerechnet.
    series, band: referenceComfortBand(series), meta, station: stationAbbr, isScenario, key,
    // Für die Anzeige immer die Messstation: Name, Kanton und Höhe stammen
    // aus dem SwissMetNet-Verzeichnis, die Szenariometadaten weichen ab.
    entry: catalog.stations[stationAbbr] ?? entry,
    // Nicht `meta.label` aus dem Index: der schreibt "RCP85", das Auswahlfeld
    // "RCP 8.5". Nebeneinander gestellt fiele die Doppelschreibweise auf.
    label: climateLabel(key),
    short: climateShortLabel(key),
    // Das Referenzjahr der Szenarien liegt auf einem Nicht-Schaltjahr.
    calendarYear: new Date(series.axis.startUtcMs).getUTCFullYear(),
  };
}

// --- Rechnen -----------------------------------------------------------------

/**
 * Ein Klimastand, ein Raum, eine Auswertung.
 *
 * Der Vergleich ruft dieselbe Funktion ein zweites Mal mit demselben `s` auf:
 * Es unterscheidet sich ausschliesslich das Aussenklima. Wären es zwei
 * Rechenwege, wäre die Differenz nicht mehr dem Klima zuzuschreiben.
 */
function evaluate(climate, s) {
  const { series, band, entry } = climate;
  const { simulation, exceedance: uts } = evaluateReferenceCase(series, entry, s, band);

  // Die Simulation rechnet einen Vorlauf aus dem Jahresende (ADR 0008);
  // verworfen wird nur, was er nicht abdeckt, im Normalfall nichts. Für die
  // Tagesmaxima im Diagramm wird dieselbe Stundenzahl hier ausgeblendet.
  const skip = uts.params.warmupHours;
  const operative = simulation.value.operativeTemperature.slice();
  operative.fill(NaN, 0, skip);

  // Tagesmaxima der operativen Temperatur für die Darstellung. Die Stunden
  // über der Grenze je Tag kommen aus exceedanceHours() selbst: Hier
  // nachgezählt, stimmten sie bei den Szenarien nicht mit der Kennzahl überein,
  // weil die Lokalstunde aus dem Stempel statt aus dem Stichzeitpunkt kam.
  const days = band.value.upper.length;
  const dailyMax = new Float64Array(days).fill(NaN);
  for (let i = 0; i < series.axis.length; i++) {
    const v = operative[i];
    if (!Number.isFinite(v)) continue;
    const d = localDayIndex(series.axis, i);
    if (!(v <= dailyMax[d])) dailyMax[d] = v;
  }
  const hoursOver = uts.value.dailyHours;

  return {
    climate, simulation, uts, dailyMax, hoursOver, skip,
    limit: band.value.upper,
    // Aus dem Kern, derselbe Wert wie im Manifest des Downloads.
    peak: peakOperativeTemperature(uts),
  };
}

async function recompute() {
  const s = readState();
  writeUrl(s);

  const t0 = performance.now();
  const base = evaluate(loaded, s);
  const other = comparedTo ? evaluate(comparedTo, s) : null;
  const elapsed = performance.now() - t0;

  // Die Vergleichsreihe wird für die Darstellung auf die Tagesachse der Basis
  // gelegt; gerechnet wurde sie auf ihrer eigenen. Die Abbildung geht über
  // (Monat, Tag) und liegt im Kern — ein DRY hat 365 Tage, ein Messjahr
  // möglicherweise 366.
  let aligned = null;
  if (other) {
    const align = (values) => alignDailyToCalendarYear(
      values, other.climate.calendarYear, base.climate.calendarYear, base.dailyMax.length,
    );
    aligned = { dailyMax: align(other.dailyMax), limit: align(other.limit), hoursOver: align(other.hoursOver) };
  }

  lastResult = { s, base, other, aligned, elapsed };
  render();
}

// --- Darstellen --------------------------------------------------------------

function render() {
  const { base, other, aligned, elapsed } = lastResult;
  const entry = base.climate.entry;

  renderTiles();

  $("chartSub").textContent =
    `${entry.name} (${entry.canton}, ${Math.round(entry.altitudeM)} m ü. M.) · ${base.climate.label}` +
    (other ? ` gegen ${other.climate.label}` : "") +
    ` · Tagesmaximum gegen die adaptive Komfortgrenze Kat. ${CATEGORY}` +
    ` · eingeschwungen durch ${base.simulation.value.spinUpHours} h Vorlauf aus dem Jahresende` +
    (base.skip > 0 ? `, erste ${base.skip} h verworfen` : "");

  renderNote();
  renderLegend();

  geometry = drawChart($("chart"), {
    dailyMax: base.dailyMax,
    limit: base.limit,
    year: base.climate.calendarYear,
    compare: aligned,
  });

  renderTable();
  renderProof(elapsed);
  renderDownloads();
}

/** Vorzeichenbehaftete Differenz, deutsch gesetzt. */
function signed(value, digits = 0) {
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return sign + Math.abs(rounded).toLocaleString("de-CH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function renderTiles() {
  const { base, other } = lastResult;

  $("utsValue").textContent = base.uts.value.hours.toLocaleString("de-CH");
  $("utsNote").textContent = `von ${base.uts.value.evaluatedHours.toLocaleString("de-CH")} bewerteten Stunden`;
  $("khValue").innerHTML = `${Math.round(base.uts.value.kelvinHours).toLocaleString("de-CH")}<span class="tile-unit">Kh</span>`;
  $("peakValue").innerHTML = `${base.peak.toFixed(1)}<span class="tile-unit">°C</span>`;
  $("nvValue").innerHTML = `${base.simulation.value.nightVentilationHours.toLocaleString("de-CH")}<span class="tile-unit">h</span>`;
  $("shadeNote").textContent = `Sonnenschutz ${base.simulation.value.shadedHours.toLocaleString("de-CH")} h`;

  const deltas = [
    ["utsDelta", other && other.uts.value.hours, other && other.uts.value.hours - base.uts.value.hours, 0, "h"],
    ["khDelta", other && Math.round(other.uts.value.kelvinHours),
      other && Math.round(other.uts.value.kelvinHours) - Math.round(base.uts.value.kelvinHours), 0, "Kh"],
    ["peakDelta", other && other.peak, other && other.peak - base.peak, 1, "°C"],
    ["nvDelta", other && other.simulation.value.nightVentilationHours,
      other && other.simulation.value.nightVentilationHours - base.simulation.value.nightVentilationHours, 0, "h"],
  ];

  for (const [id, value, diff, digits, unit] of deltas) {
    const el = $(id);
    el.hidden = !other;
    if (!other) continue;
    el.innerHTML =
      `<span class="dot"></span>` +
      `<span>${value.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}</span>` +
      `<span class="diff">${signed(diff, digits)}</span>`;
  }
}

/**
 * Der Hinweis erscheint nur, wo er gebraucht wird: beim Vergleich eines
 * Messjahres mit einem Szenario. Ein DRY ist kein Mittel gemessener Jahre,
 * und einzelne Messjahre sind keine Normalperiode — die Differenz beider
 * Reihen ist damit kein Klimasignal.
 */
function renderNote() {
  const { base, other } = lastResult;
  const el = $("compareNote");
  const mixed = other && base.climate.isScenario !== other.climate.isScenario;
  el.hidden = !mixed;
  if (!mixed) return;
  el.innerHTML =
    `<strong>Gemessenes Jahr gegen Szenario.</strong> Ein Design Reference Year ist ein ` +
    `synthetisches typisches Jahr, kein Mittel gemessener Jahre, und CH2018 ist auf eine ` +
    `ältere Referenzperiode kalibriert. Gegen ein einzelnes warmes Messjahr (2022 und 2023 ` +
    `waren Rekordjahre) kann ein Szenario deshalb kühler ausfallen. Belastbar ist der ` +
    `Vergleich <em>innerhalb</em> des Szenariensatzes, etwa 2035 gegen 2060 bei gleichem RCP.`;
}

function renderLegend() {
  const { base, other } = lastResult;
  const items = [
    `<span class="legend-item"><span class="swatch" style="background: var(--series-1)"></span>` +
      `${escapeHtml(base.climate.short)}, Tagesmaximum</span>`,
    `<span class="legend-item"><span class="swatch dashed"></span>Komfortgrenze` +
      `${other ? ` ${escapeHtml(base.climate.short)}` : " EN 16798-1 Kat. II"}</span>`,
    `<span class="legend-item"><span class="swatch area" style="background: var(--status-serious)"></span>` +
      `Überschreitung${other ? ` ${escapeHtml(base.climate.short)}` : ""}</span>`,
  ];
  if (other) {
    items.push(
      `<span class="legend-item"><span class="swatch" style="background: var(--series-2)"></span>` +
        `${escapeHtml(other.climate.short)}, Tagesmaximum</span>`,
      `<span class="legend-item"><span class="swatch dotted"></span>Komfortgrenze ` +
        `${escapeHtml(other.climate.short)}</span>`,
    );
  }
  $("legend").innerHTML = items.join("");
}

function renderTable() {
  const { base, other, aligned } = lastResult;
  const head = $("dayHead");
  const body = $("dayTable").querySelector("tbody");
  const year = base.climate.calendarYear;

  head.innerHTML = other
    ? `<tr><th></th><th colspan="3">${escapeHtml(base.climate.short)}</th>` +
      `<th colspan="3" class="split">${escapeHtml(other.climate.short)}</th></tr>` +
      `<tr><th>Datum</th><th>θ_op max</th><th>Grenze</th><th>h &gt;</th>` +
      `<th class="split">θ_op max</th><th>Grenze</th><th>h &gt;</th></tr>`
    : `<tr><th>Datum</th><th>θ_op max</th><th>Grenze</th><th>Δ</th><th>Stunden über Grenze</th></tr>`;

  const num = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : "—");
  // Tagesstunden sind NaN, wo an diesem Tag keine Stunde bewertet wurde.
  const hrs = (v) => (Number.isFinite(v) ? String(v) : "–");
  const rows = [];

  for (let d = 0; d < base.dailyMax.length; d++) {
    const over = (max, limit) => Number.isFinite(limit) && Number.isFinite(max) && max > limit;
    const baseOver = over(base.dailyMax[d], base.limit[d]);
    const otherOver = aligned && over(aligned.dailyMax[d], aligned.limit[d]);
    // Im Vergleich zählt jeder Tag, an dem eine der beiden Reihen überschreitet
    // — sonst verschwänden gerade die Tage, die das Szenario hinzufügt.
    if (!baseOver && !otherOver) continue;

    const date = new Date(Date.UTC(year, 0, 1) + d * 86_400_000);
    const day = date.toLocaleDateString("de-CH", { day: "2-digit", month: "short", timeZone: "UTC" });

    rows.push(other
      ? `<tr><td>${day}</td>` +
        `<td${baseOver ? ' class="over"' : ""}>${num(base.dailyMax[d])}</td>` +
        `<td>${num(base.limit[d])}</td><td>${baseOver ? hrs(base.hoursOver[d]) : "–"}</td>` +
        `<td class="split${otherOver ? " over" : ""}">${num(aligned.dailyMax[d])}</td>` +
        `<td>${num(aligned.limit[d])}</td><td>${otherOver ? hrs(aligned.hoursOver[d]) : "–"}</td></tr>`
      : `<tr><td>${day}</td><td class="over">${num(base.dailyMax[d])}</td>` +
        `<td>${num(base.limit[d])}</td>` +
        `<td>+${(base.dailyMax[d] - base.limit[d]).toFixed(1)}</td>` +
        `<td>${hrs(base.hoursOver[d])}</td></tr>`);
  }

  const columns = other ? 7 : 5;
  body.innerHTML = rows.length
    ? rows.join("")
    : `<tr><td colspan="${columns}">Keine Überschreitung im bewerteten Zeitraum.</td></tr>`;
  $("tableDetails").querySelector("summary").textContent =
    `Tabelle der überschrittenen Tage (${rows.length})`;
}

async function renderProof(elapsed) {
  const { base, other } = lastResult;
  const { simulation, uts, skip } = base;
  const entry = base.climate.entry;

  const hashes = await Promise.all([
    shortHash(simulation), shortHash(uts),
    ...(other ? [shortHash(other.simulation), shortHash(other.uts)] : []),
  ]);
  const [simHash, utsHash, otherSimHash, otherUtsHash] = hashes;

  const paramRows = Object.entries(uts.params)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join("");
  const roomRows = Object.entries(simulation.params)
    .map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`)
    .join("");
  const d = simulation.value.derived;

  const dataset = (result) => `
    <dl class="kv">
      <dt>Collection</dt><dd>${result.simulation.inputs[0].collection}</dd>
      <dt>Station / Jahr</dt><dd>${result.simulation.inputs[0].station} / ${result.simulation.inputs[0].year}</dd>
      <dt>Variablen</dt><dd>${result.simulation.inputs[0].variables.join(", ")}</dd>
      <dt>SHA-256</dt><dd>${result.climate.meta.sha256}</dd>
      <dt>Lizenz</dt><dd>${result.simulation.inputs[0].license}</dd>
    </dl>`;

  const scenarioHint = `<p style="margin:0 0 12px; color: var(--ink-secondary)">
      <strong>Szenariodaten.</strong> Ein Design Reference Year ist ein synthetisches
      typisches Jahr, kein Mittel gemessener Jahre. Gegen einzelne warme Messjahre
      verglichen kann es kühler ausfallen — belastbar sind vor allem Vergleiche
      innerhalb des Szenariensatzes.
    </p>`;

  $("proof").innerHTML = `
    ${base.climate.isScenario || other?.climate.isScenario ? scenarioHint : ""}

    ${other ? `<p style="margin:0 0 12px; color: var(--ink-secondary)">
      <strong>Vergleich.</strong> Beide Reihen rechnen denselben Raum mit denselben
      Parametern; verschieden ist allein das Aussenklima. Jede Reihe hat ihre eigene
      adaptive Komfortgrenze: Das Band folgt dem gleitenden Mittel der
      Aussentemperatur und liegt im wärmeren Klimastand höher.
    </p>` : ""}

    <h3>Verfahren</h3>
    <dl class="kv">
      <dt>Raummodell</dt><dd>${simulation.method.id}@${simulation.method.version}</dd>
      <dt>Herleitung</dt><dd>${simulation.method.doc}</dd>
      <dt>Quellen</dt><dd>${simulation.method.sources.join(", ")}</dd>
      <dt>Bewertung</dt><dd>${uts.method.id}@${uts.method.version}</dd>
      <dt>Herleitung</dt><dd>${uts.method.doc}</dd>
      <dt>Quellen</dt><dd>${uts.method.sources.join(", ")}</dd>
    </dl>

    <h3>Berechnungs-Hash${other ? ` · ${escapeHtml(base.climate.short)}` : ""}</h3>
    <dl class="kv">
      <dt>Simulation</dt><dd>${simHash}</dd>
      <dt>Übertemperaturstunden</dt><dd>${utsHash}</dd>
    </dl>

    ${other ? `<h3>Berechnungs-Hash · ${escapeHtml(other.climate.short)}</h3>
    <dl class="kv">
      <dt>Simulation</dt><dd>${otherSimHash}</dd>
      <dt>Übertemperaturstunden</dt><dd>${otherUtsHash}</dd>
    </dl>` : ""}

    <h3>Abgeleitete Kenngrössen</h3>
    <dl class="kv">
      <dt>A_m wirksame Speicherfläche</dt><dd>${d.effectiveMassArea.toFixed(1)} m²</dd>
      <dt>C_m Speicherfähigkeit</dt><dd>${(d.effectiveCapacity / 1e6).toFixed(2)} MJ/K</dd>
      <dt>H_tr,w Fenster</dt><dd>${d.windowConductance.toFixed(2)} W/K</dd>
      <dt>H_tr,op opak</dt><dd>${d.opaqueConductance.toFixed(2)} W/K</dd>
      <dt>H_tr,em Masse ↔ aussen</dt><dd>${d.externalMassConductance.toFixed(2)} W/K</dd>
      <dt>Vorlauf</dt><dd>${simulation.value.spinUpHours} h aus dem Ende der Reihe${skip > 0 ? `, zusätzlich ${skip} h verworfen` : ", nichts verworfen"}</dd>
      <dt>Belegte Stunden</dt><dd>${simulation.value.occupiedHours}</dd>
      <dt>Diffusstrahlung</dt><dd>${base.climate.series.variables.has("ods000h0") ? "gemessen" : "aus Globalstrahlung nach Erbs (1982)"}</dd>
      <dt>Himmelstemperatur</dt><dd>${simulation.value.longwaveSource === "gemessen" ? "gemessen" : "Pauschalwert der Norm"}</dd>
      <dt>Ø Abstrahlungsverlust</dt><dd>${meanFinite(simulation.value.skyLoss).toFixed(1)} W</dd>
    </dl>

    <h3>Parameter Raummodell</h3>
    <dl class="kv">${roomRows}</dl>

    <h3>Parameter Bewertung</h3>
    <dl class="kv">${paramRows}</dl>

    <h3>Eingangsdaten${other ? ` · ${escapeHtml(base.climate.short)}` : ""}</h3>
    ${dataset(base)}

    ${other ? `<h3>Eingangsdaten · ${escapeHtml(other.climate.short)}</h3>${dataset(other)}` : ""}

    <h3>Quellenangabe</h3>
    <p style="margin: 0 0 4px">Bei Weiterverwendung vollständig mitführen:</p>
    <dl class="kv">
      ${[...new Set([...citations(simulation), ...(other ? citations(other.simulation) : [])])]
        .map((c) => `<dt>Datensatz</dt><dd>${escapeHtml(c)}</dd>`).join("")}
    </dl>

    <p style="color: var(--ink-muted); margin-top: 16px">
      ${(other ? 2 : 1) * simulation.value.operativeTemperature.length} Stunden im Browser gerechnet in
      ${elapsed < 1 ? elapsed.toFixed(2) : elapsed.toFixed(0)} ms — derselbe Rechenkern wie im CLI und in den Tests.
    </p>`;
}

// --- Download ----------------------------------------------------------------

/**
 * Baut CSV und Manifest für einen Klimastand.
 *
 * Getrennt vom Speichern, damit dieselben Bytes auch ohne Browser prüfbar
 * sind. Zusammenstellung und Serialisierung liegen im Kern; derselbe Aufruf
 * steckt in core/scripts/export.ts, siehe docs/methods/010-export.md.
 */
function buildExport(result, s) {
  const { climate, uts } = result;
  return referenceCaseExport({
    station: climate.station,
    stationInfo: climate.entry,
    climateKey: climate.key,
    settings: s,
    series: climate.series,
    exceedance: uts,
  });
}

function saveFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Sofort freigegeben, bricht der Download in manchen Browsern ab.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderDownloads() {
  const { base, other } = lastResult;
  const row = (which, result) => `
    <div class="download-row">
      <span class="download-label">${escapeHtml(result.climate.label)}</span>
      <button type="button" class="download" data-which="${which}" data-kind="csv">Stundenreihe (CSV)</button>
      <button type="button" class="download" data-which="${which}" data-kind="json">Nachweis (JSON)</button>
    </div>`;
  $("downloads").innerHTML =
    `<p class="download-note">Jede Stunde des Jahres mit Raum- und Aussentemperatur, Komfortgrenze ` +
    `und Überschreitung. Dazu ein Manifest mit Hashes, kanonischer Form und Quellenangaben, ` +
    `mit dem sich die Zahlen ohne dieses Projekt nachprüfen lassen. ` +
    `Format und Prüfanleitung: <code>docs/methods/010-export.md</code>.</p>` +
    row("base", base) +
    (other ? row("other", other) : "");
}

function setupDownloads() {
  // Ein Listener am Container: renderDownloads() ersetzt die Knöpfe bei jedem
  // Neurechnen, einzelne Listener gingen dabei verloren.
  $("downloads").addEventListener("click", async (event) => {
    const button = event.target.closest?.("button[data-kind]");
    if (!button || !lastResult) return;
    const result = button.dataset.which === "other" ? lastResult.other : lastResult.base;
    if (!result) return;
    button.disabled = true;
    try {
      const files = await buildExport(result, lastResult.s);
      if (button.dataset.kind === "csv") saveFile(files.csvName, files.csv, "text/csv;charset=utf-8");
      else saveFile(files.jsonName, files.json, "application/json");
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  });
}

function meanFinite(values) {
  let sum = 0;
  let n = 0;
  for (const v of values) if (Number.isFinite(v)) { sum += v; n++; }
  return n ? sum / n : 0;
}

/**
 * "2026-09-14T17:59:29+00:00" → "14.09.2026".
 *
 * In Zürcher Zeit statt UTC: Ein Katalog, gebaut kurz nach Mitternacht, trüge
 * sonst das Datum des Vortags. Nur für Anzeigen; Messdaten folgen weiterhin dem
 * festen Offset ohne Sommerzeit (docs/methods/000-time-conventions.md).
 */
function swissDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Zurich" });
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
    const { base, other, aligned } = lastResult;
    const value = base.dailyMax[day];
    const limit = base.limit[day];
    if (!Number.isFinite(value)) return hideTip();

    const state = {
      dailyMax: base.dailyMax, limit: base.limit,
      year: base.climate.calendarYear, compare: aligned,
    };
    drawChart(canvas, state);
    drawCrosshair(canvas, geometry, state, day);

    const date = new Date(Date.UTC(base.climate.calendarYear, 0, 1) + day * 86_400_000);
    const over = Number.isFinite(limit) && value > limit;
    const row = (label, text) => `<div class="row"><span>${label}</span><span>${text}</span></div>`;

    const head = (label) => `<div class="head">${escapeHtml(label)}</div>`;
    let html = `<b>${date.toLocaleDateString("de-CH", { day: "2-digit", month: "long", timeZone: "UTC" })}</b>`;
    if (other) html += head(base.climate.short);
    html += row("θ_op max", `${value.toFixed(1)} °C`);
    html += Number.isFinite(limit) ? row("Grenze", `${limit.toFixed(1)} °C`) : row("Grenze", "nicht definiert");
    const hoursText = (v) => (Number.isFinite(v) ? `, ${v} h` : "");
    if (over) html += row("Überschreitung", `+${(value - limit).toFixed(1)} K${hoursText(base.hoursOver[day])}`);

    if (other) {
      const v2 = aligned.dailyMax[day];
      const l2 = aligned.limit[day];
      html += head(other.climate.short);
      html += row("θ_op max", Number.isFinite(v2) ? `${v2.toFixed(1)} °C` : "—");
      if (Number.isFinite(v2)) {
        html += row("Grenze", Number.isFinite(l2) ? `${l2.toFixed(1)} °C` : "nicht definiert");
        if (Number.isFinite(l2) && v2 > l2) {
          html += row("Überschreitung", `+${(v2 - l2).toFixed(1)} K${hoursText(aligned.hoursOver[day])}`);
        }
        html += row("Δ θ_op max", `${signed(v2 - value, 1)} K`);
      }
    }

    tip.innerHTML = html;
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
      showError(error);
    }
  });
}

function fillClimateSelect(stationAbbr, keep) {
  const options = climateOptions(stationAbbr);
  $("year").innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
  if (keep && options.some((o) => o.value === keep)) $("year").value = keep;
}

/**
 * Der Vergleich bietet dieselben Klimastände an, ohne den bereits gewählten:
 * ein Klimastand gegen sich selbst ergäbe zwei deckungsgleiche Kurven.
 */
function fillCompareSelect(stationAbbr, keep) {
  const options = climateOptions(stationAbbr).filter((o) => o.value !== $("year").value);
  $("compare").innerHTML =
    `<option value="">kein Vergleich</option>` +
    options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
  $("compare").value = keep && options.some((o) => o.value === keep) ? keep : "";
}

async function reloadData() {
  const station = $("station").value;
  const wanted = $("compare").value;
  fillClimateSelect(station, $("year").value);
  fillCompareSelect(station, wanted);

  statusEl.hidden = false;
  statusEl.className = "status";
  statusEl.textContent = "Daten werden geladen …";
  try {
    loaded = await loadClimate(station, $("year").value);
    comparedTo = $("compare").value ? await loadClimate(station, $("compare").value) : null;
  } finally {
    statusEl.hidden = true;
  }
  schedule();
}

/**
 * Nur Stationen, an denen das Raummodell überhaupt rechenbar ist.
 *
 * Von 158 SwissMetNet-Stationen messen 132 die Globalstrahlung; neun sind
 * reine Wind- oder Strahlungsmessstellen. Sie anzubieten und dann ein leeres
 * Diagramm zu zeigen wäre schlechter als sie wegzulassen.
 */
function usableStations() {
  return Object.entries(catalog.stations)
    .filter(([, e]) => e.capabilities.roomModel)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name, "de-CH"));
}

async function main() {
  try {
    catalog = await fetch("data/catalog.json").then((r) => {
      if (!r.ok) throw new Error("data/catalog.json nicht gefunden — scripts/build-web.sh ausführen");
      return r.json();
    });
    // Szenarien sind optional: ohne sie funktioniert alles ausser der Zukunft.
    scenarios = await fetch("data/scenarios.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);

    const usable = usableStations();
    const stations = usable.map(([abbr]) => abbr);
    $("station").innerHTML = usable
      .map(([abbr, e]) => `<option value="${abbr}">${e.name} (${e.canton}, ${Math.round(e.altitudeM)} m)</option>`)
      .join("");
    $("station").value = stations.includes("SMA") ? "SMA" : stations[0];

    const fromUrl = readUrl();
    if (fromUrl?.station && stations.includes(fromUrl.station)) $("station").value = fromUrl.station;
    fillClimateSelect($("station").value, fromUrl?.year);
    fillCompareSelect($("station").value, fromUrl?.compare);
    // Station, Klimastand und Vergleich sind oben schon gegen die Auswahl
    // geprüft. Hier nochmals gesetzt, leerte ein Wert, den es nicht gibt, das
    // Feld: Ein Link auf St. Chrischona, die mangels Strahlungsjahren nicht mehr
    // angeboten wird, lud «Station leer».
    if (fromUrl) {
      const { station, year, compare, ...room } = fromUrl;
      applyState(room);
    }

    loaded = await loadClimate($("station").value, $("year").value);
    comparedTo = $("compare").value ? await loadClimate($("station").value, $("compare").value) : null;

    for (const id of ["azimuth", "massClass", "skyModel", "windowFraction", "shading", "gains", "nightVent", "nightVentOn"]) {
      $(id).addEventListener("input", () => {
        syncLabels();
        schedule();
      });
    }
    $("station").addEventListener("change", () => reloadData().catch(showError));
    $("year").addEventListener("change", () => reloadData().catch(showError));
    $("compare").addEventListener("change", () => reloadData().catch(showError));
    window.addEventListener("resize", () => lastResult && render());
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => lastResult && render());

    setupHover();
    setupDownloads();
    setupTheme();
    syncLabels();

    $("footer").innerHTML =
      `${usableStations().length} von ${Object.keys(catalog.stations).length} Stationen mit Globalstrahlung` +
      (scenarios ? `, ${Object.keys(scenarios.stations).length} mit Klimaszenarien` : "") + ". " +
      `Daten: ${catalog.attribution} · ${catalog.license} · Katalogstand ${swissDate(catalog.generated)}. ` +
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
