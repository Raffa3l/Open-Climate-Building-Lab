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

test("die Direktnormalstrahlung ist nach oben begrenzt", () => {
  // Physikalisch unmögliche Eingabe: 900 W/m² Global bei 1° Sonnenhöhe.
  // Ohne Begrenzung ergäbe I_bn = 650/0.017 ≈ 37 kW/m².
  const sun = { altitude: 1.0, azimuth: 180, declination: 0 };
  for (const model of ["isotrop", "perez"] as const) {
    const r = irradianceOnSurface(model, 900, 250, sun, { tilt: 90, azimuth: 180 }, 172);
    assert.ok(r.beam <= MAX_BEAM_NORMAL, `${model}: Direktanteil ${r.beam.toFixed(0)} W/m²`);
  }
});

// ---------------------------------------------------------------------------
// Anisotropes Himmelsmodell nach Perez
// ---------------------------------------------------------------------------

import type { SolarPosition } from "../src/solar.ts";
import {
  MAX_BEAM_NORMAL,
  airMass,
  irradianceOnSurface,
  skyBrightness,
  skyClearness,
  tiltedIrradiancePerez,
} from "../src/solar.ts";

const SOUTH = { tilt: 90, azimuth: 180 };
const HORIZONTAL = { tilt: 0, azimuth: 180 };

/** Sommermittag in Zürich — hoher Sonnenstand. */
const summerNoon = () => solarPosition(culmination(2023, 6, 21).utcMs, ZH_LAT, ZH_LON);
/** Wintermittag — tiefer Sonnenstand, für Fassaden der interessante Fall. */
const winterNoon = () => solarPosition(culmination(2023, 12, 21).utcMs, ZH_LAT, ZH_LON);

test("Luftmasse nach Kasten-Young", () => {
  near(airMass(90), 1.0, 0.01, "Zenit");
  near(airMass(30), 1.99, 0.02, "30° Höhe");
  near(airMass(10), 5.6, 0.1, "10° Höhe");
  assert.equal(airMass(0), Infinity, "am Horizont undefiniert");
  // Die einfache Näherung 1/sin würde bei 10° auf 5.76 kommen und bei 1°
  // vollends entgleisen — Kasten-Young bleibt endlich.
  assert.ok(Number.isFinite(airMass(1)) && airMass(1) < 30);
});

test("Himmelsklarheit trennt bedeckt von klar", () => {
  // Vollständig bedeckt: kein Direktanteil → ε = 1
  near(skyClearness(200, 0, 45), 1.0, 1e-9, "bedeckt");
  // Klarer Himmel: viel Direktstrahlung, wenig Diffus
  assert.ok(skyClearness(80, 850, 45) > 6, "sehr klar");
  assert.ok(skyClearness(150, 400, 45) > 1.5, "wechselhaft");
  assert.equal(skyClearness(0, 500, 45), 1, "ohne Diffusanteil undefiniert, auf 1 gesetzt");
});

test("Himmelshelligkeit steigt mit dem Diffusanteil", () => {
  const doy = 172;
  assert.ok(skyBrightness(300, 45, doy) > skyBrightness(100, 45, doy));
  assert.equal(skyBrightness(200, -5, doy), 0, "nachts null");
});

test("horizontale Fläche erhält auch bei Perez exakt die Globalstrahlung", () => {
  // Die Eingaben müssen physikalisch möglich sein: bei 19° Sonnenhöhe liegt
  // die extraterrestrische Horizontalstrahlung bei rund 460 W/m², mehr kann
  // am Boden nicht ankommen.
  const cases: Array<[SolarPosition, number, number, number]> = [
    [summerNoon(), 900, 200, 172],
    [winterNoon(), 350, 120, 355],
  ];
  for (const [sun, global, diffuse, doy] of cases) {
    const r = tiltedIrradiancePerez(global, diffuse, sun, HORIZONTAL, doy);
    near(r.total, global, 1e-9, `Sonnenhöhe ${sun.altitude.toFixed(1)}°`);
    near(r.groundReflected, 0, 1e-12);
  }
});

test("bei bedecktem Himmel geht Perez in das isotrope Modell über", () => {
  // ε = 1 heisst kein Direktanteil; dann sind F1 und F2 klein und die
  // beiden Modelle müssen praktisch dasselbe liefern.
  const sun = summerNoon();
  const overcastGlobal = 180;
  const overcastDiffuse = 180;

  const perez = tiltedIrradiancePerez(overcastGlobal, overcastDiffuse, sun, SOUTH, 172).total;
  const isotropic = tiltedIrradiance(overcastGlobal, overcastDiffuse, sun, SOUTH).total;
  assert.ok(
    Math.abs(perez - isotropic) / isotropic < 0.12,
    `bedeckt: Perez ${perez.toFixed(1)} vs. isotrop ${isotropic.toFixed(1)} W/m²`,
  );
});

test("bei klarem Himmel liefert Perez auf der Südfassade mehr als isotrop", () => {
  // Das ist der Kern: die zirkumsolare Aufhellung fehlt dem isotropen Modell.
  for (const [sun, label] of [[winterNoon(), "Winter"], [summerNoon(), "Sommer"]] as const) {
    // Bei tiefem Sonnenstand ist auch die Globalstrahlung entsprechend klein.
    const global = sun.altitude > 40 ? 900 : 320;
    const diffuse = global * diffuseFraction(global, sun.altitude, 172);
    const perez = tiltedIrradiancePerez(global, diffuse, sun, SOUTH, 172).total;
    const isotropic = tiltedIrradiance(global, diffuse, sun, SOUTH).total;
    assert.ok(perez > isotropic, `${label}: Perez ${perez.toFixed(0)} ≤ isotrop ${isotropic.toFixed(0)} W/m²`);
  }
});

test("Perez bleibt physikalisch beschränkt", () => {
  // Der Diffusanteil darf nie negativ werden, und die Summe muss unter der
  // Solarkonstanten bleiben.
  for (let hour = 0; hour < 24; hour++) {
    for (const doy of [15, 105, 172, 288]) {
      const sun = solarPosition(Date.UTC(2023, 0, 1) + (doy * 24 + hour) * 3_600_000, ZH_LAT, ZH_LON);
      for (const azimuth of [0, 90, 180, 270]) {
        const r = tiltedIrradiancePerez(900, 250, sun, { tilt: 90, azimuth }, doy);
        assert.ok(r.diffuse >= 0, `negativer Diffusanteil bei ${doy}/${hour}/${azimuth}`);
        assert.ok(
          Number.isFinite(r.total) && r.total <= MAX_BEAM_NORMAL + 400,
          `total ${r.total} bei Tag ${doy}, Stunde ${hour}, Azimut ${azimuth}`,
        );
      }
    }
  }
});

test("Nordfassade bekommt bei Perez keinen Direktanteil, aber Diffusstrahlung", () => {
  const sun = summerNoon();
  const r = tiltedIrradiancePerez(900, 200, sun, { tilt: 90, azimuth: 0 }, 172);
  assert.equal(r.beam, 0);
  assert.ok(r.diffuse > 0);
});

test("irradianceOnSurface wählt das benannte Modell", () => {
  const sun = winterNoon();
  const iso = irradianceOnSurface("isotrop", 420, 150, sun, SOUTH, 355);
  const per = irradianceOnSurface("perez", 420, 150, sun, SOUTH, 355);
  near(iso.total, tiltedIrradiance(420, 150, sun, SOUTH).total, 1e-12);
  near(per.total, tiltedIrradiancePerez(420, 150, sun, SOUTH, 355).total, 1e-12);
  assert.notEqual(iso.total, per.total);
});
