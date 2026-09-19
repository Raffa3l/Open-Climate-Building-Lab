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
 * (ADR 0007): Der Trend kennt damit Raum, Bewertung und jeden Datensatz, und
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
