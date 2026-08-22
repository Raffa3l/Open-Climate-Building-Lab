import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { MISSING_I16, readPacked, type PackHeader } from "../src/pack.ts";
import { getVariable } from "../src/series.ts";
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

test("echtes Stationsjahr aus dem ETL lesen und rechnen", async (t) => {
  const catalog = await loadCatalog();
  const entry = catalog?.stations?.SMA?.years?.["2023"];
  if (!entry) return t.skip("data/build/ nicht vorhanden — python -m ocbl_data build ausführen");

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
