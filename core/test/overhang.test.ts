import { test } from "node:test";
import assert from "node:assert/strict";
import { irradianceOnSurface, solarPosition, type SolarPosition } from "../src/solar.ts";
import { hourlyAxis } from "../src/series.ts";
import { simulate5R1C } from "../src/building.ts";
import type { DatasetRef } from "../src/provenance.ts";
import {
  assertOverhangApplies,
  irradianceUnderOverhang,
  overhangShadedFraction,
  overhangSkyViewRatio,
  type Overhang,
} from "../src/overhang.ts";
import { DEFAULT_ROOM_SETTINGS, referenceRoom } from "../src/reference-case.ts";

const SOUTH = { tilt: 90, azimuth: 180 };
const DEG = Math.PI / 180;
const sunAt = (altitude: number, azimuth: number): SolarPosition => ({ altitude, azimuth, declination: 0 });

test("ohne Auskragung wirkt das Vordach nicht", () => {
  const none: Overhang = { depthRatio: 0, gapRatio: 0.2 };
  assert.equal(overhangSkyViewRatio(none), 1);
  const sun = sunAt(40, 200);
  assert.equal(overhangShadedFraction(sun, SOUTH, none), 0);
  const on = irradianceOnSurface("perez", 700, 200, sun, SOUTH, 180);
  const under = irradianceUnderOverhang(on, sun, SOUTH, none);
  assert.ok(Math.abs(under.total - on.total) < 1e-9, `${under.total} gegen ${on.total}`);
});

/**
 * Unabhängige Konstruktion: Sonnenvektor und Fassade in Ost-Nord-Hoch, der
 * Strahl von jedem Punkt der Fensterhöhe zur Sonne, Schnitt mit der
 * Vordachplatte. Kein Profilwinkel; nur Vektoren.
 */
function rayTracedFraction(sun: SolarPosition, wallAzimuth: number, o: Overhang, samples = 4000): number {
  const s = [
    Math.cos(sun.altitude * DEG) * Math.sin(sun.azimuth * DEG),
    Math.cos(sun.altitude * DEG) * Math.cos(sun.azimuth * DEG),
    Math.sin(sun.altitude * DEG),
  ];
  const normal = [Math.sin(wallAzimuth * DEG), Math.cos(wallAzimuth * DEG), 0];
  const along = [Math.cos(wallAzimuth * DEG), -Math.sin(wallAzimuth * DEG), 0];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (dot(s, normal) <= 0 || s[2] <= 0) return 0;

  const slab = 1 + o.gapRatio;
  let shaded = 0;
  for (let k = 0; k < samples; k++) {
    const z = (k + 0.5) / samples;
    const lambda = (slab - z) / s[2];
    const hit = [lambda * s[0], lambda * s[1], z + lambda * s[2]];
    const out = dot(hit, normal);
    if (out >= 0 && out <= o.depthRatio && Math.abs(dot(hit, along)) <= 1e4) shaded++;
  }
  return shaded / samples;
}

test("Profilwinkel stimmt mit der Strahlverfolgung überein", () => {
  const overhangs: Overhang[] = [
    { depthRatio: 0.5, gapRatio: 0 },
    { depthRatio: 1, gapRatio: 0.2 },
    { depthRatio: 0.3, gapRatio: 0.1 },
    { depthRatio: 1.8, gapRatio: 0.18 },
  ];
  let compared = 0;
  for (const o of overhangs) {
    for (let altitude = 5; altitude <= 85; altitude += 10) {
      for (let relative = -80; relative <= 80; relative += 20) {
        const sun = sunAt(altitude, 180 + relative);
        const formula = overhangShadedFraction(sun, SOUTH, o);
        const traced = rayTracedFraction(sun, 180, o);
        assert.ok(Math.abs(formula - traced) <= 1 / 4000 + 1e-12,
          `Höhe ${altitude}°, Azimut ${relative}°, p ${o.depthRatio}: ${formula} gegen ${traced}`);
        compared++;
      }
    }
  }
  assert.equal(compared, 4 * 9 * 9);
  // Sonne hinter der Fassade: nichts zu beschatten.
  assert.equal(overhangShadedFraction(sunAt(30, 0), SOUTH, overhangs[1]), 0);
});

test("Sichtfaktor zum Himmel nach der Fadenmethode gegen numerische Integration", () => {
  // Ein Punkt in der Tiefe d unter dem Vordach sieht den Himmel bis zur Höhe
  // β = atan(d / p) über dem Horizont; im Schnitt ergibt das den Sichtfaktor
  // sin(β) / 2. Über die Fensterhöhe gemittelt und auf 1/2 bezogen.
  for (const o of [{ depthRatio: 1, gapRatio: 0 }, { depthRatio: 0.4, gapRatio: 0.25 }, { depthRatio: 2, gapRatio: 0.1 }]) {
    const n = 100_000;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const depth = 1 + o.gapRatio - (k + 0.5) / n;
      sum += Math.sin(Math.atan2(depth, o.depthRatio));
    }
    const integrated = sum / n;
    assert.ok(Math.abs(overhangSkyViewRatio(o) - integrated) < 1e-6,
      `p ${o.depthRatio}, g ${o.gapRatio}: ${overhangSkyViewRatio(o)} gegen ${integrated}`);
  }
  // Ein beliebig tiefes Vordach nimmt den ganzen Himmel.
  assert.ok(overhangSkyViewRatio({ depthRatio: 1e6, gapRatio: 0 }) < 1e-5);
});

/** Sonnenhöchststand eines Tages, auf die Minute gesucht. */
function noonAltitude(year: number, month: number, day: number, lat: number, lon: number): SolarPosition {
  let best = solarPosition(Date.UTC(year, month - 1, day, 9), lat, lon);
  for (let minute = 9 * 60; minute <= 14 * 60; minute++) {
    const p = solarPosition(Date.UTC(year, month - 1, day, 0, minute), lat, lon);
    if (p.altitude > best.altitude) best = p;
  }
  return best;
}

test("NREL-Geometrie: kein Schatten am Mittag vom 17. November bis 25. Januar", () => {
  // NREL, Solar Radiation Data Manual for Buildings (1995): Das Vordach ist so
  // bemessen, dass es ein Südfenster mittags nicht beschattet, solange die
  // Sonnenhöhe unter 71° minus Breite bleibt, also vom 17. November bis
  // 25. Januar. Die Unterkante des Vordachs steht dann gerade im Profil der
  // Sonne: G / P = tan(71° − φ).
  const lat = 47.38;
  const lon = 8.57;
  const o: Overhang = { depthRatio: 1, gapRatio: Math.tan((71 - lat) * DEG) };

  for (const [month, day] of [[11, 19], [12, 21], [1, 23]]) {
    const sun = noonAltitude(month === 1 ? 2025 : 2024, month, day, lat, lon);
    assert.equal(overhangShadedFraction(sun, SOUTH, o), 0, `${day}.${month}.: ${sun.altitude.toFixed(2)}°`);
  }
  for (const [month, day] of [[11, 10], [2, 1]]) {
    const sun = noonAltitude(month === 2 ? 2025 : 2024, month, day, lat, lon);
    assert.ok(overhangShadedFraction(sun, SOUTH, o) > 0, `${day}.${month}.: ${sun.altitude.toFixed(2)}°`);
  }
  // An den Grenztagen steht die Sonne mittags auf dieser Höhe.
  for (const [year, month, day] of [[2024, 11, 17], [2025, 1, 25]]) {
    const sun = noonAltitude(year, month, day, lat, lon);
    assert.ok(Math.abs(sun.altitude - (71 - lat)) < 0.3, `${day}.${month}.: ${sun.altitude.toFixed(2)}°`);
  }
});

test("Vordach nur über senkrechten Fenstern und mit gültiger Geometrie", () => {
  assert.throws(() => assertOverhangApplies({ depthRatio: 1, gapRatio: 0 }, { tilt: 45, azimuth: 180 }), /senkrechten/);
  assert.throws(() => assertOverhangApplies({ depthRatio: -1, gapRatio: 0 }, SOUTH), /Geometrie/);
  assert.throws(() => assertOverhangApplies({ depthRatio: NaN, gapRatio: 0 }, SOUTH), /Geometrie/);
});

test("Referenzraum: ohne Vordach bleibt das Fenster und damit der Hash wie bisher", () => {
  const plain = referenceRoom(DEFAULT_ROOM_SETTINGS);
  assert.equal(plain.windows[0].overhang, undefined);
  assert.ok(!JSON.stringify(plain.windows).includes("overhang"));

  // 40 % von 9.8 m² als Band über 3.5 m: 1.12 m hoch, darüber 0.2 m Sturz.
  const withRoof = referenceRoom({ ...DEFAULT_ROOM_SETTINGS, overhang: 1 });
  assert.deepEqual(withRoof.windows[0].overhang, { depthRatio: 0.892857, gapRatio: 0.178571 });
});

test("ein Vordach senkt die solaren Einträge im Sommer", () => {
  const hours = 24 * 30;
  const axis = hourlyAxis(Date.UTC(2021, 5, 1), hours);
  const outdoor = Float64Array.from({ length: hours }, (_, i) => 20 + 6 * Math.sin(((i % 24) - 9) / 24 * 2 * Math.PI));
  const global = Float64Array.from({ length: hours }, (_, i) => Math.max(0, 800 * Math.sin(((i % 24) - 4) / 16 * Math.PI)));
  const source: DatasetRef = {
    collection: "test", station: "TST", year: 2021, variables: ["tre200h0", "gre000h0"],
    sha256: "0".repeat(64), license: "CC-BY-4.0", attribution: "Testdaten",
  };
  const run = (overhang: number) => simulate5R1C(
    referenceRoom({ ...DEFAULT_ROOM_SETTINGS, shading: 1, overhang }),
    { outdoorTemperature: outdoor, globalHorizontal: global, axis, latitude: 47.38, longitude: 8.57 },
    [source],
  );
  const gains = (overhang: number) => run(overhang).value.solarGains.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const none = gains(0);
  const half = gains(0.5);
  const deep = gains(1.5);
  assert.ok(none > half && half > deep, `ohne ${none.toFixed(0)}, 0.5 m ${half.toFixed(0)}, 1.5 m ${deep.toFixed(0)}`);
  assert.notEqual(run(0).params.windows, run(1.5).params.windows);
});
