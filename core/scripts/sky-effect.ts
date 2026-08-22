/**
 * Wie viel bringt die langwellige Abstrahlung gegen den Himmel?
 *
 *   node core/scripts/sky-effect.ts
 *
 * Vergleicht drei Fassungen — ohne Abstrahlung, mit dem Pauschalwert der Norm,
 * mit gemessener Himmelstemperatur — je für einen Neubau und einen ungedämmten
 * Altbau. Die Zahlen in docs/methods/008 stammen aus diesem Skript.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { readPacked } from "../src/pack.ts";
import { getVariable } from "../src/series.ts";
import { adaptiveComfortBand, dailyMean, exceedanceHours, runningMeanOutdoorTemperature } from "../src/indicators.ts";
import { simulate5R1C, warmupHours, type RoomSpec } from "../src/building.ts";

const BUILD = path.resolve(import.meta.dirname, "../../data/build");
const catalog = JSON.parse(await readFile(path.join(BUILD, "catalog.json"), "utf-8"));
const entry = catalog.stations.SMA;
const meta = entry.years["2023"];
const bytes = await readFile(path.join(BUILD, meta.path));
const series = readPacked(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, meta.sha256);

const outdoor = getVariable(series, "tre200h0");
const inputs = [series.source];
const band = adaptiveComfortBand(runningMeanOutdoorTemperature(dailyMean(outdoor, series.axis), inputs).value, inputs, { category: "II" });

const base = { outdoorTemperature: outdoor, globalHorizontal: getVariable(series, "gre000h0"), axis: series.axis, latitude: entry.lat, longitude: entry.lon };
const lw = getVariable(series, "oli000h0");

function room(uOpaque: number, uWindow: number, skyViewFactor: number): RoomSpec {
  const wa = 9.8 * 0.4;
  return {
    floorArea: 20, height: 2.8, opaqueArea: 9.8 - wa, opaqueUValue: uOpaque, thermalBridges: 0.5,
    windows: [{ area: wa, orientation: { tilt: 90, azimuth: 180 }, uValue: uWindow, gValue: 0.5, frameFraction: 0.25,
                shading: { factorClosed: 0.3, activationIrradiance: 200 } }],
    massClass: "mittel", airChangeRate: 0.3, internalGains: 20,
    occupancy: { fromHour: 7, toHour: 19, weekdaysOnly: true, gainsUnoccupied: 2, airChangeOccupied: 1.5 },
    nightVentilation: { airChangeRate: 3, fromHour: 22, toHour: 6, minIndoorC: 22, minDeltaK: 2 },
    skyViewFactor,
  };
}

function run(spec: RoomSpec, longwave?: Float64Array) {
  const sim = simulate5R1C(spec, longwave ? { ...base, downwellingLongwave: longwave } : base, inputs);
  const skip = warmupHours(spec);
  const op = sim.value.operativeTemperature.slice();
  op.fill(NaN, 0, skip);
  const uts = exceedanceHours(op, series.axis, band.value.upper, inputs, { category: "II", occupiedFromHour: 7, occupiedToHour: 19 });
  const peak = Math.max(...[...op].filter(Number.isFinite));
  const meanLoss = [...sim.value.skyLoss].filter(Number.isFinite).reduce((a, b) => a + b, 0) / series.axis.length;
  return { uts: uts.value.hours, kh: uts.value.kelvinHours, peak, meanLoss };
}

const cases: Array<[string, RoomSpec, Float64Array | undefined]> = [
  ["Neubau U=0.2 — ohne Abstrahlung", room(0.2, 1.0, 0), undefined],
  ["Neubau U=0.2 — pauschal 11 K", room(0.2, 1.0, 0.5), undefined],
  ["Neubau U=0.2 — gemessen", room(0.2, 1.0, 0.5), lw],
  ["Altbau U=1.4/2.8 — ohne Abstrahlung", room(1.4, 2.8, 0), undefined],
  ["Altbau U=1.4/2.8 — pauschal 11 K", room(1.4, 2.8, 0.5), undefined],
  ["Altbau U=1.4/2.8 — gemessen", room(1.4, 2.8, 0.5), lw],
];

console.log("\nWirkung der langwelligen Abstrahlung — Zürich/Fluntern 2023\n");
console.log("Fall".padEnd(38) + "ÜTS".padStart(6) + "Kh".padStart(8) + "θ_op max".padStart(10) + "Ø Φ_r".padStart(9));
console.log("-".repeat(71));
for (const [label, spec, longwave] of cases) {
  const r = run(spec, longwave);
  console.log(label.padEnd(38) + String(r.uts).padStart(6) + r.kh.toFixed(0).padStart(8) +
    r.peak.toFixed(2).padStart(10) + `${r.meanLoss.toFixed(1)} W`.padStart(9));
}
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readPacked } from "../src/pack.ts";
import { getVariable } from "../src/series.ts";
import { adaptiveComfortBand, dailyMean, exceedanceHours, runningMeanOutdoorTemperature } from "../src/indicators.ts";
import { simulate5R1C, warmupHours, type RoomSpec } from "../src/building.ts";

const BUILD = path.resolve(import.meta.dirname, "../../data/build");
const catalog = JSON.parse(await readFile(path.join(BUILD, "catalog.json"), "utf-8"));
const entry = catalog.stations.SMA;
const meta = entry.years["2023"];
const bytes = await readFile(path.join(BUILD, meta.path));
const series = readPacked(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, meta.sha256);

const outdoor = getVariable(series, "tre200h0");
const inputs = [series.source];
const band = adaptiveComfortBand(runningMeanOutdoorTemperature(dailyMean(outdoor, series.axis), inputs).value, inputs, { category: "II" });

const base = { outdoorTemperature: outdoor, globalHorizontal: getVariable(series, "gre000h0"), axis: series.axis, latitude: entry.lat, longitude: entry.lon };
const lw = getVariable(series, "oli000h0");

function room(uOpaque: number, uWindow: number, skyViewFactor: number): RoomSpec {
  const wa = 9.8 * 0.4;
  return {
    floorArea: 20, height: 2.8, opaqueArea: 9.8 - wa, opaqueUValue: uOpaque, thermalBridges: 0.5,
    windows: [{ area: wa, orientation: { tilt: 90, azimuth: 180 }, uValue: uWindow, gValue: 0.5, frameFraction: 0.25,
                shading: { factorClosed: 0.3, activationIrradiance: 200 } }],
    massClass: "mittel", airChangeRate: 0.3, internalGains: 20,
    occupancy: { fromHour: 7, toHour: 19, weekdaysOnly: true, gainsUnoccupied: 2, airChangeOccupied: 1.5 },
    nightVentilation: { airChangeRate: 3, fromHour: 22, toHour: 6, minIndoorC: 22, minDeltaK: 2 },
    skyViewFactor,
  };
}

function run(spec: RoomSpec, longwave?: Float64Array) {
  const sim = simulate5R1C(spec, longwave ? { ...base, downwellingLongwave: longwave } : base, inputs);
  const skip = warmupHours(spec);
  const op = sim.value.operativeTemperature.slice();
  op.fill(NaN, 0, skip);
  const uts = exceedanceHours(op, series.axis, band.value.upper, inputs, { category: "II", occupiedFromHour: 7, occupiedToHour: 19 });
  const peak = Math.max(...[...op].filter(Number.isFinite));
  const meanLoss = [...sim.value.skyLoss].filter(Number.isFinite).reduce((a, b) => a + b, 0) / series.axis.length;
  return { uts: uts.value.hours, kh: uts.value.kelvinHours, peak, meanLoss };
}

const cases: Array<[string, RoomSpec, Float64Array | undefined]> = [
  ["Neubau U=0.2 — ohne Abstrahlung", room(0.2, 1.0, 0), undefined],
  ["Neubau U=0.2 — pauschal 11 K", room(0.2, 1.0, 0.5), undefined],
  ["Neubau U=0.2 — gemessen", room(0.2, 1.0, 0.5), lw],
  ["Altbau U=1.4/2.8 — ohne Abstrahlung", room(1.4, 2.8, 0), undefined],
  ["Altbau U=1.4/2.8 — pauschal 11 K", room(1.4, 2.8, 0.5), undefined],
  ["Altbau U=1.4/2.8 — gemessen", room(1.4, 2.8, 0.5), lw],
];

console.log("\nWirkung der langwelligen Abstrahlung — Zürich/Fluntern 2023\n");
console.log("Fall".padEnd(38) + "ÜTS".padStart(6) + "Kh".padStart(8) + "θ_op max".padStart(10) + "Ø Φ_r".padStart(9));
console.log("-".repeat(71));
for (const [label, spec, longwave] of cases) {
  const r = run(spec, longwave);
  console.log(label.padEnd(38) + String(r.uts).padStart(6) + r.kh.toFixed(0).padStart(8) +
    r.peak.toFixed(2).padStart(10) + `${r.meanLoss.toFixed(1)} W`.padStart(9));
}
