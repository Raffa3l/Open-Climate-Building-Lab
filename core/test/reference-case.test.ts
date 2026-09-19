import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hourlyAxis, type StationSeries } from "../src/series.ts";
import type { Computation, DatasetRef } from "../src/provenance.ts";
import type { ExceedanceResult } from "../src/indicators.ts";
import {
  DEFAULT_ROOM_SETTINGS,
  ROOM_SETTING_CHOICES,
  ROOM_SETTING_RANGES,
  climateLabel,
  climateShortLabel,
  evaluateReferenceCase,
  isScenarioKey,
  peakOperativeTemperature,
  referenceRoom,
  roomSettingsFromParams,
  roomSettingsToParams,
  type RoomSettings,
} from "../src/reference-case.ts";
import { referenceCaseExport } from "../src/export.ts";

const SOURCE: DatasetRef = {
  collection: "test",
  station: "TST",
  year: 2021,
  variables: ["tre200h0", "gre000h0"],
  sha256: "0".repeat(64),
  license: "CC-BY-4.0",
  attribution: "Testdaten",
  title: "Synthetische Reihe",
  url: "https://example.org/test",
};

const STATION = { name: "Teststation", canton: "ZH", altitudeM: 556, lat: 47.38, lon: 8.57 };

/** 60 Sommertage: länger als der Vorlauf (840 h) und lang genug für das gleitende Mittel. */
function syntheticSeries(source: DatasetRef = SOURCE): StationSeries {
  const hours = 24 * 60;
  const outdoor = Float64Array.from({ length: hours }, (_, i) => 22 + 7 * Math.sin(((i % 24) - 9) / 24 * 2 * Math.PI));
  const global = Float64Array.from({ length: hours }, (_, i) => Math.max(0, 800 * Math.sin(((i % 24) - 5) / 15 * Math.PI)));
  return {
    station: "TST",
    altitudeM: STATION.altitudeM,
    axis: hourlyAxis(Date.UTC(2021, 5, 1), hours),
    source,
    variables: new Map([
      ["tre200h0", { code: "tre200h0", unit: "°C", values: outdoor }],
      ["gre000h0", { code: "gre000h0", unit: "W/m²", values: global }],
    ]),
  };
}

// --- Permalink ----------------------------------------------------------------

test("Permalink: ohne Schlüssel gelten die Vorgaben, Hin- und Rückweg sind verlustfrei", () => {
  assert.deepEqual(roomSettingsFromParams(new URLSearchParams()), DEFAULT_ROOM_SETTINGS);

  const changed: RoomSettings = {
    azimuth: 225, massClass: "sehr schwer", skyModel: "isotrop", windowFraction: 0.7,
    shading: 0.35, overhang: 1.2, gains: 30, nightVent: 5.5, nightVentOn: false,
  };
  for (const s of [DEFAULT_ROOM_SETTINGS, changed]) {
    assert.deepEqual(roomSettingsFromParams(new URLSearchParams(roomSettingsToParams(s))), s);
  }
});

test("Permalink: jede Reglerstellung ergibt dieselbe Zahl wie Number() im Browser", () => {
  for (const [key, { min, max, step }] of Object.entries(ROOM_SETTING_RANGES)) {
    const decimals = (String(step).split(".")[1] ?? "").length;
    for (let k = 0; min + k * step <= max + 1e-9; k++) {
      const text = (min + k * step).toFixed(decimals);
      const read = roomSettingsFromParams(new URLSearchParams({ [key]: text }));
      const expected = key === "windowFraction" ? Number(text) / 100 : Number(text);
      assert.equal(read[key as keyof RoomSettings], expected, `${key}=${text}`);
    }
  }
});

test("Permalink: Werte, die kein Regler annehmen kann, brechen ab statt still zu runden", () => {
  for (const query of [
    "windowFraction=37", "windowFraction=95", "shading=0", "gains=-1", "nightVent=abc", "gains=",
    "massClass=massiv", "azimuth=45", "skyModel=Perez", "nightVentOn=true",
  ]) {
    assert.throws(() => roomSettingsFromParams(new URLSearchParams(query)), Error, query);
  }
});

test("web/index.html bietet genau die Stellungen und Vorgaben des Kerns", async () => {
  const html = await readFile(path.resolve(import.meta.dirname, "../../web/index.html"), "utf-8");

  for (const [id, allowed] of Object.entries(ROOM_SETTING_CHOICES)) {
    const block = new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`).exec(html);
    assert.ok(block, `<select id="${id}"> fehlt`);
    const options = [...block[1].matchAll(/<option value="([^"]*)"( selected)?/g)];
    assert.deepEqual(options.map((m) => m[1]), allowed.map(String), `Optionen von ${id}`);
    // Ohne `selected` wählt der Browser die erste Option.
    const chosen = options.find((m) => m[2]) ?? options[0];
    assert.equal(chosen[1], String(DEFAULT_ROOM_SETTINGS[id as keyof RoomSettings]), `Vorgabe von ${id}`);
  }

  for (const [id, range] of Object.entries(ROOM_SETTING_RANGES)) {
    const input = new RegExp(`<input type="range" id="${id}"([^>]*)>`).exec(html);
    assert.ok(input, `<input id="${id}"> fehlt`);
    const attr = (name: string) => Number(new RegExp(`${name}="([^"]+)"`).exec(input[1])![1]);
    assert.deepEqual({ min: attr("min"), max: attr("max"), step: attr("step") }, range, `Bereich von ${id}`);
    const fallback = DEFAULT_ROOM_SETTINGS[id as keyof RoomSettings] as number;
    assert.equal(attr("value"), id === "windowFraction" ? Math.round(fallback * 100) : fallback, `Vorgabe von ${id}`);
  }

  const checkbox = /<input type="checkbox" id="nightVentOn"([^>]*)>/.exec(html);
  assert.ok(checkbox);
  assert.equal(/\bchecked\b/.test(checkbox[1]), DEFAULT_ROOM_SETTINGS.nightVentOn);
});

// --- Raum und Klimastand ------------------------------------------------------

test("Referenzraum: Fensteranteil ohne Gleitkommarest in der Geometrie", () => {
  const room = referenceRoom(DEFAULT_ROOM_SETTINGS);
  assert.equal(room.windows[0].area, 3.92);
  assert.equal(room.opaqueArea, 5.88);
  assert.equal(room.windows[0].shading.factorClosed, 0.3);
  assert.equal(referenceRoom({ ...DEFAULT_ROOM_SETTINGS, shading: 1 }).windows[0].shading.activationIrradiance, Infinity);
  assert.equal(referenceRoom({ ...DEFAULT_ROOM_SETTINGS, nightVentOn: false }).nightVentilation, undefined);
  assert.equal(referenceRoom({ ...DEFAULT_ROOM_SETTINGS, nightVent: 0 }).nightVentilation, undefined);
});

test("Klimastand: Beschriftung aus dem Schlüssel, unbekannte Schlüssel brechen ab", () => {
  assert.equal(climateLabel("y2024"), "gemessen 2024");
  assert.equal(climateLabel("s2060_RCP85_dry"), "Szenario 2060 · RCP 8.5 · Referenzjahr");
  assert.equal(climateLabel("s2035_RCP26_warmsummer"), "Szenario 2035 · RCP 2.6 · warmer Sommer (1 in 10)");
  assert.equal(climateShortLabel("s2060_RCP85_dry"), "2060 RCP 8.5");
  assert.equal(climateShortLabel("s2060_RCP85_warmsummer"), "2060 RCP 8.5, warmer Sommer");
  assert.equal(isScenarioKey("y2023"), false);
  for (const bad of ["2024", "y24", "s2060_RCP85", "s2060_rcp85_dry", ""]) {
    assert.throws(() => isScenarioKey(bad), Error, bad);
  }
});

// --- Auswertung und Export ----------------------------------------------------

test("Spitzentemperatur: die Einschwingphase zählt nicht, Fehlwerte auch nicht", () => {
  const fake = (operative: number[], warmupHours: number) => ({
    params: { warmupHours },
    upstream: [{ role: "simulation", computation: { value: { operativeTemperature: Float64Array.from(operative) } } }],
  }) as unknown as Computation<ExceedanceResult>;

  assert.equal(peakOperativeTemperature(fake([50, 40, 25, NaN, 27], 2)), 27);
  assert.ok(Number.isNaN(peakOperativeTemperature(fake([50, 40], 2))));
});

test("Export: Name, Rollen und Subjekt kommen aus der Berechnung", async () => {
  const series = syntheticSeries();
  const { simulation, exceedance } = evaluateReferenceCase(series, STATION, DEFAULT_ROOM_SETTINGS);
  const files = await referenceCaseExport({
    station: "TST", stationInfo: STATION, climateKey: "y2021",
    settings: DEFAULT_ROOM_SETTINGS, series, exceedance,
  });

  assert.match(files.csvName, /^ocbl_TST_y2021_[0-9a-f]{12}\.csv$/);
  assert.equal(files.jsonName, files.csvName.replace(/\.csv$/, ".json"));
  assert.equal(files.csv.split("\r\n").length - 2, series.axis.length);

  const manifest = JSON.parse(files.json);
  assert.deepEqual(manifest.computations.map((c: { role: string }) => c.role),
    ["simulation", "exceedance", "comfortBand", "runningMean"]);
  assert.equal(manifest.subject.windowFraction, 0.4);
  assert.equal(manifest.subject.comfortCategory, "II");
  assert.equal(manifest.subject.calendarYear, 2021);
  // Der Vorlauf deckt die Einschwingphase ab: nichts verworfen, jede Stunde gültig.
  assert.equal(manifest.warmupHours, 0);
  assert.equal(simulation.value.spinUpHours, 840);
  assert.ok(Number.isFinite(simulation.value.operativeTemperature[0]));
  assert.equal(manifest.computations[0].value.peakOperativeC, Math.round(peakOperativeTemperature(exceedance) * 1e6) / 1e6);
  assert.ok(exceedance.value.evaluatedHours > 0, "die Reihe ist lang genug, um bewertet zu werden");
  assert.equal(simulation.params.massClass, "mittel");
});

test("Export: Einstellungen oder Datensatz einer anderen Rechnung werden abgelehnt", async () => {
  const series = syntheticSeries();
  const { exceedance } = evaluateReferenceCase(series, STATION, DEFAULT_ROOM_SETTINGS);
  const base = { station: "TST", stationInfo: STATION, climateKey: "y2021", settings: DEFAULT_ROOM_SETTINGS, series, exceedance };

  for (const settings of [
    { ...DEFAULT_ROOM_SETTINGS, windowFraction: 0.7 },
    { ...DEFAULT_ROOM_SETTINGS, azimuth: 90 },
    { ...DEFAULT_ROOM_SETTINGS, nightVentOn: false },
    { ...DEFAULT_ROOM_SETTINGS, shading: 0.2 },
  ]) {
    await assert.rejects(referenceCaseExport({ ...base, settings }), /passen nicht zur Simulation/);
  }
  await assert.rejects(
    referenceCaseExport({ ...base, series: syntheticSeries({ ...SOURCE, sha256: "1".repeat(64) }) }),
    /nicht auf dem Datensatz/,
  );
});
