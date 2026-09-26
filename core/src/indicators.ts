/**
 * Klima- und Komfortkennwerte aus Stundenreihen.
 *
 * Jede Funktion gibt eine Computation zurück, nicht eine nackte Zahl. Die
 * Schwellenwerte sind durchgehend Parameter mit dokumentiertem Standardwert —
 * wer eine Zahl publiziert, publiziert damit zwingend auch die Definition,
 * unter der sie gilt.
 *
 * Herleitungen: docs/methods/002-heat-indicators.md
 */

import type { Computation, DatasetRef, MethodRef } from "./provenance.ts";
import { mergeInputs } from "./provenance.ts";
import { warmupHoursFromDerived, type SimulationResult } from "./building.ts";
import { completeness, localDayIndex, localHour, type TimeAxis } from "./series.ts";

const M_TROPICAL_NIGHTS: MethodRef = {
  id: "indicator.tropicalNights",
  version: "1.0.0",
  doc: "docs/methods/002-heat-indicators.md#tropennächte",
  sources: ["meteoschweiz-klimaindikatoren"],
};

const M_THRESHOLD_DAYS: MethodRef = {
  id: "indicator.thresholdDays",
  version: "1.0.0",
  doc: "docs/methods/002-heat-indicators.md#sommer--und-hitzetage",
  sources: ["meteoschweiz-klimaindikatoren"],
};

const M_COOLING_DEGREE_HOURS: MethodRef = {
  id: "indicator.coolingDegreeHours",
  version: "1.0.0",
  doc: "docs/methods/002-heat-indicators.md#kühlgradstunden",
  sources: ["ashrae-fundamentals-2021"],
};

const M_RUNNING_MEAN: MethodRef = {
  id: "comfort.runningMeanOutdoorTemperature",
  version: "1.0.0",
  doc: "docs/methods/003-adaptive-comfort.md#gleitendes-aussentemperaturmittel",
  sources: ["en16798-1"],
};

const M_ADAPTIVE_BAND: MethodRef = {
  id: "comfort.adaptiveComfortBand",
  version: "2.0.0",
  doc: "docs/methods/003-adaptive-comfort.md#komfortband",
  sources: ["en16798-1"],
};

const M_NIGHT_VENTILATION: MethodRef = {
  id: "indicator.nightVentilationPotential",
  version: "1.0.0",
  doc: "docs/methods/002-heat-indicators.md#nachtlüftungspotenzial",
  sources: ["sia180-2014"],
};

/** Gemeinsames Ergebnisformat für Zählkennwerte. */
export interface CountResult {
  count: number;
  /** Anteil gültiger Eingangswerte, 0…1. Unter 0.9 ist die Zahl mit Vorsicht zu lesen. */
  completeness: number;
}

// ---------------------------------------------------------------------------
// Tagesaggregation
// ---------------------------------------------------------------------------

/** Tagesminimum und -maximum je lokalem Kalendertag. NaN, wo keine Werte. */
export function dailyExtremes(
  temperature: Float64Array,
  axis: TimeAxis,
): { min: Float64Array; max: Float64Array; days: number } {
  const days = localDayIndex(axis, axis.length - 1) + 1;
  const min = new Float64Array(days).fill(Number.POSITIVE_INFINITY);
  const max = new Float64Array(days).fill(Number.NEGATIVE_INFINITY);

  for (let i = 0; i < axis.length; i++) {
    const t = temperature[i];
    if (!Number.isFinite(t)) continue;
    const d = localDayIndex(axis, i);
    if (t < min[d]) min[d] = t;
    if (t > max[d]) max[d] = t;
  }
  for (let d = 0; d < days; d++) {
    if (!Number.isFinite(min[d])) min[d] = NaN;
    if (!Number.isFinite(max[d])) max[d] = NaN;
  }
  return { min, max, days };
}

/**
 * Tagesmittel je lokalem Kalendertag.
 *
 * Bewusst das arithmetische Mittel der Stundenwerte und nicht (Tmin+Tmax)/2 —
 * die beiden Definitionen unterscheiden sich in der Schweiz um mehrere Zehntel
 * Kelvin und wandern damit direkt in das gleitende Mittel des Komfortmodells.
 */
export function dailyMean(temperature: Float64Array, axis: TimeAxis): Float64Array {
  const days = localDayIndex(axis, axis.length - 1) + 1;
  const sum = new Float64Array(days);
  const n = new Int32Array(days);

  for (let i = 0; i < axis.length; i++) {
    const t = temperature[i];
    if (!Number.isFinite(t)) continue;
    const d = localDayIndex(axis, i);
    sum[d] += t;
    n[d]++;
  }

  const out = new Float64Array(days);
  // Ein Tag gilt nur als vollständig, wenn alle 24 Stunden vorliegen.
  for (let d = 0; d < days; d++) out[d] = n[d] === 24 ? sum[d] / n[d] : NaN;
  return out;
}

// ---------------------------------------------------------------------------
// Hitzekennwerte
// ---------------------------------------------------------------------------

export interface TropicalNightParams {
  /** Schwelle in °C. Standard 20.0 nach MeteoSchweiz. */
  thresholdC?: number;
  /** Beginn des Nachtfensters, lokale Stunde. Standard 18. */
  nightStartHour?: number;
  /** Ende des Nachtfensters am Folgetag, lokale Stunde. Standard 6. */
  nightEndHour?: number;
}

/**
 * Tropennächte: Nächte, in denen die Temperatur im Fenster 18:00–06:00 nicht
 * unter die Schwelle fällt.
 *
 * Das Nachtfenster ist der Grund, warum die Zeitkonvention stimmen muss —
 * eine um eine Stunde verschobene Achse verändert das Ergebnis messbar.
 */
export function tropicalNights(
  temperature: Float64Array,
  axis: TimeAxis,
  inputs: DatasetRef[],
  params: TropicalNightParams = {},
): Computation<CountResult> {
  const thresholdC = params.thresholdC ?? 20.0;
  const nightStartHour = params.nightStartHour ?? 18;
  const nightEndHour = params.nightEndHour ?? 6;

  // Nacht n läuft von nightStartHour des Tages n bis nightEndHour des Tages n+1.
  const nights = new Map<number, { min: number; hours: number }>();

  for (let i = 0; i < axis.length; i++) {
    const h = localHour(axis, i);
    const inEvening = h >= nightStartHour;
    const inMorning = h < nightEndHour;
    if (!inEvening && !inMorning) continue;

    const day = localDayIndex(axis, i);
    const night = inEvening ? day : day - 1;
    if (night < 0) continue;

    const t = temperature[i];
    const entry = nights.get(night) ?? { min: Number.POSITIVE_INFINITY, hours: 0 };
    if (Number.isFinite(t)) {
      entry.min = Math.min(entry.min, t);
      entry.hours++;
    }
    nights.set(night, entry);
  }

  // Erwartete Fensterlänge; angebrochene Nächte am Reihenrand zählen nicht mit.
  const expectedHours = 24 - nightStartHour + nightEndHour;
  let count = 0;
  for (const entry of nights.values()) {
    if (entry.hours === expectedHours && entry.min >= thresholdC) count++;
  }

  return {
    value: { count, completeness: completeness(temperature) },
    unit: "Nächte",
    method: M_TROPICAL_NIGHTS,
    params: { thresholdC, nightStartHour, nightEndHour },
    inputs,
  };
}

/**
 * Tage, an denen das Tagesmaximum eine Schwelle erreicht.
 * Hitzetag 30 °C, Sommertag 25 °C — beide über denselben Parameter.
 */
export function thresholdDays(
  temperature: Float64Array,
  axis: TimeAxis,
  inputs: DatasetRef[],
  params: { thresholdC?: number } = {},
): Computation<CountResult> {
  const thresholdC = params.thresholdC ?? 30.0;
  const { max, days } = dailyExtremes(temperature, axis);

  let count = 0;
  for (let d = 0; d < days; d++) if (Number.isFinite(max[d]) && max[d] >= thresholdC) count++;

  return {
    value: { count, completeness: completeness(temperature) },
    unit: "Tage",
    method: M_THRESHOLD_DAYS,
    params: { thresholdC },
    inputs,
  };
}

/**
 * Kühlgradstunden, Kh — Summe der Überschreitungen einer Basistemperatur.
 *
 * Die Basistemperatur ist eine Konvention, keine Naturkonstante. 22 °C ist im
 * Schweizer Gebäudekontext gebräuchlich; wer 18.3 °C nach ASHRAE verwendet,
 * erhält andere Zahlen und muss das mitpublizieren. Genau dafür steht der
 * Parameter in der Provenance.
 */
export function coolingDegreeHours(
  temperature: Float64Array,
  inputs: DatasetRef[],
  params: { baseC?: number } = {},
): Computation<{ kelvinHours: number; completeness: number }> {
  const baseC = params.baseC ?? 22.0;
  let sum = 0;
  for (const t of temperature) if (Number.isFinite(t) && t > baseC) sum += t - baseC;

  return {
    value: { kelvinHours: sum, completeness: completeness(temperature) },
    unit: "Kh",
    method: M_COOLING_DEGREE_HOURS,
    params: { baseC },
    inputs,
  };
}

/**
 * Nachtlüftungspotenzial, Kh — im Nachtfenster verfügbares Temperaturgefälle
 * gegenüber einer Raumreferenztemperatur.
 *
 * Bewusst rein aussenklimatisch: das ist das *Angebot*. Wie viel davon ein
 * Gebäude nutzen kann, hängt an Speichermasse und Luftwechsel und gehört in
 * das Raummodell, nicht in diese Kennzahl.
 */
export function nightVentilationPotential(
  temperature: Float64Array,
  axis: TimeAxis,
  inputs: DatasetRef[],
  params: { indoorReferenceC?: number; nightStartHour?: number; nightEndHour?: number } = {},
): Computation<{ kelvinHours: number; hours: number; completeness: number }> {
  const indoorReferenceC = params.indoorReferenceC ?? 24.0;
  const nightStartHour = params.nightStartHour ?? 22;
  const nightEndHour = params.nightEndHour ?? 6;

  let kelvinHours = 0;
  let hours = 0;
  for (let i = 0; i < axis.length; i++) {
    const h = localHour(axis, i);
    if (!(h >= nightStartHour || h < nightEndHour)) continue;
    const t = temperature[i];
    if (!Number.isFinite(t)) continue;
    hours++;
    if (t < indoorReferenceC) kelvinHours += indoorReferenceC - t;
  }

  return {
    value: { kelvinHours, hours, completeness: completeness(temperature) },
    unit: "Kh",
    method: M_NIGHT_VENTILATION,
    params: { indoorReferenceC, nightStartHour, nightEndHour },
    inputs,
  };
}

// ---------------------------------------------------------------------------
// Adaptiver Komfort nach EN 16798-1
// ---------------------------------------------------------------------------

/**
 * Gleitendes Aussentemperaturmittel Θrm nach EN 16798-1, Anhang B.
 *
 *   Θrm = (1 − α) · Θed−1 + α · Θrm−1     mit α = 0.8
 *
 * Anlaufwert aus den sieben Vortagen mit den in der Norm angegebenen Gewichten.
 * Die ersten sieben Tage der Reihe liefern deshalb NaN — Extrapolation wäre
 * hier eine Erfindung, kein Ergebnis.
 */
export function runningMeanOutdoorTemperature(
  dailyMeanC: Float64Array,
  inputs: DatasetRef[],
  params: { alpha?: number } = {},
): Computation<Float64Array> {
  const alpha = params.alpha ?? 0.8;
  const n = dailyMeanC.length;
  const rm = new Float64Array(n).fill(NaN);

  const weights = [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2];
  const weightSum = 3.8;

  for (let d = 7; d < n; d++) {
    if (Number.isFinite(rm[d - 1])) {
      rm[d] = (1 - alpha) * dailyMeanC[d - 1] + alpha * rm[d - 1];
    } else {
      let acc = 0;
      let ok = true;
      for (let k = 0; k < 7; k++) {
        const v = dailyMeanC[d - 1 - k];
        if (!Number.isFinite(v)) { ok = false; break; }
        acc += weights[k] * v;
      }
      if (ok) rm[d] = acc / weightSum;
    }
  }

  return { value: rm, unit: "°C", method: M_RUNNING_MEAN, params: { alpha }, inputs };
}

export type ComfortCategory = "I" | "II" | "III";

/** Zulässige Abweichung nach oben je Kategorie, K. */
const UPPER_OFFSET: Record<ComfortCategory, number> = { I: 2, II: 3, III: 4 };
/** Zulässige Abweichung nach unten je Kategorie, K. */
const LOWER_OFFSET: Record<ComfortCategory, number> = { I: 3, II: 4, III: 5 };

export interface ComfortBand {
  upper: Float64Array;
  lower: Float64Array;
}

/**
 * Adaptives Komfortband für frei laufende Gebäude, EN 16798-1.
 *
 *   Θo,max = 0.33 · Θrm + 18.8 + Δ_oben
 *   Θo,min = 0.33 · Θrm + 18.8 − Δ_unten
 *
 * Gültig für 10 °C ≤ Θrm ≤ 30 °C (obere Grenze); ausserhalb NaN.
 *
 * Wichtig: Die Grenzen beziehen sich auf die **operative Raumtemperatur**.
 * Diese Funktion liefert deshalb nur das Band aus dem Aussenklima — die
 * Übertemperaturstunden entstehen erst im Zusammenspiel mit einer
 * Raumtemperaturreihe, siehe exceedanceHours().
 *
 * Seit 2.0.0 nimmt die Funktion das gleitende Mittel als Computation, nicht als
 * nackte Reihe. Dessen Parameter α geht damit in den Hash des Bandes ein; zuvor
 * ergaben zwei verschiedene α denselben Band-Hash.
 */
export function adaptiveComfortBand(
  runningMean: Computation<Float64Array>,
  params: { category?: ComfortCategory } = {},
): Computation<ComfortBand> {
  const category = params.category ?? "II";
  const runningMeanC = runningMean.value;
  const n = runningMeanC.length;
  const upper = new Float64Array(n).fill(NaN);
  const lower = new Float64Array(n).fill(NaN);

  for (let d = 0; d < n; d++) {
    const rm = runningMeanC[d];
    if (!Number.isFinite(rm) || rm < 10 || rm > 30) continue;
    const centre = 0.33 * rm + 18.8;
    upper[d] = centre + UPPER_OFFSET[category];
    lower[d] = centre - LOWER_OFFSET[category];
  }

  return {
    value: { upper, lower },
    unit: "°C",
    method: M_ADAPTIVE_BAND,
    params: { category },
    inputs: mergeInputs(runningMean.inputs),
    upstream: [{ role: "runningMean", computation: runningMean }],
  };
}

export interface ExceedanceResult {
  hours: number;
  kelvinHours: number;
  evaluatedHours: number;
  /** Übertemperaturstunden je lokalem Tag; `NaN`, wo keine Stunde bewertet wurde. */
  dailyHours: Float64Array;
  /** Kelvinstunden je lokalem Tag; `NaN`, wo keine Stunde bewertet wurde. */
  dailyKelvinHours: Float64Array;
}

/**
 * Übertemperaturstunden: Stunden, in denen die operative Raumtemperatur die
 * adaptive Obergrenze des jeweiligen Tages überschreitet.
 *
 * Seit 2.0.0 nimmt die Funktion die Simulation und das Komfortband als
 * Computation entgegen, nicht als nackte Reihen. Das hat drei Folgen:
 *
 * - Der Hash kennt den Raum. Zuvor ergaben 40 % und 70 % Fensteranteil 403 und
 *   662 Stunden unter demselben Hash, weil die Raumparameter nur in der
 *   Simulation standen.
 * - Aussentemperaturen lassen sich nicht mehr versehentlich einsetzen: Der Typ
 *   verlangt ein Simulationsergebnis.
 * - Die Einschwingphase verwirft die Funktion selbst, aus den abgeleiteten
 *   Kenngrössen der Simulation. Die Stundenzahl steht in `params.warmupHours`.
 *   Seit 2.1.0 zählt der Vorlauf der Simulation dagegen: Hat sie mindestens
 *   so lange vorgerechnet (Standard seit simulate5R1C 1.3.0), wird nichts
 *   verworfen und das ganze Jahr bewertet.
 *
 * Die Kategorie kommt aus dem Komfortband und wird nicht ein zweites Mal
 * angegeben. Zwei Angaben könnten sich widersprechen.
 *
 * Neben den Jahressummen liefert die Funktion dieselben Grössen je Tag. Aus
 * derselben Schleife gezählt, summieren sie immer auf die Kennzahl; an Tagen
 * ohne bewertete Stunde stehen sie auf `NaN`. Siehe
 * docs/methods/003-adaptive-comfort.md#tageswerte.
 *
 * `axis` muss die Zeitachse des Datensatzes sein, aus dem die Simulation
 * gerechnet wurde. Ihre Konvention steht im `.ocbl`-Header und damit in der
 * Prüfsumme der Eingangsdaten.
 */
export function exceedanceHours(
  simulation: Computation<SimulationResult>,
  comfortBand: Computation<ComfortBand>,
  axis: TimeAxis,
  params: { occupiedFromHour?: number; occupiedToHour?: number } = {},
): Computation<ExceedanceResult> {
  const category = String(comfortBand.params.category);
  const occupiedFromHour = params.occupiedFromHour ?? 0;
  const occupiedToHour = params.occupiedToHour ?? 24;
  // Der Vorlauf der Simulation hat die Einschwingphase schon abgebaut; verworfen
  // wird nur, was er nicht abdeckt. Mit spinUpHours 0 wie bis 2.0.0.
  const warmupHours = Math.max(
    0,
    warmupHoursFromDerived(simulation.value.derived) - (simulation.value.spinUpHours ?? 0),
  );
  const operativeTemperatureC = simulation.value.operativeTemperature;
  const dailyUpperLimitC = comfortBand.value.upper;

  if (operativeTemperatureC.length !== axis.length) {
    throw new Error(`Zeitachse (${axis.length} h) passt nicht zur Simulation (${operativeTemperatureC.length} h)`);
  }

  let hours = 0;
  let kelvinHours = 0;
  let evaluatedHours = 0;
  const days = dailyUpperLimitC.length;
  const dailyHours = new Float64Array(days).fill(NaN);
  const dailyKelvinHours = new Float64Array(days).fill(NaN);

  for (let i = warmupHours; i < axis.length; i++) {
    const h = localHour(axis, i);
    if (h < occupiedFromHour || h >= occupiedToHour) continue;
    const d = localDayIndex(axis, i);
    const limit = dailyUpperLimitC[d];
    const t = operativeTemperatureC[i];
    if (!Number.isFinite(limit) || !Number.isFinite(t)) continue;
    evaluatedHours++;
    // Erste bewertete Stunde des Tages: ab hier gilt 0 statt «nicht bewertet».
    if (Number.isNaN(dailyHours[d])) {
      dailyHours[d] = 0;
      dailyKelvinHours[d] = 0;
    }
    if (t > limit) {
      hours++;
      kelvinHours += t - limit;
      dailyHours[d]++;
      dailyKelvinHours[d] += t - limit;
    }
  }

  return {
    value: { hours, kelvinHours, evaluatedHours, dailyHours, dailyKelvinHours },
    unit: "h",
    method: {
      id: "comfort.exceedanceHours",
      version: "2.1.0",
      doc: "docs/methods/003-adaptive-comfort.md#übertemperaturstunden",
      sources: ["en16798-1", "sia180-2014"],
    },
    params: { category, occupiedFromHour, occupiedToHour, warmupHours },
    inputs: mergeInputs(simulation.inputs, comfortBand.inputs),
    upstream: [
      { role: "simulation", computation: simulation },
      { role: "comfortBand", computation: comfortBand },
    ],
  };
}
