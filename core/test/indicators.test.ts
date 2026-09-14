import { test } from "node:test";
import assert from "node:assert/strict";
import { hourlyAxis, intervalMidpointUtcMs, localDayIndex, localHour } from "../src/series.ts";
import { computationHash, type Computation, type DatasetRef } from "../src/provenance.ts";
import type { SimulationResult } from "../src/building.ts";
import {
  adaptiveComfortBand,
  coolingDegreeHours,
  dailyExtremes,
  dailyMean,
  exceedanceHours,
  nightVentilationPotential,
  runningMeanOutdoorTemperature,
  thresholdDays,
  tropicalNights,
  type ComfortBand,
} from "../src/indicators.ts";

const YEAR_2021_START = Date.UTC(2021, 0, 1, 0, 0, 0);
const HOURS = 8760;

const SOURCE: DatasetRef = {
  collection: "test",
  station: "TST",
  year: 2021,
  variables: ["tre200h0"],
  sha256: "0".repeat(64),
  license: "CC-BY-4.0",
  attribution: "Testdaten",
};

const axis = hourlyAxis(YEAR_2021_START, HOURS);

/**
 * Minimale Vorgänger für Komfortband und Übertemperaturstunden (ADR 0007).
 * Die Kapazität steuert die Einschwingphase: 0 heisst keine, 3600 J/K bei 1 W/K
 * ergibt τ = 1 h und damit genau einen verworfenen Tag.
 */
function simulationOf(operative: Float64Array, effectiveCapacity = 0): Computation<SimulationResult> {
  return {
    value: {
      operativeTemperature: operative,
      derived: { effectiveCapacity, opaqueConductance: 0.5, windowConductance: 0.5 },
    } as unknown as SimulationResult,
    unit: "°C",
    method: { id: "building.simulate5R1C", version: "test", doc: "", sources: [] },
    params: { windowFraction: 0.4 },
    inputs: [SOURCE],
  };
}

function runningMeanOf(values: Float64Array, alpha = 0.8): Computation<Float64Array> {
  return {
    value: values,
    unit: "°C",
    method: { id: "comfort.runningMeanOutdoorTemperature", version: "test", doc: "", sources: [] },
    params: { alpha },
    inputs: [SOURCE],
  };
}

function bandOf(upper: Float64Array, category = "II"): Computation<ComfortBand> {
  return {
    value: { upper, lower: upper.map((v) => v - 7) },
    unit: "°C",
    method: { id: "comfort.adaptiveComfortBand", version: "test", doc: "", sources: [] },
    params: { category },
    inputs: [SOURCE],
  };
}

function constantSeries(value: number): Float64Array {
  return new Float64Array(HOURS).fill(value);
}

/** Jahresgang plus Tagesgang — grob schweizerisch, aber vollständig deterministisch. */
function syntheticSeries(annualMean: number, annualAmp: number, dailyAmp: number): Float64Array {
  const out = new Float64Array(HOURS);
  for (let i = 0; i < HOURS; i++) {
    const dayOfYear = Math.floor(i / 24);
    const hour = i % 24;
    const annual = -annualAmp * Math.cos((2 * Math.PI * (dayOfYear - 15)) / 365);
    const daily = -dailyAmp * Math.cos((2 * Math.PI * (hour - 15)) / 24);
    out[i] = annualMean + annual + daily;
  }
  return out;
}

test("Zeitachse: Stundenstempel am Intervallende ergibt lokale Stunde 0 für den ersten Wert", () => {
  // MeteoSchweiz-Konvention: "01.01. 00:00" UTC = Intervall 23:00–00:00 UTC
  //                        = 00:00–01:00 MEZ  → lokale Stunde 0
  assert.equal(localHour(axis, 0), 0);
  assert.equal(localHour(axis, 12), 12);
  assert.equal(localDayIndex(axis, 0), 0);
  assert.equal(localDayIndex(axis, 23), 0);
  assert.equal(localDayIndex(axis, 24), 1);
  assert.equal(localDayIndex(axis, HOURS - 1), 364);
});

test("Tagesextreme und Tagesmittel einer konstanten Reihe", () => {
  const { min, max, days } = dailyExtremes(constantSeries(17.5), axis);
  assert.equal(days, 365);
  assert.equal(min[0], 17.5);
  assert.equal(max[200], 17.5);
  assert.equal(dailyMean(constantSeries(17.5), axis)[100], 17.5);
});

test("Tagesmittel ist NaN, sobald eine Stunde des Tages fehlt", () => {
  const s = constantSeries(17.5);
  s[50] = NaN; // Tag 2
  const m = dailyMean(s, axis);
  assert.ok(Number.isNaN(m[2]));
  assert.equal(m[3], 17.5);
});

test("Tropennächte: durchgehend 25 °C ergibt jede vollständige Nacht", () => {
  const r = tropicalNights(constantSeries(25), axis, [SOURCE]);
  // Nacht n = 18–23 Uhr des Tages n plus 0–5 Uhr des Tages n+1.
  // Die letzte Nacht des Jahres ist angebrochen und zählt deshalb nicht mit.
  assert.equal(r.value.count, 364);
  assert.equal(r.unit, "Nächte");
  assert.equal(r.params.thresholdC, 20);
});

test("Tropennächte: knapp unter der Schwelle ergibt null", () => {
  assert.equal(tropicalNights(constantSeries(19.9), axis, [SOURCE]).value.count, 0);
  // Schwelle ist inklusiv
  assert.equal(tropicalNights(constantSeries(20.0), axis, [SOURCE]).value.count, 364);
});

test("Tropennächte: eine einzige kühle Stunde bricht die Nacht", () => {
  const s = constantSeries(25);
  const idx = 3 * 24 + 3; // Tag 3, 03:00 lokal → gehört zu Nacht 2
  s[idx] = 15;
  assert.equal(tropicalNights(s, axis, [SOURCE]).value.count, 363);
});

test("Hitze- und Sommertage über die Schwelle gesteuert", () => {
  const s = constantSeries(27);
  assert.equal(thresholdDays(s, axis, [SOURCE], { thresholdC: 30 }).value.count, 0);
  assert.equal(thresholdDays(s, axis, [SOURCE], { thresholdC: 25 }).value.count, 365);
});

test("Kühlgradstunden: konstante Überschreitung ist exakt Stunden × ΔT", () => {
  const r = coolingDegreeHours(constantSeries(25), [SOURCE], { baseC: 22 });
  assert.equal(r.value.kelvinHours, 3 * HOURS);
  assert.equal(r.unit, "Kh");
  // Unterhalb der Basis wird nicht negativ akkumuliert
  assert.equal(coolingDegreeHours(constantSeries(10), [SOURCE], { baseC: 22 }).value.kelvinHours, 0);
});

test("Nachtlüftungspotenzial zählt nur das Nachtfenster", () => {
  const r = nightVentilationPotential(constantSeries(18), axis, [SOURCE], {
    indoorReferenceC: 24,
    nightStartHour: 22,
    nightEndHour: 6,
  });
  // 22:00–06:00 sind acht Stunden pro Tag
  assert.equal(r.value.hours, 8 * 365);
  assert.equal(r.value.kelvinHours, 6 * 8 * 365);
});

test("Nachtlüftungspotenzial ist null, wenn es nachts wärmer ist als im Raum", () => {
  const r = nightVentilationPotential(constantSeries(28), axis, [SOURCE], { indoorReferenceC: 24 });
  assert.equal(r.value.kelvinHours, 0);
  assert.ok(r.value.hours > 0, "die Stunden werden trotzdem gezählt");
});

test("gleitendes Aussentemperaturmittel konvergiert gegen den konstanten Wert", () => {
  const daily = new Float64Array(365).fill(15);
  const rm = runningMeanOutdoorTemperature(daily, [SOURCE]).value;
  assert.ok(Number.isNaN(rm[6]), "die ersten sieben Tage bleiben undefiniert");
  assert.ok(Math.abs(rm[7] - 15) < 1e-9);
  assert.ok(Math.abs(rm[200] - 15) < 1e-9);
});

test("gleitendes Mittel folgt einem Sprung verzögert und mit α = 0.8", () => {
  const daily = new Float64Array(365).fill(10);
  for (let d = 100; d < 365; d++) daily[d] = 20;
  const rm = runningMeanOutdoorTemperature(daily, [SOURCE]).value;
  assert.ok(Math.abs(rm[100] - 10) < 1e-9, "am Sprungtag noch der alte Wert");
  // Θrm(101) = 0.2·Θed(100) + 0.8·Θrm(100) = 0.2·20 + 0.8·10 = 12
  assert.ok(Math.abs(rm[101] - 12) < 1e-9);
  assert.ok(rm[130] > 19 && rm[130] < 20, "nähert sich asymptotisch");
});

test("adaptives Komfortband nach EN 16798-1, Kategorie II", () => {
  const rm = new Float64Array([20, 20, 20]);
  const band = adaptiveComfortBand(runningMeanOf(rm), { category: "II" }).value;
  // 0.33·20 + 18.8 = 25.4  →  oben +3, unten −4
  assert.ok(Math.abs(band.upper[0] - 28.4) < 1e-9);
  assert.ok(Math.abs(band.lower[0] - 21.4) < 1e-9);

  const catI = adaptiveComfortBand(runningMeanOf(rm), { category: "I" }).value;
  assert.ok(catI.upper[0] < band.upper[0], "Kategorie I ist strenger");
});

test("Komfortband ausserhalb 10…30 °C ist undefiniert statt extrapoliert", () => {
  const band = adaptiveComfortBand(runningMeanOf(new Float64Array([5, 15, 35]))).value;
  assert.ok(Number.isNaN(band.upper[0]));
  assert.ok(Number.isFinite(band.upper[1]));
  assert.ok(Number.isNaN(band.upper[2]));
});

test("Übertemperaturstunden gegen eine Raumtemperaturreihe", () => {
  const limits = new Float64Array(365).fill(28.4);
  const indoor = constantSeries(30); // 1.6 K über der Grenze
  const r = exceedanceHours(simulationOf(indoor), bandOf(limits), axis, { occupiedFromHour: 8, occupiedToHour: 18 });
  assert.equal(r.value.hours, 10 * 365);
  assert.ok(Math.abs(r.value.kelvinHours - 1.6 * 10 * 365) < 1e-6);
  assert.equal(r.value.evaluatedHours, 10 * 365);
});

test("Übertemperaturstunden zählen nicht, wo das Komfortband undefiniert ist", () => {
  const limits = new Float64Array(365).fill(NaN);
  const r = exceedanceHours(simulationOf(constantSeries(35)), bandOf(limits), axis);
  assert.equal(r.value.hours, 0);
  assert.equal(r.value.evaluatedHours, 0, "undefinierte Tage werden gar nicht erst bewertet");
});

test("Tagesstunden summieren auf die Übertemperaturstunden", () => {
  const limits = new Float64Array(365).fill(28.4);
  const r = exceedanceHours(simulationOf(constantSeries(30)), bandOf(limits), axis, { occupiedFromHour: 8, occupiedToHour: 18 });
  const sum = [...r.value.dailyHours].reduce((a, b) => a + b, 0);
  assert.equal(sum, r.value.hours);
  assert.equal(r.value.dailyHours[100], 10);
  assert.ok(Math.abs(r.value.dailyKelvinHours[100] - 16) < 1e-9);
});

test("Tage ohne bewertete Stunde sind NaN, nicht null", () => {
  const limits = new Float64Array(365).fill(28.4);
  limits[200] = NaN; // Komfortband an diesem Tag undefiniert
  const r = exceedanceHours(simulationOf(constantSeries(20)), bandOf(limits), axis, { occupiedFromHour: 8, occupiedToHour: 18 });
  assert.equal(r.value.dailyHours[199], 0, "bewertet, aber keine Überschreitung");
  assert.ok(Number.isNaN(r.value.dailyHours[200]), "nicht bewertet");
  assert.ok(Number.isNaN(r.value.dailyKelvinHours[200]));
});

test("Tagesstunden folgen der Zeitkonvention der Szenarien, nicht dem Stempel", () => {
  // DRY-Konvention nach docs/methods/009: Stempel am Intervallbeginn,
  // Stichzeitpunkt hh:10 UTC, also hh+1:10 Lokalzeit. Heiss sind die Stempel
  // 06:00 bis 17:00 UTC; das ergibt Lokalzeit 07:10 bis 18:10 und liegt damit
  // vollständig im Belegungsfenster 07 bis 19 Uhr: 12 Stunden je Tag.
  //
  // Wer die Lokalstunde aus dem Stempel ableitet statt aus dem Stichzeitpunkt,
  // erhält 06 bis 17 Uhr und damit 11 Stunden. Genau diesen Fehler hatte das
  // Frontend, bei den Szenarien 54 bis 64 Stunden zu viel im Jahr.
  const dryAxis = hourlyAxis(YEAR_2021_START, HOURS, { label: "start", sampleOffsetMin: 10 });
  const indoor = new Float64Array(HOURS);
  for (let i = 0; i < HOURS; i++) indoor[i] = i % 24 >= 6 && i % 24 <= 17 ? 30 : 20;
  const limits = new Float64Array(365).fill(28.4);

  const r = exceedanceHours(simulationOf(indoor), bandOf(limits), dryAxis, { occupiedFromHour: 7, occupiedToHour: 19 });
  for (const d of [0, 1, 180, 364]) assert.equal(r.value.dailyHours[d], 12, `Tag ${d}`);
  assert.equal(r.value.hours, 12 * 365);
  assert.equal([...r.value.dailyHours].reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0), r.value.hours);
});

test("α des gleitenden Mittels geht in den Hash des Komfortbands ein", async () => {
  const rm = new Float64Array([20, 20, 20]);
  const a = adaptiveComfortBand(runningMeanOf(rm, 0.8));
  const b = adaptiveComfortBand(runningMeanOf(rm, 0.7));
  assert.deepEqual([...a.value.upper], [...b.value.upper], "gleiche Werte …");
  assert.notEqual(await computationHash(a), await computationHash(b), "… und trotzdem verschiedene Rechnungen");
});

test("der Hash der Übertemperaturstunden kennt den Raum", async () => {
  // Die Lücke vor ADR 0007: gleiche Wetterdaten, anderer Raum, gleicher Hash.
  const band = bandOf(new Float64Array(365).fill(28.4));
  const a = simulationOf(constantSeries(30));
  const b: Computation<SimulationResult> = { ...simulationOf(constantSeries(30)), params: { windowFraction: 0.7 } };
  const ra = exceedanceHours(a, band, axis, { occupiedFromHour: 8, occupiedToHour: 18 });
  const rb = exceedanceHours(b, band, axis, { occupiedFromHour: 8, occupiedToHour: 18 });
  assert.equal(ra.value.hours, rb.value.hours, "gleiche Werte …");
  assert.notEqual(await computationHash(ra), await computationHash(rb), "… aber verschiedene Räume");
});

test("die Einschwingphase verwirft exceedanceHours() selbst", () => {
  const limits = new Float64Array(365).fill(28.4);
  const r = exceedanceHours(simulationOf(constantSeries(30), 3600), bandOf(limits), axis, { occupiedFromHour: 8, occupiedToHour: 18 });
  assert.equal(r.params.warmupHours, 24);
  assert.ok(Number.isNaN(r.value.dailyHours[0]), "der erste Tag ist nicht bewertet");
  assert.equal(r.value.hours, 10 * 364);
});

test("der Vorlauf der Simulation wird auf die Einschwingphase angerechnet", () => {
  const limits = new Float64Array(365).fill(28.4);
  const withSpinUp = (spinUpHours: number) => {
    const sim = simulationOf(constantSeries(30), 3600 * 5); // τ = 5 h, Einschwingphase 48 h
    (sim.value as { spinUpHours: number }).spinUpHours = spinUpHours;
    return exceedanceHours(sim, bandOf(limits), axis, { occupiedFromHour: 8, occupiedToHour: 18 });
  };

  assert.equal(withSpinUp(0).params.warmupHours, 48, "ohne Vorlauf wie bisher");
  assert.equal(withSpinUp(24).params.warmupHours, 24, "Vorlauf kürzer als die Einschwingphase: nur der Rest");
  const full = withSpinUp(48);
  assert.equal(full.params.warmupHours, 0, "Vorlauf deckt sie ab: nichts verworfen");
  assert.equal(full.value.hours, 10 * 365, "jeder Tag des Jahres bewertet");
  assert.equal(withSpinUp(500).params.warmupHours, 0, "nie negativ");
});

test("die Kategorie kommt aus dem Komfortband", () => {
  const r = exceedanceHours(simulationOf(constantSeries(30)), bandOf(new Float64Array(365).fill(28.4), "III"), axis);
  assert.equal(r.params.category, "III");
});

test("Eingangsdaten und Vorgänger stehen in der Übertemperatur-Berechnung", () => {
  const r = exceedanceHours(simulationOf(constantSeries(30)), bandOf(new Float64Array(365).fill(28.4)), axis);
  assert.deepEqual(r.inputs, [SOURCE], "derselbe Datensatz aus beiden Vorgängern steht nur einmal da");
  assert.deepEqual(r.upstream?.map((u) => u.role), ["simulation", "comfortBand"]);
});

test("eine Zeitachse anderer Länge wird abgewiesen", () => {
  assert.throws(
    () => exceedanceHours(simulationOf(constantSeries(30)), bandOf(new Float64Array(365).fill(28.4)), hourlyAxis(YEAR_2021_START, 24)),
    /passt nicht zur Simulation/,
  );
});

test("synthetischer Jahresgang liefert plausible Kennwerte", () => {
  const s = syntheticSeries(10, 9, 5); // Mittel 10 °C, Sommer bis ~24 °C
  const hot = thresholdDays(s, axis, [SOURCE], { thresholdC: 30 }).value.count;
  const summer = thresholdDays(s, axis, [SOURCE], { thresholdC: 25 }).value.count;
  assert.equal(hot, 0, "Spitze bleibt unter 30 °C");
  assert.equal(summer, 0, "und unter 25 °C");
  const cdh = coolingDegreeHours(s, [SOURCE], { baseC: 18 }).value.kelvinHours;
  assert.ok(cdh > 0 && cdh < 20000, `Kühlgradstunden ${cdh} in plausibler Grössenordnung`);
});

test("Fehlwerte propagieren als NaN und senken die Vollständigkeit", () => {
  const s = constantSeries(25);
  for (let i = 0; i < 876; i++) s[i * 10] = NaN;
  const r = tropicalNights(s, axis, [SOURCE]);
  assert.ok(Math.abs(r.value.completeness - 0.9) < 0.01);
  assert.ok(r.value.count < 364, "unvollständige Nächte werden nicht gezählt");
});

test("ein ausdrücklicher Stichzeitpunkt schlägt die Intervallmitte", () => {
  // Manche Quellen meinen nicht die Mitte: Für die DRY-Datensätze der
  // Klimaszenarien liegt der repräsentative Zeitpunkt bei +10 min.
  const stampAxis = hourlyAxis(YEAR_2021_START, 24, { label: "start" });
  const dryAxis = hourlyAxis(YEAR_2021_START, 24, { label: "start", sampleOffsetMin: 10 });

  const stamp = YEAR_2021_START;
  assert.equal(intervalMidpointUtcMs(stampAxis, 0), stamp + 30 * 60_000, "ohne Angabe die Mitte");
  assert.equal(intervalMidpointUtcMs(dryAxis, 0), stamp + 10 * 60_000, "mit Angabe der Stichzeitpunkt");
  assert.equal(intervalMidpointUtcMs(dryAxis, 5), stamp + (5 * 60 + 10) * 60_000);

  // Die Konvention "end" bleibt für die Messreihen unverändert.
  assert.equal(intervalMidpointUtcMs(axis, 0), stamp - 30 * 60_000);
});
