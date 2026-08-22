/**
 * Derselbe Raum an allen Stationen.
 *
 *   node core/scripts/stations.ts 2023
 *
 * Rechnet einen identischen Referenzraum über alle Stationen, an denen das
 * Raummodell möglich ist, und rangiert nach Übertemperaturstunden. Das ist
 * der Ertrag der Breite: Der Raum ist überall gleich, nur das Klima ändert
 * sich — die Unterschiede sind damit rein standortbedingt.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { readPacked } from "../src/pack.ts";
import { getVariable } from "../src/series.ts";
import { adaptiveComfortBand, dailyMean, exceedanceHours, runningMeanOutdoorTemperature } from "../src/indicators.ts";
import { simulate5R1C, warmupHours, type RoomSpec } from "../src/building.ts";

const BUILD = path.resolve(import.meta.dirname, "../../data/build");
const year = process.argv[2] ?? "2023";
const catalog = JSON.parse(await readFile(path.join(BUILD, "catalog.json"), "utf-8"));

const FACADE = 9.8;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

const referenceRoom = (): RoomSpec => {
  const windowArea = round6(FACADE * 0.4);
  return {
    floorArea: 20, height: 2.8, opaqueArea: round6(FACADE - windowArea),
    opaqueUValue: 0.2, thermalBridges: 0.5,
    windows: [{
      area: windowArea, orientation: { tilt: 90, azimuth: 180 }, uValue: 1.0,
      gValue: 0.5, frameFraction: 0.25,
      shading: { factorClosed: 0.3, activationIrradiance: 200 },
    }],
    massClass: "mittel", airChangeRate: 0.3, internalGains: 20,
    occupancy: { fromHour: 7, toHour: 19, weekdaysOnly: true, gainsUnoccupied: 2, airChangeOccupied: 1.5 },
    nightVentilation: { airChangeRate: 3, fromHour: 22, toHour: 6, minIndoorC: 22, minDeltaK: 2 },
  };
};

type Row = {
  abbr: string; name: string; canton: string; altitude: number;
  uts: number; peak: number; annualMean: number; sky: string;
};

const rows: Row[] = [];
let skipped = 0;

for (const [abbr, entry] of Object.entries(catalog.stations) as [string, any][]) {
  if (!entry.capabilities.roomModel || !entry.years.includes(Number(year))) continue;

  const index = JSON.parse(await readFile(path.join(BUILD, entry.index), "utf-8"));
  const meta = index[year];
  if (!meta || (meta.completeness?.tre200h0 ?? 0) < 0.95) {
    skipped++;
    continue;
  }

  const bytes = await readFile(path.join(BUILD, meta.path));
  const series = readPacked(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    meta.sha256,
  );
  const outdoor = getVariable(series, "tre200h0");
  const inputs = [series.source];
  const band = adaptiveComfortBand(
    runningMeanOutdoorTemperature(dailyMean(outdoor, series.axis), inputs).value, inputs, { category: "II" },
  );

  const room = referenceRoom();
  const sim = simulate5R1C(room, {
    outdoorTemperature: outdoor,
    globalHorizontal: getVariable(series, "gre000h0"),
    diffuseHorizontal: series.variables.has("ods000h0") ? getVariable(series, "ods000h0") : undefined,
    downwellingLongwave: series.variables.has("oli000h0") ? getVariable(series, "oli000h0") : undefined,
    axis: series.axis, latitude: entry.lat, longitude: entry.lon,
  }, inputs);

  const op = sim.value.operativeTemperature.slice();
  op.fill(NaN, 0, warmupHours(room));
  const uts = exceedanceHours(op, series.axis, band.value.upper, inputs,
    { category: "II", occupiedFromHour: 7, occupiedToHour: 19 });

  const daily = [...dailyMean(outdoor, series.axis)].filter(Number.isFinite);
  rows.push({
    abbr, name: entry.name, canton: entry.canton, altitude: entry.altitudeM,
    uts: uts.value.hours,
    peak: Math.max(...[...op].filter(Number.isFinite)),
    annualMean: daily.reduce((a, b) => a + b, 0) / daily.length,
    sky: sim.value.longwaveSource === "gemessen" ? "M" : "p",
  });
}

rows.sort((a, b) => b.uts - a.uts);

console.log(`\nIdentischer Referenzraum an ${rows.length} Stationen, ${year}`);
console.log(`Südbüro 20 m², 40 % Fenster, Sonnenschutz g_tot 0.15, Nachtlüftung 3 1/h`);
console.log(`M = Himmelstemperatur gemessen, p = Pauschalwert der Norm\n`);

const head = "  # Station".padEnd(34) + "Höhe".padStart(7) + "Ø °C".padStart(7) + "ÜTS".padStart(7) + "θ_op max".padStart(10) + "  ";
console.log(head);
console.log("-".repeat(head.length + 2));
const show = (r: Row, i: number) =>
  `${String(i + 1).padStart(3)} ${(r.name + " (" + r.canton + ")").slice(0, 29).padEnd(30)}` +
  `${r.altitude.toFixed(0).padStart(6)}m${r.annualMean.toFixed(1).padStart(7)}${String(r.uts).padStart(7)}` +
  `${r.peak.toFixed(1).padStart(10)}  ${r.sky}`;

rows.slice(0, 12).forEach((r, i) => console.log(show(r, i)));
console.log("   …");
rows.slice(-6).forEach((r, i) => console.log(show(r, rows.length - 6 + i)));

const withSky = rows.filter((r) => r.sky === "M").length;
console.log(`\n${skipped} Stationen wegen unvollständiger Messreihe übersprungen.`);
console.log(`Himmelstemperatur an ${withSky} von ${rows.length} Stationen gemessen.`);
