/**
 * Zugriff auf den zweistufigen Katalog — an einer Stelle.
 *
 * Beim Wechsel von einem einzigen catalog.json auf Index plus Detaildatei je
 * Station hingen drei Skripte und ein Test an der alten Struktur. Zwei davon
 * scheiterten laut, einer übersprang sich still. Diese Datei existiert, damit
 * es beim nächsten Formatwechsel eine Stelle statt vier sind.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { readPacked } from "../src/pack.ts";
import type { StationSeries } from "../src/series.ts";

export const BUILD_DIR = path.resolve(import.meta.dirname, "../../data/build");

export interface StationEntry {
  name: string;
  canton: string;
  altitudeM: number;
  lat: number;
  lon: number;
  capabilities: Record<string, boolean>;
  years: number[];
  index: string;
}

export interface YearMeta {
  path: string;
  sha256: string;
  bytes: number;
  variables: string[];
  completeness: Record<string, number>;
  outOfRange: Record<string, number>;
}

export interface Catalog {
  generated: string;
  collection: string;
  license: string;
  attribution: string;
  stations: Record<string, StationEntry>;
}

export async function loadCatalog(): Promise<Catalog> {
  return JSON.parse(await readFile(path.join(BUILD_DIR, "catalog.json"), "utf-8"));
}

/** Detailindex einer Station: Prüfsummen und Vollständigkeit je Jahr. */
export async function loadStationIndex(entry: StationEntry): Promise<Record<string, YearMeta>> {
  return JSON.parse(await readFile(path.join(BUILD_DIR, entry.index), "utf-8"));
}

/** Lädt ein Stationsjahr und prüft dabei die Katalogprüfsumme mit. */
export async function loadSeries(meta: YearMeta): Promise<StationSeries> {
  const bytes = await readFile(path.join(BUILD_DIR, meta.path));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return readPacked(buffer, meta.sha256);
}

/** Bequemer Einstieg: Station und Jahr in einem Zug. */
export async function station(abbr: string, year: string | number) {
  const catalog = await loadCatalog();
  const entry = catalog.stations[abbr.toUpperCase()];
  if (!entry) {
    const known = Object.keys(catalog.stations).slice(0, 8).join(", ");
    throw new Error(`Station ${abbr} nicht im Katalog. Zum Beispiel: ${known} …`);
  }
  const index = await loadStationIndex(entry);
  const meta = index[String(year)];
  if (!meta) {
    throw new Error(`${abbr} ${year} nicht vorhanden. Jahre: ${entry.years.join(", ")}`);
  }
  return { catalog, entry, meta, index, series: await loadSeries(meta) };
}


// ---------------------------------------------------------------------------
// Klimaszenarien
// ---------------------------------------------------------------------------

export interface ScenarioVariant {
  period: number;
  scenario: string;
  kind: "DRY" | "1in10-warmsummer";
  label: string;
  path: string;
  sha256: string;
  bytes: number;
  variables: string[];
  completeness: Record<string, number>;
}

export interface ScenarioStation {
  name: string;
  canton: string;
  altitudeM: number;
  lat: number;
  lon: number;
  variants: string[];
  index: string;
}

export interface ScenarioCatalog {
  generated: string;
  collection: string;
  license: string;
  licenseLabel: string;
  attribution: string;
  title: string;
  url: string;
  stations: Record<string, ScenarioStation>;
}

export async function loadScenarioCatalog(): Promise<ScenarioCatalog> {
  return JSON.parse(await readFile(path.join(BUILD_DIR, "scenarios.json"), "utf-8"));
}

export async function loadScenarioIndex(entry: ScenarioStation): Promise<Record<string, ScenarioVariant>> {
  return JSON.parse(await readFile(path.join(BUILD_DIR, entry.index), "utf-8"));
}
