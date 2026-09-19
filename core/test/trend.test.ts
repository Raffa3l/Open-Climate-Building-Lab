import { test } from "node:test";
import assert from "node:assert/strict";
import { computationHash, type Computation } from "../src/provenance.ts";
import type { ExceedanceResult } from "../src/indicators.ts";
import { exceedancePeriodMean, exceedanceTrend, ordinaryLeastSquares } from "../src/trend.ts";
import { isCompleteMeasuredYear } from "../src/reference-case.ts";

// Anscombe (1973): vier Datensätze mit derselben Regressionsgeraden
// y = 3.00 + 0.500 x und demselben Korrelationskoeffizienten 0.816.
const X = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
const ANSCOMBE: Array<[number[], number[]]> = [
  [X, [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68]],
  [X, [9.14, 8.14, 8.74, 8.77, 9.26, 8.10, 6.13, 3.10, 9.13, 7.26, 4.74]],
  [X, [7.46, 6.77, 12.74, 7.11, 7.81, 8.84, 6.08, 5.39, 8.15, 6.42, 5.73]],
  [[8, 8, 8, 8, 8, 8, 8, 19, 8, 8, 8], [6.58, 5.76, 7.71, 8.84, 8.47, 7.04, 5.25, 12.50, 5.56, 7.91, 6.89]],
];

test("kleinste Quadrate treffen Anscombes Gerade in allen vier Datensätzen", () => {
  for (const [i, [x, y]] of ANSCOMBE.entries()) {
    const fit = ordinaryLeastSquares(x, y);
    assert.ok(Math.abs(fit.slope - 0.5) < 0.001, `Satz ${i + 1}: Steigung ${fit.slope}`);
    assert.ok(Math.abs(fit.intercept - 3) < 0.01, `Satz ${i + 1}: Achsenabschnitt ${fit.intercept}`);
    assert.ok(Math.abs(Math.sqrt(fit.rSquared) - 0.816) < 0.001, `Satz ${i + 1}: r ${Math.sqrt(fit.rSquared)}`);
  }
});

test("unter drei Punkten oder ohne Streuung in x gibt es keine Gerade", () => {
  assert.ok(Number.isNaN(ordinaryLeastSquares([1, 2], [3, 4]).slope));
  assert.ok(Number.isNaN(ordinaryLeastSquares([5, 5, 5], [1, 2, 3]).slope));
  assert.throws(() => ordinaryLeastSquares([1, 2, 3], [1, 2]), /y-Werte/);
});

function fakeYear(year: number, hours: number, windowFraction = 0.4): { year: number; exceedance: Computation<ExceedanceResult> } {
  return {
    year,
    exceedance: {
      value: { hours, kelvinHours: 0, evaluatedHours: 2000, dailyHours: new Float64Array(), dailyKelvinHours: new Float64Array() },
      unit: "h",
      method: { id: "comfort.exceedanceHours", version: "2.1.0", doc: "", sources: [] },
      params: { category: "II", windowFraction },
      inputs: [{
        collection: "test", station: "TST", year, variables: ["tre200h0"], sha256: String(year).padStart(64, "0"),
        license: "CC-BY-4.0", attribution: "Testdaten",
      }],
    },
  };
}

test("Trend der Übertemperaturstunden: Steigung je Jahrzehnt, Gerade an jedem Jahr", () => {
  const rows = [2000, 2001, 2002, 2003, 2004].map((y) => fakeYear(y, 300 + 5 * (y - 2000)));
  const trend = exceedanceTrend(rows.reverse());
  assert.ok(Math.abs(trend.value.perDecade - 50) < 1e-9);
  assert.deepEqual(trend.value.years, [2000, 2001, 2002, 2003, 2004]);
  assert.ok(trend.value.fitted.every((f, i) => Math.abs(f - trend.value.values[i]) < 1e-9));
  assert.equal(trend.value.rSquared, 1);
  assert.equal(trend.inputs.length, 5);
  assert.deepEqual(trend.upstream!.map((u) => u.role), ["y2000", "y2001", "y2002", "y2003", "y2004"]);
  assert.throws(() => exceedanceTrend([fakeYear(2000, 1), fakeYear(2000, 2), fakeYear(2001, 3)]), /doppelt/);
});

test("der Hash des Trends kennt jedes Jahr und seinen Raum", async () => {
  const years = [2000, 2001, 2002, 2003];
  const base = await computationHash(exceedanceTrend(years.map((y) => fakeYear(y, 300))));
  const otherRoom = await computationHash(exceedanceTrend(years.map((y) => fakeYear(y, 300, y === 2002 ? 0.6 : 0.4))));
  const fewer = await computationHash(exceedanceTrend(years.slice(1).map((y) => fakeYear(y, 300))));
  assert.notEqual(base, otherRoom);
  assert.notEqual(base, fewer);
  // Der Wert geht nicht ein, wie überall (zentrale Invariante).
  assert.equal(base, await computationHash(exceedanceTrend(years.map((y) => fakeYear(y, 999)))));
});

test("Periodenmittel trifft Anscombes Mittelwert 7.50", () => {
  // Anscombe (1973): In allen vier Datensätzen ist das Mittel von y 7.50.
  for (const [i, [, y]] of ANSCOMBE.entries()) {
    const rows = y.map((v, k) => fakeYear(2000 + k, v));
    const mean = exceedancePeriodMean(rows, { fromYear: 2000, toYear: 2010, minYears: 11 });
    assert.ok(Math.abs(mean.value.mean - 7.5) < 0.005, `Satz ${i + 1}: ${mean.value.mean}`);
    assert.equal(mean.value.count, 11);
  }
});

test("Normalperiode: nur ihre Jahre, und erst ab genug Jahren ein Mittel", async () => {
  const rows = [];
  for (let y = 1985; y <= 2024; y++) rows.push(fakeYear(y, y <= 2020 ? 300 : 500));
  const normal = exceedancePeriodMean(rows);
  assert.equal(normal.value.mean, 300);
  assert.equal(normal.value.count, 30);
  assert.deepEqual([normal.value.years[0], normal.value.years[29]], [1991, 2020]);
  assert.equal(normal.upstream!.length, 30);

  // 23 von 30 Jahren reichen nicht.
  const sparse = exceedancePeriodMean(rows.filter((r) => r.year < 1991 || r.year > 1997));
  assert.equal(sparse.value.count, 23);
  assert.ok(Number.isNaN(sparse.value.mean));

  // Ein anderer Raum in einem einzigen Jahr ergibt einen anderen Hash.
  const other = rows.map((r) => (r.year === 2005 ? fakeYear(2005, 300, 0.6) : r));
  assert.notEqual(await computationHash(normal), await computationHash(exceedancePeriodMean(other)));
});

test("ein Messjahr zählt im Vergleich über Jahre ab 95 % Temperatur und Strahlung", () => {
  assert.ok(isCompleteMeasuredYear({ tre200h0: 1, gre000h0: 0.95 }));
  assert.ok(!isCompleteMeasuredYear({ tre200h0: 1, gre000h0: 0.94 }));
  assert.ok(!isCompleteMeasuredYear({ tre200h0: 0.9, gre000h0: 1 }));
  assert.ok(!isCompleteMeasuredYear({ tre200h0: 1 }));
  assert.ok(!isCompleteMeasuredYear(undefined));
});
