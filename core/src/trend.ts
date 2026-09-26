/**
 * Linearer Trend einer Kennzahl über die Messjahre einer Station.
 *
 * Die Jahre sind keine Stichprobe aus einer Verteilung, sondern eine Zeitreihe
 * mit starker Streuung: Ein Rekordsommer wie 2003 liegt weit über seinen
 * Nachbarn. Die Gerade beschreibt deshalb die mittlere Verschiebung, keine
 * Vorhersage, und das Bestimmtheitsmass steht daneben, damit man sieht, wie
 * wenig davon sie erklärt.
 *
 * Siehe docs/methods/012-mehrjahresverlauf.md.
 */

import { mergeInputs, type Computation, type MethodRef } from "./provenance.ts";
import type { ExceedanceResult } from "./indicators.ts";

export const METHOD_LINEAR_TREND: MethodRef = {
  id: "stats.linearTrend",
  version: "1.0.0",
  doc: "docs/methods/012-mehrjahresverlauf.md#trend",
  sources: ["anscombe-1973"],
};

export const METHOD_PERIOD_MEAN: MethodRef = {
  id: "stats.periodMean",
  version: "1.0.0",
  doc: "docs/methods/012-mehrjahresverlauf.md#normalperiode",
  sources: ["anscombe-1973"],
};

/** Normalperiode, gegen die Szenarien zu lesen sind (009). */
export const NORMAL_PERIOD = { fromYear: 1991, toYear: 2020, minYears: 24 } as const;

export interface LeastSquares {
  slope: number;
  intercept: number;
  /** Bestimmtheitsmass r², 0…1. */
  rSquared: number;
  n: number;
}

/**
 * Gerade nach der Methode der kleinsten Quadrate. Unter drei Punkten ist eine
 * Streuung nicht bestimmbar; dann kommt NaN statt einer Geraden durch zwei Punkte.
 */
export function ordinaryLeastSquares(x: ArrayLike<number>, y: ArrayLike<number>): LeastSquares {
  if (x.length !== y.length) throw new Error(`${x.length} x-Werte, aber ${y.length} y-Werte`);
  const n = x.length;
  const none = { slope: NaN, intercept: NaN, rSquared: NaN, n };
  if (n < 3) return none;

  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += x[i] / n;
    meanY += y[i] / n;
  }
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return none;
  const slope = sxy / sxx;
  return {
    slope,
    intercept: meanY - slope * meanX,
    rSquared: syy === 0 ? NaN : (sxy * sxy) / (sxx * syy),
    n,
  };
}

export interface PeriodMean {
  mean: number;
  /** Jahre der Periode, die eingingen. */
  count: number;
  years: number[];
}

/**
 * Mittel der Übertemperaturstunden über eine Periode, etwa die Normalperiode
 * 1991–2020.
 *
 * Ein Design Reference Year ist kein Mittel gemessener Jahre; gegen ein
 * einzelnes Jahr oder fünf aktuelle gelesen erscheint ein Szenario kühler als
 * die Gegenwart (009). Die Basis ist deshalb eine Normalperiode, und sie gilt
 * erst, wenn genug ihrer Jahre vorliegen: Unter `minYears` kommt NaN.
 */
export function exceedancePeriodMean(
  byYear: ReadonlyArray<{ year: number; exceedance: Computation<ExceedanceResult> }>,
  period: { fromYear: number; toYear: number; minYears: number } = NORMAL_PERIOD,
): Computation<PeriodMean> {
  const inside = [...byYear]
    .filter((r) => r.year >= period.fromYear && r.year <= period.toYear)
    .sort((a, b) => a.year - b.year);
  const values = inside.map((r) => r.exceedance.value.hours);
  const mean = values.length >= period.minYears && values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : NaN;
  return {
    value: { mean, count: inside.length, years: inside.map((r) => r.year) },
    unit: "h",
    method: METHOD_PERIOD_MEAN,
    params: {
      quantity: "Übertemperaturstunden",
      fromYear: period.fromYear,
      toYear: period.toYear,
      minYears: period.minYears,
      count: inside.length,
    },
    inputs: mergeInputs(...inside.map((r) => r.exceedance.inputs)),
    upstream: inside.map((r) => ({ role: `y${r.year}`, computation: r.exceedance })),
  };
}

export interface YearTrend {
  /** Steigung je Jahrzehnt, in der Einheit der Kennzahl. */
  perDecade: number;
  slope: number;
  intercept: number;
  rSquared: number;
  years: number[];
  values: number[];
  /** Die Gerade an jedem Jahr, damit keine Darstellung sie nachrechnet. */
  fitted: number[];
}

/**
 * Trend der Übertemperaturstunden über Messjahre.
 *
 * Jede Jahresauswertung hängt als Vorgänger mit der Rolle `y<Jahr>` im Hash
 * (verkettete Hashes): Der Trend kennt damit Raum, Bewertung und jeden Datensatz, und
 * ein anderes Jahr oder ein anderer Raum ergibt einen anderen Hash.
 */
export function exceedanceTrend(
  byYear: ReadonlyArray<{ year: number; exceedance: Computation<ExceedanceResult> }>,
): Computation<YearTrend> {
  const sorted = [...byYear].sort((a, b) => a.year - b.year);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].year === sorted[i - 1].year) throw new Error(`Jahr ${sorted[i].year} doppelt`);
  }
  const years = sorted.map((r) => r.year);
  const values = sorted.map((r) => r.exceedance.value.hours);
  const fit = ordinaryLeastSquares(years, values);

  return {
    value: {
      perDecade: 10 * fit.slope,
      slope: fit.slope,
      intercept: fit.intercept,
      rSquared: fit.rSquared,
      years,
      values,
      fitted: years.map((y) => fit.intercept + fit.slope * y),
    },
    unit: "h/10 a",
    method: METHOD_LINEAR_TREND,
    params: {
      quantity: "Übertemperaturstunden",
      fromYear: years[0] ?? NaN,
      toYear: years[years.length - 1] ?? NaN,
      count: years.length,
    },
    inputs: mergeInputs(...sorted.map((r) => r.exceedance.inputs)),
    upstream: sorted.map((r) => ({ role: `y${r.year}`, computation: r.exceedance })),
  };
}
