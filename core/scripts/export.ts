/**
 * Download des Referenzfalls aus einem Permalink, byte-gleich zum Browser.
 *
 *   node core/scripts/export.ts 'http://localhost:8000/#station=SMA&year=y2024' [Zielordner]
 *   node core/scripts/export.ts 'station=SMA&year=y2023&windowFraction=70'
 *
 * Mit `compare=` entstehen beide Klimastände, wie die zwei Download-Zeilen im
 * Browser. Fehlende Reglerwerte erhalten die Vorgabe des Frontends, fehlende
 * Station und fehlendes Jahr ebenfalls: SMA und das jüngste Messjahr.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateReferenceCase, isScenarioKey, roomSettingsFromParams } from "../src/reference-case.ts";
import { referenceCaseExport } from "../src/export.ts";
import { loadCatalog, loadScenarioCatalog, loadScenarioIndex, loadSeries, loadStationIndex } from "./catalog.ts";

const [link, outDir = "."] = process.argv.slice(2);
if (!link) {
  console.error("Aufruf: node core/scripts/export.ts '<Permalink>' [Zielordner]");
  process.exit(2);
}

const params = new URLSearchParams(link.includes("#") ? link.slice(link.indexOf("#") + 1) : link);
const settings = roomSettingsFromParams(params);

const catalog = await loadCatalog();
const station = params.get("station") ?? "SMA";
const entry = catalog.stations[station];
// Der Browser bietet nur Stationen an, an denen das Raummodell rechenbar ist.
if (!entry?.capabilities.roomModel) {
  throw new Error(`Station ${station} ist nicht im Katalog oder misst keine Globalstrahlung`);
}

const year = params.get("year") ?? `y${Math.max(...entry.roomModelYears)}`;
const compare = params.get("compare");
// Wie im Browser: ein Klimastand gegen sich selbst wird nicht angeboten.
const keys = compare && compare !== year ? [year, compare] : [year];

async function seriesFor(key: string) {
  if (!isScenarioKey(key)) {
    // Wie im Browser: nur Jahre, in denen Temperatur und Globalstrahlung gemessen sind.
    const meta = entry.roomModelYears.includes(Number(key.slice(1))) && (await loadStationIndex(entry))[key.slice(1)];
    if (!meta) throw new Error(`${station} ${key.slice(1)} nicht fürs Raummodell vorhanden. Jahre: ${entry.roomModelYears.join(", ")}`);
    return loadSeries(meta);
  }
  const scenarioStation = (await loadScenarioCatalog()).stations[station];
  const meta = scenarioStation && (await loadScenarioIndex(scenarioStation))[key.slice(1)];
  if (!meta) throw new Error(`${station} hat kein Szenario ${key.slice(1)}`);
  return loadSeries(meta);
}

await mkdir(outDir, { recursive: true });
for (const key of keys) {
  const series = await seriesFor(key);
  const { exceedance } = evaluateReferenceCase(series, entry, settings);
  const files = await referenceCaseExport({ station, stationInfo: entry, climateKey: key, settings, series, exceedance });
  await writeFile(path.join(outDir, files.csvName), files.csv);
  await writeFile(path.join(outDir, files.jsonName), files.json);
  console.log(`${files.csvName} · ${files.jsonName} · ${exceedance.value.hours} Übertemperaturstunden`);
}
