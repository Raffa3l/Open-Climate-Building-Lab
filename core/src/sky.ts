/**
 * Langwelliger Strahlungsaustausch mit dem Himmel.
 *
 * Herleitung: docs/methods/008-langwellige-abstrahlung.md
 *
 * Die Atmosphäre strahlt schwächer als ein schwarzer Körper auf Lufttemperatur.
 * Eine Fläche mit Himmelssicht verliert dadurch Wärme über das hinaus, was der
 * U-Wert abbildet — nachts unter klarem Himmel deutlich, unter Wolken kaum.
 */

import type { MethodRef } from "./provenance.ts";

/** Stefan-Boltzmann-Konstante, W/(m²K⁴). */
export const STEFAN_BOLTZMANN = 5.670374419e-8;

/**
 * Wärmeübergangswiderstand aussen, m²K/W. ISO 6946, normale Exposition.
 * Bestimmt, welcher Anteil des Temperaturgefälles an der Aussenoberfläche
 * liegt — und damit, wie stark die Himmelsabstrahlung überhaupt durchschlägt.
 */
export const R_SE = 0.04;

/**
 * Äusserer Strahlungsübergangskoeffizient, W/(m²K).
 * EN ISO 13790 §11.4.6: h_r = 5·ε, mit ε ≈ 0.9 für übliche Baustoffe.
 */
export const H_R = 4.5;

/**
 * Pauschalwert für θ_Luft − θ_Himmel, K, wenn keine Messung vorliegt.
 * EN ISO 13790 §11.4.6 für gemässigte Zonen.
 *
 * Der Pauschalwert ist ein Jahresmittel und kann eine klare Nacht nicht von
 * einer bedeckten unterscheiden. An Zürich/Fluntern 2023 gemessen: Mittel
 * 9.8 K, aber Spannweite 1.4 K bis 25.3 K. Wo `oli000h0` vorliegt, ist die
 * Messung deshalb klar vorzuziehen.
 */
export const DELTA_SKY_DEFAULT_K = 11;

export const METHOD_SKY_TEMPERATURE: MethodRef = {
  id: "sky.temperature",
  version: "1.0.0",
  doc: "docs/methods/008-langwellige-abstrahlung.md#himmelstemperatur",
  sources: ["en-iso-13790-2008"],
};

/**
 * Scheinbare Himmelstemperatur aus der gemessenen langwelligen
 * Einstrahlung, °C.
 *
 *   E_sky = σ · T_sky⁴   →   T_sky = (E_sky / σ)^¼
 *
 * `E_sky` ist die abwärts gerichtete langwellige Strahlung, in den
 * SMN-Stundendateien `oli000h0`.
 */
export function skyTemperature(downwellingLongwave: number): number {
  if (!Number.isFinite(downwellingLongwave) || downwellingLongwave <= 0) return NaN;
  return Math.pow(downwellingLongwave / STEFAN_BOLTZMANN, 0.25) - 273.15;
}

/**
 * Zusätzlicher Wärmestrom eines Bauteils durch Abstrahlung gegen den Himmel, W.
 *
 *   Φ_r = R_se · U_c · A_c · h_r · Δθ_sky      (EN ISO 13790 §11.3.5)
 *
 * Der Faktor R_se · U_c ist entscheidend und wird oft übersehen: Er ist der
 * Anteil des Temperaturgefälles, der an der Aussenoberfläche liegt. Bei einer
 * gut gedämmten Wand (U = 0.2) sind das 0.8 %, bei einem Fenster (U = 1.0)
 * 4 %. Die Abstrahlung trifft also vor allem schlecht gedämmte Bauteile.
 *
 * Der Rückgabewert ist ein **Verlust** und wird vom solaren Eintrag abgezogen,
 * gewichtet mit dem Formfaktor zum Himmel.
 */
export function skyRadiationLoss(
  uValue: number,
  area: number,
  deltaSkyK: number,
): number {
  if (!Number.isFinite(deltaSkyK) || deltaSkyK <= 0) return 0;
  return R_SE * uValue * area * H_R * deltaSkyK;
}
