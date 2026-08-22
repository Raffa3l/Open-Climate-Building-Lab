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
  version: "1.0.0",
  doc: "docs/methods/005-solar.md#einstrahlung-auf-geneigte-flächen",
  sources: ["liu-jordan-1963"],
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
    if (cosTheta > 0) beam = beamHorizontal * (cosTheta / sinAltitude);
  }

  const diffuse = diffuseHorizontal * ((1 + Math.cos(tilt)) / 2);
  const groundReflected = globalHorizontal * groundAlbedo * ((1 - Math.cos(tilt)) / 2);

  return { total: beam + diffuse + groundReflected, beam, diffuse, groundReflected };
}
