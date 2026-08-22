import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cosIncidence,
  diffuseFraction,
  extraterrestrialIrradiance,
  solarPosition,
  tiltedIrradiance,
} from "../src/solar.ts";

// Zürich / Fluntern, Stationskoordinaten aus ogd-smn_meta_stations.csv
const ZH_LAT = 47.381003;
const ZH_LON = 8.567194;

const near = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a.toFixed(4)} ≉ ${b} (Toleranz ${tol})`);

/** Höchster Sonnenstand des Tages, im Minutenraster gesucht. */
function culmination(year: number, month: number, day: number) {
  let best = { altitude: -90, azimuth: 0, declination: 0 };
  let bestMs = 0;
  for (let minute = 0; minute < 24 * 60; minute++) {
    const ms = Date.UTC(year, month - 1, day) + minute * 60_000;
    const p = solarPosition(ms, ZH_LAT, ZH_LON);
    if (p.altitude > best.altitude) {
      best = p;
      bestMs = ms;
    }
  }
  return { ...best, utcMs: bestMs };
}

test("Sonnenhöhe zur Kulmination an den Wendepunkten", () => {
  // Mittagshöhe = 90° − Breite + Deklination
  near(culmination(2023, 6, 21).altitude, 90 - ZH_LAT + 23.44, 0.15, "Sommersonnenwende");
  near(culmination(2023, 12, 21).altitude, 90 - ZH_LAT - 23.44, 0.15, "Wintersonnenwende");
  near(culmination(2023, 3, 20).altitude, 90 - ZH_LAT, 0.4, "Frühlingsäquinoktium");
});

test("Deklination an den Wendepunkten erreicht die Schiefe der Ekliptik", () => {
  near(culmination(2023, 6, 21).declination, 23.44, 0.05, "Sommer");
  near(culmination(2023, 12, 21).declination, -23.44, 0.05, "Winter");
  near(culmination(2023, 3, 20).declination, 0, 0.4, "Äquinoktium");
});

test("zur Kulmination steht die Sonne im Süden", () => {
  for (const [m, d] of [[3, 20], [6, 21], [9, 23], [12, 21]] as [number, number][]) {
    near(culmination(2023, m, d).azimuth, 180, 0.5, `${m}-${d}`);
  }
});

test("Kulmination liegt beim wahren Ortsmittag", () => {
  // Zürich liegt 8.567° östlich → wahrer Mittag rund 34 Minuten vor 12:00 UTC,
  // verschoben um die Zeitgleichung (Ende Juni etwa −2 min).
  const { utcMs } = culmination(2023, 6, 21);
  const minutesUtc = (utcMs % 86_400_000) / 60_000;
  near(minutesUtc, 12 * 60 - (ZH_LON / 15) * 60, 6, "wahrer Mittag");
});

test("mitten in der Nacht steht die Sonne unter dem Horizont", () => {
  const p = solarPosition(Date.UTC(2023, 5, 21, 0, 0), ZH_LAT, ZH_LON);
  assert.ok(p.altitude < 0, `Sonnenhöhe ${p.altitude.toFixed(2)}° sollte negativ sein`);
});

test("Sommertag ist deutlich länger als Wintertag", () => {
  const daylight = (year: number, month: number, day: number) => {
    let minutes = 0;
    for (let m = 0; m < 24 * 60; m++) {
      if (solarPosition(Date.UTC(year, month - 1, day) + m * 60_000, ZH_LAT, ZH_LON).altitude > 0) minutes++;
    }
    return minutes / 60;
  };
  near(daylight(2023, 6, 21), 15.9, 0.3, "Sommersonnenwende Zürich");
  near(daylight(2023, 12, 21), 8.5, 0.3, "Wintersonnenwende Zürich");
});

test("Extraterrestrische Strahlung schwankt um die Solarkonstante", () => {
  near(extraterrestrialIrradiance(3), 1367 * 1.033, 1, "Perihel Anfang Januar");
  near(extraterrestrialIrradiance(185), 1367 * 0.967, 3, "Aphel Anfang Juli");
});

test("Diffusanteil nach Erbs an den Bereichsgrenzen", () => {
  const doy = 172;
  const alt = 60;
  const i0h = extraterrestrialIrradiance(doy) * Math.sin((alt * Math.PI) / 180);

  // kt sehr klein → praktisch alles diffus
  assert.ok(diffuseFraction(0.1 * i0h, alt, doy) > 0.95);
  // kt sehr gross → Erbs deckelt bei 0.165
  near(diffuseFraction(0.95 * i0h, alt, doy), 0.165, 1e-9);
  // Nacht und Nullstrahlung
  assert.equal(diffuseFraction(0, alt, doy), 1);
  assert.equal(diffuseFraction(500, -5, doy), 1);
});

test("Diffusanteil fällt monoton mit zunehmender Klarheit", () => {
  const doy = 172;
  const alt = 60;
  const i0h = extraterrestrialIrradiance(doy) * Math.sin((alt * Math.PI) / 180);
  let previous = 1.1;
  for (let kt = 0.05; kt <= 0.79; kt += 0.05) {
    const kd = diffuseFraction(kt * i0h, alt, doy);
    assert.ok(kd < previous, `bei kt=${kt.toFixed(2)} stieg der Diffusanteil auf ${kd.toFixed(3)}`);
    previous = kd;
  }
});

test("horizontale Fläche erhält exakt die Globalstrahlung", () => {
  const sun = solarPosition(Date.UTC(2023, 5, 21, 11, 30), ZH_LAT, ZH_LON);
  const r = tiltedIrradiance(800, 200, sun, { tilt: 0, azimuth: 180 });
  near(r.total, 800, 1e-9, "Summe der Komponenten");
  near(r.groundReflected, 0, 1e-12, "horizontal sieht keinen Boden");
});

test("Einfallswinkel: senkrechte Südfassade im Winter besser als im Sommer", () => {
  const south = { tilt: 90, azimuth: 180 };
  const summer = solarPosition(culmination(2023, 6, 21).utcMs, ZH_LAT, ZH_LON);
  const winter = solarPosition(culmination(2023, 12, 21).utcMs, ZH_LAT, ZH_LON);
  assert.ok(
    cosIncidence(winter, south) > cosIncidence(summer, south),
    "die tiefe Wintersonne trifft die Fassade steiler",
  );
});

test("Sonne hinter der Fläche liefert keinen Direktanteil", () => {
  const north = { tilt: 90, azimuth: 0 };
  const sun = solarPosition(culmination(2023, 5, 21).utcMs, ZH_LAT, ZH_LON);
  assert.ok(cosIncidence(sun, north) < 0, "Mittagssonne steht hinter der Nordfassade");
  const r = tiltedIrradiance(800, 200, sun, north);
  assert.equal(r.beam, 0);
  assert.ok(r.diffuse > 0, "diffus bekommt sie trotzdem");
});

test("Südfassade sammelt im Winter mehr als die Horizontale", () => {
  const utcMs = culmination(2023, 12, 21).utcMs;
  const sun = solarPosition(utcMs, ZH_LAT, ZH_LON);
  const global = 300;
  const dhi = global * diffuseFraction(global, sun.altitude, 355);
  const south = tiltedIrradiance(global, dhi, sun, { tilt: 90, azimuth: 180 }).total;
  const flat = tiltedIrradiance(global, dhi, sun, { tilt: 0, azimuth: 180 }).total;
  assert.ok(south > flat, `Südfassade ${south.toFixed(0)} vs. horizontal ${flat.toFixed(0)} W/m²`);
});

test("bei sehr flachem Sonnenstand entgleist der Direktanteil nicht", () => {
  const sun = { altitude: 0.3, azimuth: 90, declination: 0 };
  const r = tiltedIrradiance(50, 45, sun, { tilt: 90, azimuth: 90 });
  assert.ok(Number.isFinite(r.total) && r.total < 500, `total ${r.total}`);
});
