/**
 * Was bedeutet der Klimawandel für diesen Raum?
 *
 *   node core/scripts/climate-change.ts SMA [Basisperiode-von] [Basisperiode-bis]
 *
 * Rechnet denselben Raum gegen die gemessene Vergangenheit und gegen die
 * DRY-Szenarien für 2035 und 2060.
 *
 * Die Zeitkonventionen der beiden Quellen sind **entgegengesetzt** — Messreihe
 * am Intervallende, Szenario am Intervallbeginn mit +10 min Stichzeitpunkt.
 * Beides steht im jeweiligen .ocbl-Header; der Rechenkern muss die Herkunft
 * nicht kennen.
 *
 * Zur Lesart des Vergleichs siehe docs/methods/009-klimaszenarien.md — ein
 * Design Reference Year ist kein Mittel gemessener Jahre.
 */

import { getVariable } from "../src/series.ts";
import { citations, shortHash } from "../src/provenance.ts";
import { dailyMean, thresholdDays, tropicalNights } from "../src/indicators.ts";
import {
  DEFAULT_ROOM_SETTINGS, evaluateReferenceCase, isCompleteMeasuredYear, peakOperativeTemperature,
} from "../src/reference-case.ts";
import type { StationSeries } from "../src/series.ts";
import {
  loadCatalog, loadScenarioCatalog, loadScenarioIndex, loadSeries, loadStationIndex,
} from "./catalog.ts";

const abbr = (process.argv[2] ?? "SMA").toUpperCase();
/** Normalperiode als Vergleichsbasis. Fünf aktuelle Jahre wären keine. */
const BASE_FROM = Number(process.argv[3] ?? 1991);
const BASE_TO = Number(process.argv[4] ?? 2020);
function evaluate(series: StationSeries, lat: number, lon: number) {
  const outdoor = getVariable(series, "tre200h0");
  const inputs = [series.source];
  // Raum und Auswertung wie im Frontend, aus core/src/reference-case.ts.
  const { simulation: sim, exceedance: uts } = evaluateReferenceCase(series, { lat, lon }, DEFAULT_ROOM_SETTINGS);

  const daily = [...dailyMean(outdoor, series.axis)].filter(Number.isFinite);
  return {
    annualMean: daily.reduce((a, b) => a + b, 0) / daily.length,
    hotDays: thresholdDays(outdoor, series.axis, inputs, { thresholdC: 30 }).value.count,
    nights: tropicalNights(outdoor, series.axis, inputs).value.count,
    uts: uts.value.hours,
    kh: uts.value.kelvinHours,
    peak: peakOperativeTemperature(uts),
    sim,
  };
}

// --- Gegenwart: Mittel über die gemessenen Jahre ------------------------------

const catalog = await loadCatalog();
const measured = catalog.stations[abbr];
if (!measured) throw new Error(`${abbr} nicht im Messdatenkatalog`);
const measuredIndex = await loadStationIndex(measured);

console.log(`\n${abbr} — ${measured.name} (${measured.canton}, ${Math.round(measured.altitudeM)} m ü. M.)`);
console.log(`Südbüro 20 m², 40 % Fenster, Sonnenschutz g_tot 0.15, Nachtlüftung 3 1/h`);
console.log(`Bewertung EN 16798-1 Kat. II, Belegung Mo–Fr 07–19 Uhr\n`);

const head = "Klimastand".padEnd(34) + "Ø °C".padStart(7) + "Hitzetage".padStart(11) +
  "Tropenn.".padStart(10) + "ÜTS".padStart(7) + "Kh".padStart(8) + "θ_op max".padStart(10);
console.log(head);
console.log("-".repeat(head.length));

type Evaluated = ReturnType<typeof evaluate>;
const baseRows: Evaluated[] = [];
const recentRows: Evaluated[] = [];

// Nur Jahre mit Temperatur und Globalstrahlung, beide zu mindestens 95 %.
// Ein Jahr ohne Strahlung bricht ab; eines mit Lücken rechnet seit
// simulate5R1C 1.4.0 weniger Stunden und drückte das Mittel der Basis.
let incomplete = 0;
for (const [year, meta] of Object.entries(measuredIndex)) {
  const y = Number(year);
  if (!measured.roomModelYears.includes(y)) continue;
  if (!isCompleteMeasuredYear(meta.completeness)) {
    incomplete++;
    continue;
  }
  const r = evaluate(await loadSeries(meta), measured.lat, measured.lon);
  if (y >= BASE_FROM && y <= BASE_TO) baseRows.push(r);
  if (y > BASE_TO) recentRows.push(r);
}

const mean = (rows: Evaluated[], pick: (r: Evaluated) => number) =>
  rows.reduce((a, r) => a + pick(r), 0) / rows.length;

function line(label: string, rows: Evaluated[]) {
  return label.padEnd(34) + mean(rows, (r) => r.annualMean).toFixed(1).padStart(7) +
    mean(rows, (r) => r.hotDays).toFixed(0).padStart(11) + mean(rows, (r) => r.nights).toFixed(0).padStart(10) +
    mean(rows, (r) => r.uts).toFixed(0).padStart(7) + mean(rows, (r) => r.kh).toFixed(0).padStart(8) +
    mean(rows, (r) => r.peak).toFixed(1).padStart(10);
}

if (baseRows.length < 10) {
  console.log(`  Warnung: nur ${baseRows.length} Jahre in ${BASE_FROM}–${BASE_TO} gebaut.`);
  console.log(`  Für eine belastbare Basis:  python3 -m ocbl_data build --station ${abbr} --from ${BASE_FROM} --to ${BASE_TO}\n`);
}
if (incomplete) console.log(`  ${incomplete} Jahre mit weniger als 95 % Temperatur oder Strahlung nicht gemittelt.\n`);
if (baseRows.length) console.log(line(`Basis ${BASE_FROM}–${BASE_TO} (${baseRows.length} Jahre)`, baseRows));
if (recentRows.length) console.log(line(`zuletzt ${BASE_TO + 1}–2024 (${recentRows.length} Jahre)`, recentRows));

// --- Zukunft: die DRY-Szenarien ----------------------------------------------

const scenarios = await loadScenarioCatalog();
const scenarioStation = scenarios.stations[abbr];
if (!scenarioStation) {
  console.log(`\n${abbr} hat keine Szenariodaten (nur 45 der Stationen haben welche).`);
  process.exit(0);
}
const variants = await loadScenarioIndex(scenarioStation);

console.log("-".repeat(head.length));
const reference = baseRows.length ? baseRows : recentRows;
const baseUts = mean(reference, (r) => r.uts);
for (const [slug, variant] of Object.entries(variants)) {
  const series = await loadSeries(variant);
  const r = evaluate(series, scenarioStation.lat, scenarioStation.lon);
  const delta = r.uts - baseUts;
  console.log(
    variant.label.padEnd(34) + r.annualMean.toFixed(1).padStart(7) + String(r.hotDays).padStart(11) +
    String(r.nights).padStart(10) + String(r.uts).padStart(7) + r.kh.toFixed(0).padStart(8) +
    r.peak.toFixed(1).padStart(10) + `   ${delta >= 0 ? "+" : ""}${delta.toFixed(0)} ÜTS`,
  );
}

const sample = await loadSeries(Object.values(variants)[0]);
console.log(`\nΔ bezogen auf ${baseRows.length ? `${BASE_FROM}–${BASE_TO}` : "die gebauten Jahre"}.`);
console.log(`Zeitkonvention Messreihe: Stempel am Intervallende, Mitte −30 min`);
console.log(`Zeitkonvention Szenario:  Stempel am Intervallbeginn, Stichzeitpunkt +${sample.axis.sampleOffsetMin} min`);

console.log(`\nZur Lesart: Ein Design Reference Year ist ein synthetisches typisches Jahr,`);
console.log(`kein Mittel gemessener Jahre. CH2018 ist zudem auf eine ältere Referenz-`);
console.log(`periode kalibriert. Belastbar sind vor allem die Vergleiche *innerhalb* des`);
console.log(`Szenariensatzes — RCP 8.5 gegen RCP 2.6, Referenzjahr gegen warmen Sommer.`);
console.log(`Siehe docs/methods/009-klimaszenarien.md`);

console.log(`\nQuellen:`);
for (const c of citations(reference[0].sim)) console.log(`  ${c}`);
console.log(`  ${scenarios.attribution} · ${scenarios.title} · ${scenarios.url} · ${scenarios.licenseLabel}\n`);
