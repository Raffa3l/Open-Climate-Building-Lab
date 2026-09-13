import { test } from "node:test";
import assert from "node:assert/strict";
import { alignDailyToCalendarYear } from "../src/series.ts";

/** Tagesindex eines Datums innerhalb seines Kalenderjahres. */
function dayOf(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000);
}

/** Reihe, in der jeder Tag seinen eigenen Index trägt — Verschiebungen fallen sofort auf. */
function counting(length: number): Float64Array {
  return Float64Array.from({ length }, (_, i) => i);
}

test("Nicht-Schaltjahr auf Schaltjahr: die Daten bleiben stehen, der Index verschiebt sich", () => {
  const aligned = alignDailyToCalendarYear(counting(365), 2001, 2024, 366);

  assert.equal(aligned[dayOf(2024, 1, 1)], dayOf(2001, 1, 1));
  assert.equal(aligned[dayOf(2024, 2, 28)], dayOf(2001, 2, 28));
  assert.equal(aligned[dayOf(2024, 8, 1)], dayOf(2001, 8, 1));
  assert.equal(aligned[dayOf(2024, 12, 31)], dayOf(2001, 12, 31));

  // Ab dem 1. März stehen die Indizes um einen Tag auseinander — genau der
  // Fehler, den eine Abbildung über den Laufindex stillschweigend machen würde.
  assert.equal(aligned[dayOf(2024, 3, 1)], 59);
  assert.equal(dayOf(2024, 3, 1), 60);
});

test("Ein 29. Februar ohne Gegenstück bleibt NaN, nicht interpoliert", () => {
  const aligned = alignDailyToCalendarYear(counting(365), 2001, 2024, 366);
  assert.ok(Number.isNaN(aligned[dayOf(2024, 2, 29)]));
});

test("Schaltjahr auf Nicht-Schaltjahr: der 29. Februar fällt weg", () => {
  const aligned = alignDailyToCalendarYear(counting(366), 2024, 2001, 365);

  assert.equal(aligned[dayOf(2001, 2, 28)], dayOf(2024, 2, 28));
  assert.equal(aligned[dayOf(2001, 3, 1)], dayOf(2024, 3, 1));
  assert.equal(aligned[dayOf(2001, 12, 31)], dayOf(2024, 12, 31));
  // Der Wert des 29. Februar taucht in der Zielreihe nirgends auf.
  assert.ok(![...aligned].includes(dayOf(2024, 2, 29)));
});

test("Gleiches Jahr ist die Identität", () => {
  const source = counting(365);
  const aligned = alignDailyToCalendarYear(source, 2001, 2001, 365);
  assert.deepEqual([...aligned], [...source]);
});

test("Eine kürzere Quelle füllt nur, was sie hat", () => {
  // Ein halbes Jahr Daten auf ein volles Jahr gelegt: der Rest bleibt undefiniert
  // statt sich zu wiederholen.
  const aligned = alignDailyToCalendarYear(counting(180), 2001, 2001, 365);
  assert.equal(aligned[179], 179);
  assert.ok(Number.isNaN(aligned[180]));
  assert.ok(Number.isNaN(aligned[364]));
});

test("NaN in der Quelle bleibt NaN im Ziel", () => {
  const source = counting(365);
  source[100] = NaN;
  const aligned = alignDailyToCalendarYear(source, 2001, 2002, 365);
  assert.ok(Number.isNaN(aligned[100]));
});
