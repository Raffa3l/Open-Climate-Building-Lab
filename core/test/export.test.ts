import { test } from "node:test";
import assert from "node:assert/strict";
import { hourlyAxis, type TimeAxis } from "../src/series.ts";
import { exceedanceHours, type ComfortBand } from "../src/indicators.ts";
import { computationHash, type Computation, type DatasetRef } from "../src/provenance.ts";
import type { SimulationResult } from "../src/building.ts";
import { HOURLY_COLUMNS, exportManifest, hourlyCsv, sha256Hex } from "../src/export.ts";

const START = Date.UTC(2021, 0, 1, 0, 0, 0);
const HOURS = 48;

const SOURCE: DatasetRef = {
  collection: "test",
  station: "TST",
  year: 2021,
  variables: ["tre200h0"],
  sha256: "0".repeat(64),
  license: "CC-BY-4.0",
  attribution: "Testdaten",
  title: "Synthetische Reihe",
  url: "https://example.org/test",
};

/**
 * Heiss (30 °C) bei den Stempeln 06:00 bis 17:00 UTC, sonst 20 °C. Gegen eine
 * Grenze von 28.4 °C und das Fenster 07 bis 19 Uhr unterscheiden sich die
 * beiden Zeitkonventionen damit um genau eine Stunde je Tag.
 *
 * `warmupDay` setzt die abgeleiteten Kenngrössen so, dass τ = 1 h ist und
 * exceedanceHours() genau einen Tag verwirft.
 */
function fixture(axis: TimeAxis, warmupDay = false) {
  const operative = new Float64Array(HOURS);
  for (let i = 0; i < HOURS; i++) operative[i] = i % 24 >= 6 && i % 24 <= 17 ? 30 : 20;
  operative[30] = NaN; // ein Fehlwert mitten im Fenster

  const simulation: Computation<SimulationResult> = {
    value: {
      operativeTemperature: operative,
      airTemperature: operative.map((v) => v + 0.5),
      massTemperature: operative.map((v) => v - 1),
      solarGains: new Float64Array(HOURS).fill(120.04),
      skyLoss: new Float64Array(HOURS).fill(-0.0001), // rundet auf «-0.0»
      longwaveSource: "pauschal",
      shadedHours: 0,
      nightVentilationHours: 0,
      occupiedHours: 0,
      derived: { effectiveCapacity: warmupDay ? 3600 : 0, opaqueConductance: 0.5, windowConductance: 0.5 },
    } as unknown as SimulationResult,
    unit: "°C",
    method: { id: "building.simulate5R1C", version: "test", doc: "", sources: [] },
    params: {},
    inputs: [SOURCE],
  };
  const comfortBand: Computation<ComfortBand> = {
    value: { upper: new Float64Array(2).fill(28.4), lower: new Float64Array(2).fill(21.4) },
    unit: "°C",
    method: { id: "comfort.adaptiveComfortBand", version: "test", doc: "", sources: [] },
    params: { category: "II" },
    inputs: [SOURCE],
  };

  const exceedance = exceedanceHours(simulation, comfortBand, axis, { occupiedFromHour: 7, occupiedToHour: 19 });
  const outdoor = new Float64Array(HOURS).fill(18);

  const csv = hourlyCsv({ axis, outdoorTemperature: outdoor, exceedance });
  return { csv, exceedance };
}

function parse(csv: string) {
  const lines = csv.split("\r\n");
  assert.equal(lines.pop(), "", "Datei endet mit CRLF");
  const [head, ...rows] = lines;
  const names = head.split(";");
  return { names, rows: rows.map((r) => Object.fromEntries(r.split(";").map((v, k) => [names[k], v]))) };
}

test("CSV: Kopf, Zeilenzahl, Trenner und Zeilenende", () => {
  const { csv } = fixture(hourlyAxis(START, HOURS));
  const { names, rows } = parse(csv);
  assert.deepEqual(names, HOURLY_COLUMNS.map((c) => c.name));
  assert.equal(rows.length, HOURS);
  assert.ok(!csv.includes(","), "kein Komma, weder als Trenner noch als Dezimalzeichen");
  assert.ok(/^[\x20-\x7e]+$/.test(csv.split("\r\n")[0]), "Spaltenköpfe in ASCII");
});

test("CSV: Fehlwerte sind leer, nie 'NaN', und es gibt kein '-0'", () => {
  const { csv } = fixture(hourlyAxis(START, HOURS));
  const { rows } = parse(csv);
  assert.ok(!csv.includes("NaN"));
  assert.ok(!/(^|;)-0\.0+(;|$)/m.test(csv), "negative Null wird zu 0");
  assert.equal(rows[30].theta_op_C, "");
  assert.equal(rows[30].bewertet, "0", "eine Stunde ohne Temperatur ist nicht bewertet");
  assert.equal(rows[30].ueber_grenze_K, "");
  assert.equal(rows[0].phi_r_W, "0.0");
  assert.equal(rows[0].phi_sol_W, "120.0");
});

for (const [name, axis, expectedHours] of [
  ["Messreihe, Stempel am Intervallende", hourlyAxis(START, HOURS), 22],
  ["Szenario, Intervallbeginn und Stichzeitpunkt +10 min", hourlyAxis(START, HOURS, { label: "start", sampleOffsetMin: 10 }), 23],
] as const) {
  test(`CSV summiert auf die Kennzahl: ${name}`, () => {
    const { csv, exceedance } = fixture(axis);
    const { rows } = parse(csv);
    const overRows = rows.filter((r) => r.ueber_grenze_K !== "" && Number(r.ueber_grenze_K) > 0).length;
    const evaluatedRows = rows.filter((r) => r.bewertet === "1").length;
    const kelvin = rows.reduce((s, r) => s + (r.ueber_grenze_K === "" ? 0 : Number(r.ueber_grenze_K)), 0);

    assert.equal(overRows, exceedance.value.hours);
    assert.equal(evaluatedRows, exceedance.value.evaluatedHours);
    assert.ok(Math.abs(kelvin - exceedance.value.kelvinHours) < 1e-6);
    // Unabhängiger Anker, von Hand aus den Konventionen abgeleitet: 11 bzw. 12
    // heisse Stunden je Tag im Fenster. Der Fehlwert an Index 30 (Stempel
    // 2021-01-02 06:00 UTC) liegt bei der Messreihe lokal um 06:30, also vor dem
    // Fenster, und kostet nichts. Beim Szenario liegt er lokal um 07:10 im
    // Fenster und kostet eine Stunde.
    assert.equal(exceedance.value.hours, expectedHours);
  });
}

test("CSV: Lokalzeit folgt dem Stichzeitpunkt, nicht dem Stempel", () => {
  const dry = parse(fixture(hourlyAxis(START, HOURS, { label: "start", sampleOffsetMin: 10 })).csv).rows;
  // Stempel 2021-01-01 00:00 UTC, Intervallbeginn, +10 min: 01:10 Lokalzeit
  assert.equal(dry[0].zeitstempel_utc, "2021-01-01T00:00Z");
  assert.equal(dry[0].lokal_stunde, "1");
  assert.equal(dry[0].lokal_tag, "2021-01-01");
  // Stempel 23:00 UTC meint hier 23:10 UTC, lokal also schon den Folgetag
  assert.equal(dry[23].lokal_stunde, "0");
  assert.equal(dry[23].lokal_tag, "2021-01-02");

  const measured = parse(fixture(hourlyAxis(START, HOURS)).csv).rows;
  // Stempel 00:00 UTC am Intervallende: Mitte 23:30 UTC am Vortag, lokal 00:30
  assert.equal(measured[0].lokal_stunde, "0");
  assert.equal(measured[0].lokal_tag, "2021-01-01");
});

test("CSV: die Einschwingphase ist markiert und nie bewertet", () => {
  const { csv, exceedance } = fixture(hourlyAxis(START, HOURS), true);
  const { rows } = parse(csv);
  assert.ok(rows.slice(0, 24).every((r) => r.einschwingphase === "1" && r.bewertet === "0"));
  assert.ok(rows.slice(24).every((r) => r.einschwingphase === "0"));
  assert.notEqual(rows[10].theta_op_C, "", "die Temperatur selbst bleibt sichtbar");
  assert.equal(rows.filter((r) => r.bewertet === "1").length, exceedance.value.evaluatedHours);
});

test("Manifest: Hash, kanonische Form und Prüfsumme der CSV sind nachrechenbar", async () => {
  const axis = hourlyAxis(START, HOURS);
  const { csv, exceedance } = fixture(axis);
  const input = {
    csv,
    csvFileName: "test.csv",
    subject: { station: "TST" },
    axis,
    warmupHours: 0,
    computations: [{ role: "exceedance", computation: exceedance as Computation<unknown>, value: { hours: exceedance.value.hours } }],
  };
  const manifest = await exportManifest(input);
  const entry = manifest.computations[0];

  assert.equal(entry.hash, await computationHash(exceedance));
  assert.equal(await sha256Hex(entry.canonicalForm), entry.hash, "SHA-256 der kanonischen Form ist der Hash");
  assert.equal(manifest.file.sha256, await sha256Hex(csv));
  assert.deepEqual(manifest.citations, ["Testdaten · Synthetische Reihe · https://example.org/test · CC-BY-4.0"]);
  assert.ok(!("value" in manifest.computations[0]) || typeof entry.value?.hours === "number");
});

test("Manifest: zwei Exporte desselben Sachverhalts sind byte-gleich", async () => {
  const axis = hourlyAxis(START, HOURS);
  const make = async () => {
    const { csv, exceedance } = fixture(axis);
    return JSON.stringify(await exportManifest({
      csv, csvFileName: "a.csv", subject: {}, axis, warmupHours: 0,
      computations: [{ role: "exceedance", computation: exceedance as Computation<unknown> }],
    }));
  };
  assert.equal(await make(), await make());
});
