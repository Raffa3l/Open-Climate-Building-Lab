/**
 * Sonnenstand, Strahlungszerlegung und Einstrahlung auf geneigte Flächen.
 *
 * Herleitung und Stützstellen: docs/methods/005-solar.md
 *
 * Winkelkonvention durchgehend:
 *   Höhe    0° = Horizont, 90° = Zenit
 *   Azimut  0° = Nord, 90° = Ost, 180° = Süd, 270° = West
 *
 * Die Azimutkonvention ist die meteorologische. Wer eine Fassade nach Süden
 * ausrichtet, schreibt 180 — nicht 0, wie es die bauphysikalische Literatur
 * teilweise handhabt.
 */

import type { MethodRef } from "./provenance.ts";

const DEG = Math.PI / 180;

/** Solarkonstante, W/m². */
export const SOLAR_CONSTANT = 1367;

/**
 * Physikalische Obergrenze der Direktnormalstrahlung, W/m².
 *
 * Die Zerlegung I_bn = I_b,horizontal / sin(h) entgleist bei flachem
 * Sonnenstand: Der Nenner geht gegen null, während ein — womöglich fehlerhaft
 * gemessener oder falsch zugeordneter — Zähler stehen bleibt. Ohne Grenze
 * entstehen so Einstrahlungen von mehreren tausend W/m² auf senkrechten
 * Flächen.
 *
 * Die Grenze ist die extraterrestrische Bestrahlungsstärke im Perihel: Mehr
 * als das kann am Erdboden unter keinen Umständen ankommen.
 */
export const MAX_BEAM_NORMAL = SOLAR_CONSTANT * 1.035;

export const METHOD_SOLAR_POSITION: MethodRef = {
  id: "solar.position",
  version: "1.0.0",
  doc: "docs/methods/005-solar.md#sonnenstand",
  sources: ["michalsky1988", "noaa-solar"],
};

export const METHOD_DIFFUSE_FRACTION: MethodRef = {
  id: "solar.diffuseFraction",
  version: "1.0.0",
  doc: "docs/methods/005-solar.md#zerlegung-in-direkt-und-diffus",
  sources: ["erbs1982"],
};

export const METHOD_TILTED_IRRADIANCE: MethodRef = {
  id: "solar.tiltedIrradiance",
  // 1.0.1: Direktnormalstrahlung auf MAX_BEAM_NORMAL begrenzt. Betrifft nur
  // Stunden mit flachem Sonnenstand, in denen das Ergebnis zuvor unphysikalisch
  // war — die Version steigt trotzdem, weil sich Werte ändern können.
  version: "1.0.1",
  doc: "docs/methods/005-solar.md#isotropes-himmelsmodell",
  sources: ["liu-jordan-1963"],
};

/**
 * Perez ist ein **eigenes Verfahren**, nicht eine neue Version des isotropen.
 * So bleiben Werte beider Modelle nebeneinander zuordenbar — wer eine ältere
 * Publikation nachrechnen will, wählt weiterhin das isotrope Modell und erhält
 * denselben Hash wie damals.
 */
export const METHOD_TILTED_IRRADIANCE_PEREZ: MethodRef = {
  id: "solar.tiltedIrradiancePerez",
  version: "1.0.0",
  doc: "docs/methods/005-solar.md#anisotropes-himmelsmodell-nach-perez",
  sources: ["perez1990", "kasten-young-1989"],
};

export interface SolarPosition {
  /** Höhe über dem Horizont, Grad. Negativ bedeutet: Sonne unter dem Horizont. */
  altitude: number;
  /** Azimut, Grad, von Nord über Ost. */
  azimuth: number;
  /** Deklination, Grad. */
  declination: number;
}

/**
 * Sonnenstand nach dem Verfahren von Michalsky (1988) in der NOAA-Fassung.
 * Genauigkeit rund 0.01° — für Gebäudesimulation um Grössenordnungen mehr als
 * nötig, aber der Aufwand ist derselbe wie bei einer gröberen Näherung.
 *
 * `utcMs` muss die **Mitte** des Messintervalls sein, nicht der Zeitstempel
 * der Rohdaten. Siehe docs/methods/000-time-conventions.md.
 */
export function solarPosition(utcMs: number, latitude: number, longitude: number): SolarPosition {
  // Tage seit J2000.0
  const n = utcMs / 86_400_000 + 2440587.5 - 2451545.0;

  const meanLongitude = mod360(280.460 + 0.9856474 * n);
  const meanAnomaly = mod360(357.528 + 0.9856003 * n) * DEG;

  // Ekliptikale Länge
  const lambda =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.020 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;

  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(lambda), Math.cos(lambda));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(lambda));

  // Mittlere Sternzeit Greenwich, Stunden
  const gmst = mod24(18.697374558 + 24.06570982441908 * n);
  const localSiderealTime = mod24(gmst + longitude / 15) * 15 * DEG;

  const hourAngle = localSiderealTime - rightAscension;
  const lat = latitude * DEG;

  const sinAltitude =
    Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.min(1, Math.max(-1, sinAltitude)));

  // Azimut von Nord über Ost
  const azimuth = Math.atan2(
    -Math.cos(declination) * Math.sin(hourAngle),
    Math.sin(declination) * Math.cos(lat) - Math.cos(declination) * Math.sin(lat) * Math.cos(hourAngle),
  );

  return {
    altitude: altitude / DEG,
    azimuth: mod360(azimuth / DEG),
    declination: declination / DEG,
  };
}

function mod360(x: number): number {
  return ((x % 360) + 360) % 360;
}

function mod24(x: number): number {
  return ((x % 24) + 24) % 24;
}

/** Extraterrestrische Bestrahlungsstärke auf die Normalfläche, W/m². */
export function extraterrestrialIrradiance(dayOfYear: number): number {
  return SOLAR_CONSTANT * (1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365));
}

/**
 * Diffusanteil der Globalstrahlung nach Erbs et al. (1982).
 *
 * Nötig, weil längst nicht jede SMN-Station die Diffusstrahlung misst — bei
 * Zürich/Fluntern fehlt `ods000h0` vollständig. Wo sie gemessen vorliegt, ist
 * der Messwert vorzuziehen; diese Korrelation ist die Rückfallebene.
 *
 * @param globalHorizontal Globalstrahlung auf die Horizontale, W/m²
 * @param solarAltitude Sonnenhöhe, Grad
 * @param dayOfYear Tag im Jahr, 1…366
 * @returns Diffusanteil 0…1
 */
export function diffuseFraction(
  globalHorizontal: number,
  solarAltitude: number,
  dayOfYear: number,
): number {
  if (solarAltitude <= 0 || globalHorizontal <= 0) return 1;

  const horizontalExtraterrestrial =
    extraterrestrialIrradiance(dayOfYear) * Math.sin(solarAltitude * DEG);
  if (horizontalExtraterrestrial <= 0) return 1;

  // Klarheitsindex
  const kt = Math.min(1, globalHorizontal / horizontalExtraterrestrial);

  if (kt <= 0.22) return 1.0 - 0.09 * kt;
  if (kt <= 0.8) {
    return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  }
  return 0.165;
}

/** Ausrichtung einer Fläche. */
export interface SurfaceOrientation {
  /** Neigung gegen die Horizontale, Grad. 0 = horizontal, 90 = senkrecht. */
  tilt: number;
  /** Azimut der Flächennormalen, Grad. 180 = Süd. Bei tilt = 0 ohne Wirkung. */
  azimuth: number;
}

/**
 * Kosinus des Einfallswinkels auf eine beliebig orientierte Fläche.
 * Negative Werte bedeuten: Sonne steht hinter der Fläche.
 */
export function cosIncidence(sun: SolarPosition, surface: SurfaceOrientation): number {
  const alt = sun.altitude * DEG;
  const tilt = surface.tilt * DEG;
  const deltaAzimuth = (sun.azimuth - surface.azimuth) * DEG;
  return Math.cos(alt) * Math.sin(tilt) * Math.cos(deltaAzimuth) + Math.sin(alt) * Math.cos(tilt);
}

export interface TiltedIrradiance {
  /** Gesamte Bestrahlungsstärke auf die geneigte Fläche, W/m². */
  total: number;
  beam: number;
  diffuse: number;
  groundReflected: number;
}

/**
 * Einstrahlung auf eine geneigte Fläche, isotropes Himmelsmodell
 * (Liu & Jordan 1963).
 *
 * Bewusst das einfachste defensible Modell. Es unterschätzt die Einstrahlung
 * auf sonnenzugewandte Fassaden bei klarem Himmel, weil es die Aufhellung um
 * die Sonne und am Horizont nicht abbildet. Perez wäre genauer und ist als
 * eigenes Verfahren nachrüstbar — dann mit eigener `MethodRef` und eigener
 * Version, damit publizierte Werte zuordenbar bleiben.
 *
 * @param groundAlbedo Bodenreflexionsgrad, Standard 0.2
 */
export function tiltedIrradiance(
  globalHorizontal: number,
  diffuseHorizontal: number,
  sun: SolarPosition,
  surface: SurfaceOrientation,
  groundAlbedo = 0.2,
): TiltedIrradiance {
  const tilt = surface.tilt * DEG;

  const beamHorizontal = Math.max(0, globalHorizontal - diffuseHorizontal);
  const sinAltitude = Math.sin(sun.altitude * DEG);

  let beam = 0;
  if (sun.altitude > 0 && sinAltitude > 0.01) {
    // Unter etwa 0.6° Sonnenhöhe wird R_b numerisch unbrauchbar gross.
    const cosTheta = cosIncidence(sun, surface);
    if (cosTheta > 0) {
      const beamNormal = Math.min(beamHorizontal / sinAltitude, MAX_BEAM_NORMAL);
      beam = beamNormal * cosTheta;
    }
  }

  const diffuse = diffuseHorizontal * ((1 + Math.cos(tilt)) / 2);
  const groundReflected = globalHorizontal * groundAlbedo * ((1 - Math.cos(tilt)) / 2);

  return { total: beam + diffuse + groundReflected, beam, diffuse, groundReflected };
}


// ---------------------------------------------------------------------------
// Anisotropes Himmelsmodell nach Perez (1990)
// ---------------------------------------------------------------------------

/**
 * Helligkeitskoeffizienten nach Perez et al. (1990), Tabelle 6.
 * Indiziert über die Himmelsklarheit ε; die Untergrenzen stehen in `epsilon`.
 */
const PEREZ_BINS: ReadonlyArray<{
  epsilon: number;
  f11: number; f12: number; f13: number;
  f21: number; f22: number; f23: number;
}> = [
  { epsilon: 1.000, f11: -0.008, f12: 0.588, f13: -0.062, f21: -0.060, f22: 0.072, f23: -0.022 },
  { epsilon: 1.065, f11: 0.130, f12: 0.683, f13: -0.151, f21: -0.019, f22: 0.066, f23: -0.029 },
  { epsilon: 1.230, f11: 0.330, f12: 0.487, f13: -0.221, f21: 0.055, f22: -0.064, f23: -0.026 },
  { epsilon: 1.500, f11: 0.568, f12: 0.187, f13: -0.295, f21: 0.109, f22: -0.152, f23: -0.014 },
  { epsilon: 1.950, f11: 0.873, f12: -0.392, f13: -0.362, f21: 0.226, f22: -0.462, f23: 0.001 },
  { epsilon: 2.800, f11: 1.132, f12: -1.237, f13: -0.412, f21: 0.288, f22: -0.823, f23: 0.056 },
  { epsilon: 4.500, f11: 1.060, f12: -1.600, f13: -0.359, f21: 0.264, f22: -1.127, f23: 0.131 },
  { epsilon: 6.200, f11: 0.678, f12: -0.327, f13: -0.250, f21: 0.156, f22: -1.377, f23: 0.251 },
];

/** Krümmungskonstante der Klarheitsdefinition, 1/rad³. Perez (1990). */
const PEREZ_KAPPA = 1.041;

/**
 * Relative optische Luftmasse nach Kasten & Young (1989).
 * Die einfache Näherung 1/cos Z entgleist bei tiefem Sonnenstand.
 */
export function airMass(solarAltitude: number): number {
  if (solarAltitude <= 0) return Infinity;
  const zenith = 90 - solarAltitude;
  return 1 / (Math.sin(solarAltitude * DEG) + 0.50572 * Math.pow(96.07995 - zenith, -1.6364));
}

/** Himmelsklarheit ε — 1 bei völlig bedecktem, über 6 bei sehr klarem Himmel. */
export function skyClearness(
  diffuseHorizontal: number,
  beamNormal: number,
  solarAltitude: number,
): number {
  if (diffuseHorizontal <= 0) return 1;
  const zenithRad = (90 - solarAltitude) * DEG;
  const cubed = PEREZ_KAPPA * zenithRad ** 3;
  return ((diffuseHorizontal + beamNormal) / diffuseHorizontal + cubed) / (1 + cubed);
}

/** Himmelshelligkeit Δ. */
export function skyBrightness(
  diffuseHorizontal: number,
  solarAltitude: number,
  dayOfYear: number,
): number {
  const m = airMass(solarAltitude);
  if (!Number.isFinite(m)) return 0;
  return (diffuseHorizontal * m) / extraterrestrialIrradiance(dayOfYear);
}

function perezCoefficients(epsilon: number) {
  let chosen = PEREZ_BINS[0];
  for (const bin of PEREZ_BINS) if (epsilon >= bin.epsilon) chosen = bin;
  return chosen;
}

/**
 * Einstrahlung auf eine geneigte Fläche, anisotropes Modell nach Perez (1990).
 *
 * Gegenüber dem isotropen Modell kommen zwei Terme hinzu:
 *
 * - **Zirkumsolare Aufhellung** F1 — der helle Bereich um die Sonne. Er ist
 *   der Grund, warum das isotrope Modell sonnenzugewandte Fassaden bei klarem
 *   Himmel unterschätzt.
 * - **Horizontaufhellung** F2 — der hellere Streifen am Horizont.
 *
 * $$I_{d,\beta} = I_d \left[(1-F_1)\frac{1+\cos\beta}{2} + F_1\frac{a}{b} + F_2\sin\beta\right]$$
 *
 * Bei bedecktem Himmel (ε → 1) gehen beide Terme gegen null und das Modell
 * geht in das isotrope über — im Test verankert.
 */
export function tiltedIrradiancePerez(
  globalHorizontal: number,
  diffuseHorizontal: number,
  sun: SolarPosition,
  surface: SurfaceOrientation,
  dayOfYear: number,
  groundAlbedo = 0.2,
): TiltedIrradiance {
  const tilt = surface.tilt * DEG;
  const sinAltitude = Math.sin(sun.altitude * DEG);

  const beamHorizontal = Math.max(0, globalHorizontal - diffuseHorizontal);
  const groundReflected = globalHorizontal * groundAlbedo * ((1 - Math.cos(tilt)) / 2);

  // Nachts und bei sehr flachem Sonnenstand bleibt nur der isotrope Diffusanteil.
  if (sun.altitude <= 0 || sinAltitude <= 0.01) {
    const diffuse = diffuseHorizontal * ((1 + Math.cos(tilt)) / 2);
    return { total: diffuse + groundReflected, beam: 0, diffuse, groundReflected };
  }

  const beamNormal = Math.min(beamHorizontal / sinAltitude, MAX_BEAM_NORMAL);
  const cosTheta = cosIncidence(sun, surface);
  const beam = cosTheta > 0 ? beamNormal * cosTheta : 0;

  const epsilon = skyClearness(diffuseHorizontal, beamNormal, sun.altitude);
  const delta = skyBrightness(diffuseHorizontal, sun.altitude, dayOfYear);
  const c = perezCoefficients(epsilon);
  const zenithRad = (90 - sun.altitude) * DEG;

  const f1 = Math.max(0, c.f11 + c.f12 * delta + c.f13 * zenithRad);
  const f2 = c.f21 + c.f22 * delta + c.f23 * zenithRad;

  // a und b begrenzen den zirkumsolaren Term bei streifendem Einfall.
  const a = Math.max(0, cosTheta);
  const b = Math.max(Math.cos(85 * DEG), sinAltitude);

  const diffuse =
    diffuseHorizontal *
    ((1 - f1) * ((1 + Math.cos(tilt)) / 2) + (f1 * a) / b + f2 * Math.sin(tilt));

  return {
    total: beam + Math.max(0, diffuse) + groundReflected,
    beam,
    diffuse: Math.max(0, diffuse),
    groundReflected,
  };
}

/** Welches Himmelsmodell die Einstrahlung liefert. */
export type SkyModel = "isotrop" | "perez";

/** Einheitlicher Einstieg über beide Modelle. */
export function irradianceOnSurface(
  model: SkyModel,
  globalHorizontal: number,
  diffuseHorizontal: number,
  sun: SolarPosition,
  surface: SurfaceOrientation,
  dayOfYear: number,
  groundAlbedo = 0.2,
): TiltedIrradiance {
  return model === "perez"
    ? tiltedIrradiancePerez(globalHorizontal, diffuseHorizontal, sun, surface, dayOfYear, groundAlbedo)
    : tiltedIrradiance(globalHorizontal, diffuseHorizontal, sun, surface, groundAlbedo);
}
