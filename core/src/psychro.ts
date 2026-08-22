/**
 * Feuchte Luft — die Grundgrössen.
 *
 * Herleitung und Gültigkeitsbereiche: docs/methods/001-psychrometrics.md
 *
 * Einheiten durchgängig: Temperatur °C, Druck hPa, relative Feuchte %,
 * Feuchtegehalt kg/kg trockene Luft, Enthalpie kJ/kg trockene Luft.
 * Abweichungen davon sind Fehler, keine Konvention.
 */

import type { MethodRef } from "./provenance.ts";

/** Standardluftdruck auf Meereshöhe. */
export const P_ATM_SEA_LEVEL = 1013.25;

/** Spezifische Gaskonstante Wasserdampf, J/(kg·K). */
const R_V = 461.5;

/** Wärmekapazität trockene Luft, kJ/(kg·K). */
const C_PA = 1.006;
/** Wärmekapazität Wasserdampf, kJ/(kg·K). */
const C_PV = 1.86;
/** Verdampfungsenthalpie Wasser bei 0 °C, kJ/kg. */
const H_FG0 = 2501;
/** Verhältnis der Molmassen Wasser/Luft. */
const EPSILON = 0.62198;

/**
 * Psychrometerkonstante für ventilierte Messung über Wasser, 1/K.
 * WMO-No. 8. Über Eis gilt 5.75e-4; das ist hier bewusst nicht implementiert,
 * siehe Gültigkeitsbereich in der Methodendoku.
 */
const PSYCHROMETER_A = 6.53e-4;

export const METHOD_SATURATION: MethodRef = {
  id: "psychro.saturationVapourPressure",
  version: "1.0.0",
  doc: "docs/methods/001-psychrometrics.md#sättigungsdampfdruck",
  sources: ["sonntag1990", "wmo-no8"],
};

export const METHOD_WET_BULB: MethodRef = {
  id: "psychro.wetBulbTemperature",
  version: "1.0.0",
  doc: "docs/methods/001-psychrometrics.md#feuchtkugeltemperatur",
  sources: ["wmo-no8"],
};

export const METHOD_ENTHALPY: MethodRef = {
  id: "psychro.specificEnthalpy",
  version: "1.0.0",
  doc: "docs/methods/001-psychrometrics.md#spezifische-enthalpie",
  sources: ["ashrae-fundamentals-2021"],
};

/**
 * Sättigungsdampfdruck über Wasser nach Magnus/Sonntag (1990), hPa.
 *
 *   e_s(T) = 6.112 · exp( 17.62 · T / (243.12 + T) )
 *
 * Gültig −45 … +60 °C. Auch unter 0 °C wird über *Wasser* gerechnet, weil
 * MeteoSchweiz die relative Feuchte so referenziert — bei Bezug auf Eis
 * entstünden sonst systematische Abweichungen im Winter.
 */
export function saturationVapourPressure(tCelsius: number): number {
  return 6.112 * Math.exp((17.62 * tCelsius) / (243.12 + tCelsius));
}

/** Tatsächlicher Dampfdruck aus Temperatur und relativer Feuchte, hPa. */
export function vapourPressure(tCelsius: number, relativeHumidity: number): number {
  return (relativeHumidity / 100) * saturationVapourPressure(tCelsius);
}

/**
 * Taupunkt, °C — analytische Umkehrung der Magnus-Formel.
 *
 * Die SMN-Stundendateien liefern den Taupunkt als `tde200h0` bereits mit.
 * Diese Funktion dient deshalb auch als Plausibilitätsprüfung gegen die
 * Messreihe; siehe data/ QA-Schritt.
 */
export function dewPoint(tCelsius: number, relativeHumidity: number): number {
  const e = vapourPressure(tCelsius, relativeHumidity);
  const ln = Math.log(e / 6.112);
  return (243.12 * ln) / (17.62 - ln);
}

/** Feuchtegehalt (Mischungsverhältnis), kg Wasser je kg trockene Luft. */
export function humidityRatio(vapourPressureHpa: number, pressureHpa: number): number {
  return (EPSILON * vapourPressureHpa) / (pressureHpa - vapourPressureHpa);
}

/**
 * Spezifische Enthalpie feuchter Luft, kJ je kg trockene Luft.
 *
 *   h = c_pa·T + x·(h_fg0 + c_pv·T)
 *
 * Bezugspunkt: trockene Luft und flüssiges Wasser bei 0 °C.
 */
export function specificEnthalpy(tCelsius: number, humidityRatioKgKg: number): number {
  return C_PA * tCelsius + humidityRatioKgKg * (H_FG0 + C_PV * tCelsius);
}

/** Absolute Feuchte, g Wasserdampf je m³ feuchte Luft. */
export function absoluteHumidity(tCelsius: number, vapourPressureHpa: number): number {
  // hPa → Pa, kg → g
  return ((vapourPressureHpa * 100) / (R_V * (tCelsius + 273.15))) * 1000;
}

/**
 * Feuchtkugeltemperatur, °C.
 *
 * Löst die Psychrometergleichung
 *
 *   e = e_s(T_w) − A · p · (T − T_w)
 *
 * numerisch nach T_w. Verwendet Bisektion statt Newton: die Feuchtkugel liegt
 * garantiert zwischen Taupunkt und Trockentemperatur, damit ist das Intervall
 * von vornherein eingeschlossen und das Verfahren kann nicht divergieren.
 * Bei 60 Halbierungsschritten ist die Genauigkeit weit unter jeder
 * physikalisch sinnvollen Auflösung; Geschwindigkeit ist hier nachrangig
 * gegenüber Nachvollziehbarkeit.
 */
export function wetBulbTemperature(
  tCelsius: number,
  relativeHumidity: number,
  pressureHpa: number = P_ATM_SEA_LEVEL,
): number {
  const e = vapourPressure(tCelsius, relativeHumidity);

  let lo = dewPoint(tCelsius, relativeHumidity);
  let hi = tCelsius;
  if (hi < lo) return tCelsius; // bei RH ≥ 100 % fallen alle drei zusammen

  // residual(T_w) ist monoton steigend in T_w
  const residual = (tw: number) => saturationVapourPressure(tw) - PSYCHROMETER_A * pressureHpa * (tCelsius - tw) - e;

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (residual(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Luftdruck aus Stationshöhe, hPa — barometrische Höhenformel mit
 * Standardatmosphäre. Nur als Rückfallebene: die SMN-Stationen liefern mit
 * `prestah0` den gemessenen Stationsdruck, der immer vorzuziehen ist.
 */
export function pressureFromAltitude(altitudeM: number): number {
  return P_ATM_SEA_LEVEL * Math.pow(1 - (0.0065 * altitudeM) / 288.15, 5.255);
}

/** Alle abgeleiteten Feuchtegrössen einer Stunde in einem Durchgang. */
export interface MoistAirState {
  vapourPressure: number;
  dewPoint: number;
  humidityRatio: number;
  enthalpy: number;
  absoluteHumidity: number;
  wetBulb: number;
}

export function moistAirState(
  tCelsius: number,
  relativeHumidity: number,
  pressureHpa: number = P_ATM_SEA_LEVEL,
): MoistAirState {
  const e = vapourPressure(tCelsius, relativeHumidity);
  const x = humidityRatio(e, pressureHpa);
  return {
    vapourPressure: e,
    dewPoint: dewPoint(tCelsius, relativeHumidity),
    humidityRatio: x,
    enthalpy: specificEnthalpy(tCelsius, x),
    absoluteHumidity: absoluteHumidity(tCelsius, e),
    wetBulb: wetBulbTemperature(tCelsius, relativeHumidity, pressureHpa),
  };
}
