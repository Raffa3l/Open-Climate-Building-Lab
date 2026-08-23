import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { MISSING_I16, readPacked, type PackHeader } from "../src/pack.ts";
import { getVariable, intervalMidpointUtcMs } from "../src/series.ts";
import { coolingDegreeHours, dailyMean, thresholdDays, tropicalNights } from "../src/indicators.ts";

/** Baut einen .ocbl-Puffer wie data/ocbl_data/pack.py — für den Formattest. */
function buildPacked(header: PackHeader, columns: number[][]): ArrayBuffer {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const payloadBytes = columns.reduce((n, c) => n + c.length * 2, 0);
  const buffer = new ArrayBuffer(12 + headerBytes.length + payloadBytes);
  const view = new DataView(buffer);

  for (let i = 0; i < 4; i++) view.setUint8(i, "OCBL".charCodeAt(i));
  view.setUint8(4, 1);
  view.setUint32(8, headerBytes.length, true);
  new Uint8Array(buffer, 12, headerBytes.length).set(headerBytes);

  let p = 12 + headerBytes.length;
  for (const column of columns) {
    for (const raw of column) {
      view.setInt16(p, raw, true);
      p += 2;
    }
  }
  return buffer;
}

const HEADER: PackHeader = {
  station: "TST",
  altitudeM: 500,
  startUtcMs: Date.UTC(2021, 0, 1),
  stepMs: 3_600_000,
  length: 4,
  label: "end",
  localOffsetMin: 60,
  variables: [
    { code: "tre200h0", unit: "degC", scale: 0.01, offset: 0 },
    { code: "prestah0", unit: "hPa", scale: 0.01, offset: 800 },
  ],
  source: {
    collection: "ch.meteoschweiz.ogd-smn",
    station: "TST",
    year: 2021,
    variables: ["tre200h0", "prestah0"],
    license: "CC-BY-4.0",
    attribution: "MeteoSchweiz",
  },
};

test("Rundlauf durch das Binärformat inklusive Offset und Fehlwert", () => {
  const buffer = buildPacked(HEADER, [
    [1234, -567, MISSING_I16, 0],
    [15480, 15500, 15490, MISSING_I16],
  ]);
  const series = readPacked(buffer, "f".repeat(64));

  const t = getVariable(series, "tre200h0");
  assert.ok(Math.abs(t[0] - 12.34) < 1e-9);
  assert.ok(Math.abs(t[1] - -5.67) < 1e-9);
  assert.ok(Number.isNaN(t[2]), "Sentinel wird zu NaN");
  assert.equal(t[3], 0);

  const p = getVariable(series, "prestah0");
  assert.ok(Math.abs(p[0] - 954.8) < 1e-9, "Offset 800 hPa wird angewendet");
  assert.ok(Number.isNaN(p[3]));

  assert.equal(series.station, "TST");
  assert.equal(series.altitudeM, 500);
  assert.equal(series.source.sha256, "f".repeat(64));
  assert.equal(series.axis.label, "end");
});

test("der Stichzeitpunkt überlebt den Rundlauf durch das Binärformat", () => {
  // Ohne Feld gilt die Intervallmitte …
  const plain = readPacked(buildPacked(HEADER, [[1, 2, 3, 4], [1, 2, 3, 4]]), "x");
  assert.equal(plain.axis.sampleOffsetMin, undefined);
  assert.equal(intervalMidpointUtcMs(plain.axis, 0), HEADER.startUtcMs - 30 * 60_000);

  // … mit Feld gilt der ausdrückliche Wert. So tragen die Klimaszenarien
  // ihre eigene Konvention mit, ohne dass der Rechenkern sie kennen muss.
  const scenario = readPacked(
    buildPacked({ ...HEADER, label: "start", sampleOffsetMin: 10 }, [[1, 2, 3, 4], [1, 2, 3, 4]]),
    "x",
  );
  assert.equal(scenario.axis.sampleOffsetMin, 10);
  assert.equal(intervalMidpointUtcMs(scenario.axis, 0), HEADER.startUtcMs + 10 * 60_000);
  assert.equal(intervalMidpointUtcMs(scenario.axis, 3), HEADER.startUtcMs + (3 * 60 + 10) * 60_000);
});

test("beschädigte Dateien werden erkannt, nicht stillschweigend gelesen", () => {
  const good = buildPacked(HEADER, [[1, 2, 3, 4], [1, 2, 3, 4]]);

  const wrongMagic = good.slice(0);
  new DataView(wrongMagic).setUint8(0, 88);
  assert.throws(() => readPacked(wrongMagic, "x"), /Kein \.ocbl-File/);

  const wrongVersion = good.slice(0);
  new DataView(wrongVersion).setUint8(4, 99);
  assert.throws(() => readPacked(wrongVersion, "x"), /Formatversion 99/);

  const truncated = good.slice(0, good.byteLength - 2);
  assert.throws(() => readPacked(truncated, "x"), /unvollständig oder beschädigt/);
});

test("fehlende Variable nennt beim Fehler die vorhandenen", () => {
  const series = readPacked(buildPacked(HEADER, [[1, 2, 3, 4], [1, 2, 3, 4]]), "x");
  assert.throws(() => getVariable(series, "gre000h0"), /prestah0, tre200h0/);
});

// ---------------------------------------------------------------------------
// Integration gegen echte, vom Python-ETL erzeugte Daten.
// Übersprungen, solange data/build/ nicht gebaut ist — das Repo enthält keine
// Artefakte, sondern nur das Rezept.
// ---------------------------------------------------------------------------

const BUILD_DIR = path.resolve(import.meta.dirname, "../../data/build");

async function loadCatalog(): Promise<any | null> {
  try {
    return JSON.parse(await readFile(path.join(BUILD_DIR, "catalog.json"), "utf-8"));
  } catch {
    return null;
  }
}

// Die Struktur des Katalogs wird mitgeprüft: Beim Wechsel auf den
// zweistufigen Katalog hat sich dieser Test still übersprungen, statt zu
// scheitern — ein Skip, der wie "Build fehlt" aussah, aber ein Bruch war.
test("Katalogstruktur: Index nennt Jahre und verweist auf die Detaildatei", async (t) => {
  const catalog = await loadCatalog();
  if (!catalog) return t.skip("data/build/ nicht vorhanden");

  const station = catalog.stations.SMA;
  assert.ok(Array.isArray(station.years), "years ist eine Jahresliste");
  assert.ok(station.years.includes(2023));
  assert.match(station.index, /^smn\/sma\/index\.json$/);
  assert.equal(typeof station.capabilities.roomModel, "boolean");
  assert.ok(station.capabilities.roomModel, "an SMA ist das Raummodell rechenbar");
});

test("echtes Stationsjahr aus dem ETL lesen und rechnen", async (t) => {
  const catalog = await loadCatalog();
  const station = catalog?.stations?.SMA;
  if (!station) return t.skip("data/build/ nicht vorhanden — python -m ocbl_data build ausführen");

  // Zweistufiger Katalog: der Index nennt nur die Jahre, die Prüfsummen
  // stehen in der Detaildatei je Station.
  const index = JSON.parse(await readFile(path.join(BUILD_DIR, station.index), "utf-8"));
  const entry = index["2023"];
  assert.ok(entry, "SMA 2023 fehlt in smn/sma/index.json");

  const bytes = await readFile(path.join(BUILD_DIR, entry.path));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actual, entry.sha256, "Katalogprüfsumme stimmt mit der Datei überein");

  const series = readPacked(buffer, entry.sha256);
  assert.equal(series.station, "SMA");
  assert.equal(series.axis.length, 8760, "2023 ist kein Schaltjahr");
  assert.ok(Math.abs(series.altitudeM - 604) < 1e-9);

  const temperature = getVariable(series, "tre200h0");
  const inputs = [series.source];

  // Plausibilitätsschranken für Zürich/Fluntern, bewusst grosszügig:
  // sie sollen Pipeline-Fehler fangen, nicht Klimatologie behaupten.
  const mean = dailyMean(temperature, series.axis);
  const annual = mean.reduce((a, b) => a + b, 0) / mean.length;
  assert.ok(annual > 5 && annual < 16, `Jahresmittel ${annual.toFixed(2)} °C plausibel`);

  const hot = thresholdDays(temperature, series.axis, inputs, { thresholdC: 30 }).value.count;
  assert.ok(hot >= 0 && hot < 60, `Hitzetage ${hot} plausibel`);

  const nights = tropicalNights(temperature, series.axis, inputs).value.count;
  assert.ok(nights >= 0 && nights < 60, `Tropennächte ${nights} plausibel`);

  const cdh = coolingDegreeHours(temperature, inputs, { baseC: 22 }).value.kelvinHours;
  assert.ok(cdh > 0 && cdh < 30000, `Kühlgradstunden ${cdh.toFixed(0)} plausibel`);
});


test("echtes Szenariojahr aus dem ETL lesen", async (t) => {
  let scenarios: any;
  try {
    scenarios = JSON.parse(await readFile(path.join(BUILD_DIR, "scenarios.json"), "utf-8"));
  } catch {
    return t.skip("scenarios.json fehlt — python -m ocbl_data scenarios ausführen");
  }

  const station = scenarios.stations.SMA;
  assert.ok(station, "SMA hat Szenariodaten");
  const index = JSON.parse(await readFile(path.join(BUILD_DIR, station.index), "utf-8"));
  const variant = index["2060_RCP85_dry"];
  assert.ok(variant, "2060 RCP8.5 Referenzjahr vorhanden");

  const bytes = await readFile(path.join(BUILD_DIR, variant.path));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  assert.equal(createHash("sha256").update(bytes).digest("hex"), variant.sha256);

  const series = readPacked(buffer, variant.sha256);
  assert.equal(series.axis.length, 8760, "ein Design Reference Year hat 365 Tage");
  assert.equal(series.axis.label, "start", "Szenarien stempeln den Intervallbeginn");
  assert.equal(series.axis.sampleOffsetMin, 10, "Stichzeitpunkt aus docs/methods/009");
  assert.equal(series.source.collection, "ch.meteoschweiz.klimaszenarien-raumklima");
  assert.match(series.source.license, /terms_by/);

  // Das Referenzjahr liegt auf einem Nicht-Schaltjahr, damit die Datumsangaben
  // nicht ab dem 1. März verrutschen — 2060 selbst ist ein Schaltjahr.
  const startYear = new Date(series.axis.startUtcMs).getUTCFullYear();
  assert.equal(startYear, 2061);
  assert.equal(series.source.year, 2060, "die Periode bleibt 2060");

  const t2 = getVariable(series, "tre200h0");
  const finite = [...t2].filter(Number.isFinite);
  assert.equal(finite.length, 8760, "vollständig");
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  assert.ok(mean > 8 && mean < 16, `Jahresmittel ${mean.toFixed(2)} °C plausibel`);
});
