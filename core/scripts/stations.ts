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

import { getVariable } from "../src/series.ts";
import { loadCatalog, loadSeries, loadStationIndex } from "./catalog.ts";
import { dailyMean } from "../src/indicators.ts";
import { DEFAULT_ROOM_SETTINGS, evaluateReferenceCase, peakOperativeTemperature } from "../src/reference-case.ts";

const year = process.argv[2] ?? "2023";
const catalog = await loadCatalog();

type Row = {
  abbr: string; name: string; canton: string; altitude: number;
  uts: number; peak: number; annualMean: number; sky: string;
};

const rows: Row[] = [];
let skipped = 0;

for (const [abbr, entry] of Object.entries(catalog.stations) as [string, any][]) {
  if (!entry.capabilities.roomModel || !entry.years.includes(Number(year))) continue;

  const index = await loadStationIndex(entry);
  const meta = index[year];
  if (!meta || (meta.completeness?.tre200h0 ?? 0) < 0.95) {
    skipped++;
    continue;
  }

  const series = await loadSeries(meta);
  const outdoor = getVariable(series, "tre200h0");
  // Raum und Auswertung wie im Frontend, aus core/src/reference-case.ts.
  const { simulation: sim, exceedance: uts } = evaluateReferenceCase(series, entry, DEFAULT_ROOM_SETTINGS);

  const daily = [...dailyMean(outdoor, series.axis)].filter(Number.isFinite);
  rows.push({
    abbr, name: entry.name, canton: entry.canton, altitude: entry.altitudeM,
    uts: uts.value.hours,
    peak: peakOperativeTemperature(uts),
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
