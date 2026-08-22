import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DELTA_SKY_DEFAULT_K,
  H_R,
  R_SE,
  STEFAN_BOLTZMANN,
  skyRadiationLoss,
  skyTemperature,
} from "../src/sky.ts";

const near = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≉ ${b} (Toleranz ${tol})`);

test("Himmelstemperatur ist die Umkehrung von Stefan-Boltzmann", () => {
  // Ein schwarzer Körper bei 0 °C strahlt σ·273.15⁴ = 315.7 W/m²
  const atZero = STEFAN_BOLTZMANN * 273.15 ** 4;
  near(atZero, 315.66, 0.1, "Abstrahlung bei 0 °C");
  near(skyTemperature(atZero), 0, 1e-9, "Rundlauf");

  // Werte aus der SMN-Messreihe: oli000h0 lag 2023 zwischen 207 und 440 W/m²
  near(skyTemperature(207), -27.35, 0.05, "klarer Winterhimmel");
  near(skyTemperature(440), 23.65, 0.05, "schwüle Sommernacht");
});

test("Himmelstemperatur steigt streng mit der Einstrahlung", () => {
  let previous = -Infinity;
  for (let e = 150; e <= 500; e += 10) {
    const t = skyTemperature(e);
    assert.ok(t > previous, `bei ${e} W/m² fiel die Temperatur auf ${t}`);
    previous = t;
  }
});

test("unbrauchbare Einstrahlung ergibt NaN statt einer Zahl", () => {
  assert.ok(Number.isNaN(skyTemperature(0)));
  assert.ok(Number.isNaN(skyTemperature(-5)));
  assert.ok(Number.isNaN(skyTemperature(NaN)));
});

test("Abstrahlungsverlust folgt der Normformel", () => {
  // Φ_r = R_se · U · A · h_r · Δθ
  const expected = R_SE * 1.0 * 3.92 * H_R * 10;
  near(skyRadiationLoss(1.0, 3.92, 10), expected, 1e-12);
  near(skyRadiationLoss(1.0, 3.92, 10), 7.056, 0.001, "Fenster U=1.0, 3.92 m², 10 K");
});

test("gut gedämmte Bauteile verlieren kaum durch Abstrahlung", () => {
  // R_se · U ist der Anteil des Gefälles an der Aussenoberfläche:
  // 4 % beim Fenster, 0.8 % bei der gedämmten Wand.
  const window = skyRadiationLoss(1.0, 10, 11);
  const wall = skyRadiationLoss(0.2, 10, 11);
  near(wall / window, 0.2, 1e-9, "verhält sich wie die U-Werte");

  const oldWall = skyRadiationLoss(1.5, 10, 11);
  assert.ok(oldWall > window, "ein ungedämmter Altbau verliert mehr als ein Fenster");
});

test("kein Gefälle, kein Verlust", () => {
  assert.equal(skyRadiationLoss(1.0, 10, 0), 0);
  assert.equal(skyRadiationLoss(1.0, 10, -3), 0, "negatives Gefälle wird nicht zum Gewinn");
  assert.equal(skyRadiationLoss(1.0, 10, NaN), 0);
});

test("Pauschalwert der Norm liegt im gemessenen Bereich", () => {
  // Zürich/Fluntern 2023: Mittel 9.8 K, 5–95 % zwischen 1.4 und 19.8 K
  assert.ok(DELTA_SKY_DEFAULT_K > 1.4 && DELTA_SKY_DEFAULT_K < 19.8);
});
