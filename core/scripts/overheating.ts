/**
 * Übertemperaturstunden für einen realen Raum an einer realen Station.
 *
 *   node core/scripts/overheating.ts SMA 2023
 *
 * Rechnet die Parametervariationen, die das Frontend später hinter Reglern
 * zeigt: Fensterflächenanteil, Sonnenschutz, Nachtlüftung, Bauart. Jede
 * Variante trägt ihren eigenen Berechnungs-Hash.
 */

import { getVariable } from "../src/series.ts";
import { station } from "./catalog.ts";
import { shortHash } from "../src/provenance.ts";
import { adaptiveComfortBand, dailyMean, exceedanceHours, runningMeanOutdoorTemperature } from "../src/indicators.ts";
import { NO_SHADING, simulate5R1C, warmupHours, type RoomSpec } from "../src/building.ts";

const stationAbbr = (process.argv[2] ?? "SMA").toUpperCase();
const year = process.argv[3] ?? "2023";

const { catalog, entry, meta, series } = await station(stationAbbr, year);

const outdoor = getVariable(series, "tre200h0");
const global = getVariable(series, "gre000h0");
const hasDiffuse = series.variables.has("ods000h0");
const hasLongwave = series.variables.has("oli000h0");
const inputs = [series.source];

const simInput = {
  outdoorTemperature: outdoor,
  globalHorizontal: global,
  diffuseHorizontal: hasDiffuse ? getVariable(series, "ods000h0") : undefined,
  downwellingLongwave: hasLongwave ? getVariable(series, "oli000h0") : undefined,
  axis: series.axis,
  latitude: entry.lat,
  longitude: entry.lon,
};

// Komfortband aus dem Aussenklima — für alle Varianten dasselbe.
const runningMean = runningMeanOutdoorTemperature(dailyMean(outdoor, series.axis), inputs);
const band = adaptiveComfortBand(runningMean, { category: "II" });

const FACADE = 9.8;

/** Siehe core/src/reference-case.ts: Gleitkommareste gehören nicht in den Berechnungs-Hash. */
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

function room(overrides: Partial<RoomSpec> & { windowFraction?: number; shadingFactor?: number } = {}): RoomSpec {
  const fraction = overrides.windowFraction ?? 0.4;
  const windowArea = round6(FACADE * fraction);
  const shadingFactor = overrides.shadingFactor;
  return {
    floorArea: 20,
    height: 2.8,
    opaqueArea: round6(FACADE - windowArea),
    opaqueUValue: 0.2,
    thermalBridges: 0.5,
    windows: [
      {
        area: windowArea,
        orientation: { tilt: 90, azimuth: 180 },
        uValue: 1.0,
        gValue: 0.5,
        frameFraction: 0.25,
        shading: shadingFactor === undefined
          ? NO_SHADING
          : { factorClosed: shadingFactor, activationIrradiance: 200 },
      },
    ],
    massClass: overrides.massClass ?? "mittel",
    airChangeRate: 0.3,
    internalGains: 20,
    occupancy: OCCUPANCY,
    nightVentilation: overrides.nightVentilation,
    ...(overrides.floorArea !== undefined ? { floorArea: overrides.floorArea } : {}),
  };
}

/** Büronutzung: werktags 07–19 Uhr, hygienische Lüftung nur bei Belegung. */
const OCCUPANCY = {
  fromHour: 7,
  toHour: 19,
  weekdaysOnly: true,
  gainsUnoccupied: 2,
  airChangeOccupied: 1.5,
};

const NIGHT_VENT = { airChangeRate: 3, fromHour: 22, toHour: 6, minIndoorC: 22, minDeltaK: 2 };

// Basisfall ist ein Raum mit wirksamem Sonnenschutz — so wird gebaut.
// Die Varianten ohne Sonnenschutz stehen am Schluss als Kontrast und sind
// ausdrücklich keine realistische Ausführung.
const scenarios: Array<{ label: string; spec: RoomSpec }> = [
  { label: "Basis: 40 % Fenster, Sonnenschutz g_tot 0.15", spec: room({ shadingFactor: 0.15 }) },
  { label: "+ Nachtlüftung 3 1/h", spec: room({ shadingFactor: 0.15, nightVentilation: NIGHT_VENT }) },
  { label: "+ Nachtlüftung, schwere Bauart", spec: room({ shadingFactor: 0.15, nightVentilation: NIGHT_VENT, massClass: "schwer" }) },
  { label: "+ Nachtlüftung, leichte Bauart", spec: room({ shadingFactor: 0.15, nightVentilation: NIGHT_VENT, massClass: "sehr leicht" }) },
  { label: "Fensteranteil 60 %, Sonnenschutz + Nachtlüftung", spec: room({ windowFraction: 0.6, shadingFactor: 0.15, nightVentilation: NIGHT_VENT }) },
  { label: "Sonnenschutz g_tot 0.35 statt 0.15", spec: room({ shadingFactor: 0.35, nightVentilation: NIGHT_VENT }) },
  { label: "ohne Sonnenschutz — Kontrast, nicht baubar", spec: room() },
  { label: "ohne Sonnenschutz, 60 % Fenster — Kontrast", spec: room({ windowFraction: 0.6 }) },
];

console.log(`\n${stationAbbr} — ${entry.name} (${entry.canton}, ${Math.round(entry.altitudeM)} m), ${year}`);
console.log(`Südorientiertes Büro, 20 m², U_opak 0.2, U_Fenster 1.0, g 0.5`);
console.log(`Belegung Mo–Fr 07–19 Uhr, 20 W/m² belegt / 2 W/m² unbelegt, n 1.5 / 0.3 1/h`);
console.log(`Bewertung: EN 16798-1 Kat. II, Belegung 07–19 Uhr`);
console.log(`Diffusstrahlung: ${hasDiffuse ? "gemessen" : "aus Globalstrahlung nach Erbs (1982)"}`);
console.log(`Himmelstemperatur: ${hasLongwave ? "aus oli000h0 gemessen" : "pauschal 11 K nach EN ISO 13790"}\n`);

const header =
  "Variante".padEnd(46) + "ÜTS".padStart(6) + "Kh".padStart(8) + "θ_op max".padStart(10) +
  "Schutz".padStart(8) + "NachtL".padStart(8) + "  Hash";
console.log(header);
console.log("-".repeat(header.length + 4));

for (const { label, spec } of scenarios) {
  const sim = simulate5R1C(spec, simInput, inputs);

  // Die Einschwingphase verwirft exceedanceHours() selbst (ADR 0007). Für die
  // Spitzentemperatur wird dieselbe Stundenzahl hier ausgeblendet.
  const uts = exceedanceHours(sim, band, series.axis, { occupiedFromHour: 7, occupiedToHour: 19 });
  const evaluated = sim.value.operativeTemperature.slice();
  evaluated.fill(NaN, 0, Number(uts.params.warmupHours));

  const peak = Math.max(...[...evaluated].filter(Number.isFinite));

  console.log(
    label.padEnd(46) +
      String(uts.value.hours).padStart(6) +
      uts.value.kelvinHours.toFixed(0).padStart(8) +
      peak.toFixed(1).padStart(10) +
      String(sim.value.shadedHours).padStart(8) +
      String(sim.value.nightVentilationHours).padStart(8) +
      "  " + (await shortHash(uts)),
  );
}

const reference = simulate5R1C(room(), simInput, inputs).value;
console.log(`\nBelegte Stunden: ${reference.occupiedHours} von ${series.axis.length}`);
console.log(`Einschwingphase verworfen: ${warmupHours(room())} h (5 · Zeitkonstante)`);
console.log(`Komfortband definiert an ${[...band.value.upper].filter(Number.isFinite).length} Tagen`);
console.log(`Datenstand ${meta.sha256.slice(0, 12)} · ${catalog.license} · ${catalog.attribution}\n`);
