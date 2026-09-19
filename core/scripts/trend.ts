/**
 * Übertemperaturstunden des Referenzraums über alle Messjahre einer Station.
 *
 *   node core/scripts/trend.ts 'station=SMA'
 *   node core/scripts/trend.ts 'http://localhost:8000/#station=SMA&year=y2023&azimuth=270'
 *
 * Dieselbe Rechnung wie der Mehrjahresverlauf im Browser, aus einem Permalink.
 * Der Schlüssel `year` spielt keine Rolle; gerechnet werden alle Jahre mit
 * Temperatur und Globalstrahlung, die zu mindestens 95 % vollständig sind.
 */

import { computationHash } from "../src/provenance.ts";
import {
  evaluateReferenceCase, isCompleteMeasuredYear, peakOperativeTemperature, roomSettingsFromParams,
} from "../src/reference-case.ts";
import { climateLabel } from "../src/reference-case.ts";
import { exceedancePeriodMean, exceedanceTrend } from "../src/trend.ts";
import { loadCatalog, loadScenarioCatalog, loadScenarioIndex, loadSeries, loadStationIndex } from "./catalog.ts";

const link = process.argv[2] ?? "station=SMA";
const params = new URLSearchParams(link.includes("#") ? link.slice(link.indexOf("#") + 1) : link);
const settings = roomSettingsFromParams(params);
const station = params.get("station") ?? "SMA";

const catalog = await loadCatalog();
const entry = catalog.stations[station];
if (!entry?.capabilities.roomModel) throw new Error(`Station ${station} ist nicht im Katalog oder misst keine Globalstrahlung`);
const index = await loadStationIndex(entry);

console.log(`\n${station} — ${entry.name} (${entry.canton}, ${Math.round(entry.altitudeM)} m ü. M.)`);
console.log("Jahr    ÜTS     Kh  bewertet  θ_op max  Hash");
const rows = [];
const skipped: string[] = [];
for (const year of entry.roomModelYears) {
  const meta = index[String(year)];
  if (!isCompleteMeasuredYear(meta.completeness)) {
    skipped.push(`${year} (T ${Math.round(100 * meta.completeness.tre200h0)} %, G ${Math.round(100 * (meta.completeness.gre000h0 ?? 0))} %)`);
    continue;
  }
  const { exceedance } = evaluateReferenceCase(await loadSeries(meta), entry, settings);
  rows.push({ year, exceedance });
  const v = exceedance.value;
  console.log(
    `${year}  ${String(v.hours).padStart(5)}  ${Math.round(v.kelvinHours).toString().padStart(5)}  ` +
    `${String(v.evaluatedHours).padStart(8)}  ${peakOperativeTemperature(exceedance).toFixed(1).padStart(8)}  ` +
    `${(await computationHash(exceedance)).slice(0, 12)}`,
  );
}

const trend = exceedanceTrend(rows);
const t = trend.value;
console.log(`\nTrend ${t.perDecade >= 0 ? "+" : ""}${t.perDecade.toFixed(1)} h pro Jahrzehnt, ` +
  `${t.years[0]}–${t.years[t.years.length - 1]}, ${t.years.length} Jahre, r² ${t.rSquared.toFixed(2)}`);
console.log(`Verfahren ${trend.method.id}@${trend.method.version} · Hash ${(await computationHash(trend)).slice(0, 12)}`);
if (skipped.length) console.log(`Ausgelassen, weniger als 95 %: ${skipped.join(", ")}`);

const normal = exceedancePeriodMean(rows);
const n = normal.value;
console.log(`\nNormalperiode ${normal.params.fromYear}–${normal.params.toYear}: ` +
  (Number.isFinite(n.mean) ? `${n.mean.toFixed(0)} h aus ${n.count} Jahren` : `kein Mittel, nur ${n.count} von ` +
    `${Number(normal.params.toYear) - Number(normal.params.fromYear) + 1} Jahren`) +
  ` · Hash ${(await computationHash(normal)).slice(0, 12)}`);

// Szenarien: jedes mit seinem eigenen Komfortband, gelesen gegen die Normalperiode (009).
const scenarioStation = (await loadScenarioCatalog()).stations[station];
if (scenarioStation) {
  const variants = await loadScenarioIndex(scenarioStation);
  for (const slug of scenarioStation.variants) {
    const { exceedance } = evaluateReferenceCase(await loadSeries(variants[slug]), entry, settings);
    const hours = exceedance.value.hours;
    const delta = Number.isFinite(n.mean) ? `  ${hours - n.mean >= 0 ? "+" : ""}${(hours - n.mean).toFixed(0)} h` : "";
    console.log(`${climateLabel(`s${slug}`).padEnd(48)} ${String(hours).padStart(5)} h${delta}  ${(await computationHash(exceedance)).slice(0, 12)}`);
  }
}
