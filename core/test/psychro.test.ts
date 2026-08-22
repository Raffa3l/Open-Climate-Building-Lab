import { test } from "node:test";
import assert from "node:assert/strict";
import {
  P_ATM_SEA_LEVEL,
  absoluteHumidity,
  dewPoint,
  humidityRatio,
  moistAirState,
  saturationVapourPressure,
  specificEnthalpy,
  vapourPressure,
  wetBulbTemperature,
} from "../src/psychro.ts";

const near = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≉ ${b} (Toleranz ${tol})`);

test("Sättigungsdampfdruck trifft die Stützstellen der Magnus-Formel", () => {
  near(saturationVapourPressure(0), 6.112, 1e-6, "e_s(0 °C)");
  near(saturationVapourPressure(20), 23.39, 0.1, "e_s(20 °C)");
  near(saturationVapourPressure(30), 42.46, 0.2, "e_s(30 °C)");
  // Monotonie über den gesamten Gültigkeitsbereich
  for (let t = -40; t < 60; t++) {
    assert.ok(saturationVapourPressure(t + 1) > saturationVapourPressure(t));
  }
});

test("Taupunkt ist die exakte Umkehrung des Dampfdrucks", () => {
  near(dewPoint(20, 100), 20, 1e-9, "gesättigt: Td = T");
  near(dewPoint(20, 50), 9.27, 0.05, "20 °C / 50 %");

  // Rundlauf über einen weiten Bereich
  for (const t of [-10, 0, 12, 25, 35]) {
    for (const rh of [20, 45, 70, 95]) {
      const td = dewPoint(t, rh);
      near(saturationVapourPressure(td), vapourPressure(t, rh), 1e-9, `Rundlauf ${t}/${rh}`);
    }
  }
});

test("Feuchtkugeltemperatur liegt zwischen Taupunkt und Trockentemperatur", () => {
  for (const t of [-5, 5, 15, 22, 30, 38]) {
    for (const rh of [10, 35, 60, 85, 100]) {
      const tw = wetBulbTemperature(t, rh, P_ATM_SEA_LEVEL);
      const td = dewPoint(t, rh);
      assert.ok(tw <= t + 1e-6, `Tw ${tw} > T ${t} bei ${rh} %`);
      assert.ok(tw >= td - 1e-6, `Tw ${tw} < Td ${td} bei ${t} °C / ${rh} %`);
    }
  }
});

test("Feuchtkugel trifft bekannte Punkte des h,x-Diagramms", () => {
  near(wetBulbTemperature(20, 50), 13.7, 0.2, "20 °C / 50 %");
  near(wetBulbTemperature(30, 40), 20.0, 0.3, "30 °C / 40 %");
  near(wetBulbTemperature(25, 100), 25.0, 0.05, "gesättigt: Tw = T");
});

test("Enthalpie feuchter Luft: 20 °C / 50 % ≈ 38.5 kJ/kg", () => {
  const e = vapourPressure(20, 50);
  const x = humidityRatio(e, P_ATM_SEA_LEVEL);
  near(x, 0.00724, 1e-4, "Feuchtegehalt");
  near(specificEnthalpy(20, x), 38.5, 0.2, "Enthalpie");
});

test("Enthalpie trockener Luft bei 0 °C ist der Nullpunkt", () => {
  near(specificEnthalpy(0, 0), 0, 1e-12);
});

test("absolute Feuchte bei 20 °C / 50 % ≈ 8.7 g/m³", () => {
  near(absoluteHumidity(20, vapourPressure(20, 50)), 8.65, 0.1);
});

test("moistAirState ist konsistent mit den Einzelfunktionen", () => {
  const s = moistAirState(26, 65, 950);
  near(s.vapourPressure, vapourPressure(26, 65), 1e-12);
  near(s.dewPoint, dewPoint(26, 65), 1e-12);
  near(s.humidityRatio, humidityRatio(s.vapourPressure, 950), 1e-12);
  near(s.enthalpy, specificEnthalpy(26, s.humidityRatio), 1e-12);
  // Tieferer Luftdruck erhöht den Feuchtegehalt bei gleicher relativer Feuchte
  assert.ok(moistAirState(26, 65, 950).humidityRatio > moistAirState(26, 65, 1013.25).humidityRatio);
});
