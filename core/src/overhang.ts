/**
 * Verschattung eines senkrechten Fensters von aussen: ein Vordach oder Balkon
 * darüber, eine Verbauung gegenüber.
 *
 * Beides gilt als lang gegenüber der Fensterbreite, wie eine durchgehende
 * Balkonplatte oder eine Häuserzeile. Dann reicht ein Schnitt senkrecht zur
 * Fassade, und der Schatten hängt nur am Profilwinkel. Seitlich vorbeischeinende
 * Sonne bildet das nicht ab; es überschätzt die Wirkung kurzer Hindernisse.
 *
 * Welche Anteile der Einstrahlung ein Vordach mindert, folgt dem NREL «Solar
 * Radiation Data Manual for Buildings»: Direktstrahlung und zirkumsolare
 * Aufhellung werfen denselben Schatten, der übrige Himmel verliert Sichtfaktor,
 * Horizontaufhellung und Bodenreflexion bleiben unberührt. Eine Verbauung
 * verdeckt zusätzlich den Horizontstreifen.
 *
 * Siehe docs/methods/011-vordach.md.
 */

import type { MethodRef } from "./provenance.ts";
import type { SolarPosition, SurfaceOrientation, TiltedIrradiance } from "./solar.ts";

export const METHOD_OVERHANG: MethodRef = {
  id: "shading.overhang",
  version: "1.0.0",
  doc: "docs/methods/011-vordach.md#rechnung",
  sources: ["duffie-beckman-2013", "hottel-sarofim-1967", "nrel-bluebook-1995"],
};

export const METHOD_OBSTRUCTION: MethodRef = {
  id: "shading.obstruction",
  version: "1.0.0",
  doc: "docs/methods/011-vordach.md#verbauung",
  sources: ["hottel-sarofim-1967", "oke-1981"],
};

/** Geometrie bezogen auf die Fensterhöhe H, damit nur Verhältnisse eingehen. */
export interface Overhang {
  /** Auskragung P des Vordachs vor der Fassade, geteilt durch H. */
  depthRatio: number;
  /** Abstand G zwischen Fensteroberkante und Vordach, geteilt durch H. */
  gapRatio: number;
  /**
   * Reflexionsgrad der Unterseite. Fehlt er, reflektiert sie nicht, und
   * Ergebnis wie Hash bleiben, was sie ohne diesen Term waren.
   */
  albedo?: number;
}

/**
 * Eine lange Verbauung gegenüber, etwa eine Häuserzeile oder ein Hang. Der
 * Winkel gilt über die ganze Fensterhöhe: Das Gegenüber ist weit weg im
 * Vergleich zur Fensterhöhe.
 */
export interface Obstruction {
  /** Höhe der Oberkante über dem Horizont, von der Fenstermitte aus, Grad. */
  angle: number;
  /** Reflexionsgrad der Fassade gegenüber. Fehlt er, reflektiert sie nicht. */
  albedo?: number;
}

/** Was die Umgebung zurückwirft, braucht die Einstrahlung ringsum. */
export interface ReflectionInput {
  /** Globalstrahlung horizontal, W/m² — sie beleuchtet den Boden. */
  globalHorizontal: number;
  groundAlbedo: number;
  /** Bestrahlung der Fassade gegenüber, W/m², als senkrechte Fläche zum Fenster hin. */
  opposite: number;
}

export interface ExternalShading {
  overhang?: Overhang;
  obstruction?: Obstruction;
}

const DEG = Math.PI / 180;

/**
 * Sichtfaktor eines Flächenstreifens im Schnitt auf einen Winkelbereich,
 * gemessen von der Flächennormalen: (sin φ₂ − sin φ₁) / 2.
 */
export function stripViewFactor(fromNormalDeg: number, toNormalDeg: number): number {
  return (Math.sin(toNormalDeg * DEG) - Math.sin(fromNormalDeg * DEG)) / 2;
}

/** Profilwinkel: die Sonnenhöhe im Schnitt senkrecht zur Fassade, Grad; NaN hinter der Fassade. */
export function profileAngle(sun: SolarPosition, surface: SurfaceOrientation): number {
  const cosAzimuth = Math.cos((sun.azimuth - surface.azimuth) * DEG);
  if (sun.altitude <= 0 || cosAzimuth <= 0) return NaN;
  return Math.atan(Math.tan(sun.altitude * DEG) / cosAzimuth) / DEG;
}

/**
 * Beschatteter Anteil der Fensterhöhe unter dem Vordach, 0…1.
 *
 * Der Schatten der Vorderkante reicht P · tan α_p unter das Vordach; α_p ist
 * der Profilwinkel.
 */
export function overhangShadedFraction(
  sun: SolarPosition,
  surface: SurfaceOrientation,
  overhang: Overhang,
): number {
  const profile = profileAngle(sun, surface);
  // Sonne hinter der Fassade oder unter dem Horizont: nichts zu beschatten.
  if (Number.isNaN(profile)) return 0;
  return Math.min(1, Math.max(0, overhang.depthRatio * Math.tan(profile * DEG) - overhang.gapRatio));
}

/**
 * Sichtfaktor des Fensters zum Himmel, bezogen auf den unverbauten Wert 1/2
 * einer senkrechten Fläche.
 *
 * Ein Punkt in der Tiefe d unter dem Vordach sieht den Himmel zwischen der
 * Verbauung ε und der Vorderkante des Vordachs, β = atan(d / p), also
 * (sin β − sin ε) / 2. Über die Fensterhöhe gemittelt:
 *
 *   ∫ (d / √(d² + p²) − sin ε) dd  von max(g, p tan ε) bis 1 + g
 *
 * Ohne Verbauung ergibt das √(p² + (1 + g)²) − √(p² + g²), die Fadenmethode von
 * Hottel; ohne Vordach 1 − sin ε.
 */
export function skyViewRatio(shading: ExternalShading): number {
  const p = shading.overhang?.depthRatio ?? 0;
  const g = shading.overhang?.gapRatio ?? 0;
  const epsilon = (shading.obstruction?.angle ?? 0) * DEG;
  const sinEpsilon = Math.sin(epsilon);
  const top = 1 + g;
  const bottom = Math.max(g, p * Math.tan(epsilon));
  if (bottom >= top) return 0;
  const antiderivative = (d: number) => Math.hypot(d, p) - sinEpsilon * d;
  return antiderivative(top) - antiderivative(bottom);
}

/** Dasselbe nur mit Vordach; nach der Fadenmethode. */
export function overhangSkyViewRatio(overhang: Overhang): number {
  return skyViewRatio({ overhang });
}

/**
 * Sichtfaktor des Fensters auf die Unterseite des Vordachs, absolut (nicht auf
 * 1/2 bezogen). Fadenmethode im Schnitt, Fensterhöhe 1.
 */
export function overhangViewFactor(overhang: Overhang): number {
  const p = overhang.depthRatio;
  const g = overhang.gapRatio;
  return (Math.hypot(p, g) + 1 - Math.hypot(p, 1 + g)) / 2;
}

/**
 * Was Vordach und Gegenüber zurückwerfen, W/m² auf das Fenster.
 *
 * Die Unterseite des Vordachs sieht den Boden: Sie empfängt ρ_Boden · I_global
 * und gibt davon ihren eigenen Reflexionsgrad weiter. Die Fassade gegenüber
 * steht im Sichtfeld zwischen Horizont und Verbauungswinkel, also mit
 * sin(ε)/2; besonnt wirft sie einen erheblichen Teil zurück.
 */
export function reflectedFromSurroundings(shading: ExternalShading, input: ReflectionInput): number {
  let reflected = 0;
  const overhang = shading.overhang;
  if (overhang?.albedo) {
    reflected += overhang.albedo * input.groundAlbedo * Math.max(0, input.globalHorizontal) * overhangViewFactor(overhang);
  }
  const obstruction = shading.obstruction;
  if (obstruction?.albedo) {
    reflected += obstruction.albedo * Math.max(0, input.opposite) * Math.sin(obstruction.angle * DEG) / 2;
  }
  return reflected;
}

/** Einstrahlung auf das Fenster mit Vordach und Verbauung. */
export function irradianceWithExternalShading(
  irradiance: TiltedIrradiance,
  sun: SolarPosition,
  surface: SurfaceOrientation,
  shading: ExternalShading,
  reflection?: ReflectionInput,
): TiltedIrradiance {
  let sunlit = shading.overhang ? 1 - overhangShadedFraction(sun, surface, shading.overhang) : 1;
  if (shading.obstruction) {
    // Unterhalb der Verbauung sieht das Fenster die Sonne nicht.
    const profile = profileAngle(sun, surface);
    if (!(profile >= shading.obstruction.angle)) sunlit = 0;
  }
  const sky = skyViewRatio(shading);

  const beam = irradiance.beam * sunlit;
  const diffuseIsotropic = irradiance.diffuseIsotropic * sky;
  const diffuseCircumsolar = irradiance.diffuseCircumsolar * sunlit;
  // Den Horizontstreifen verdeckt jede Verbauung, ein Vordach nicht.
  const diffuseHorizon = shading.obstruction ? 0 : irradiance.diffuseHorizon;
  const diffuse = Math.max(0, diffuseIsotropic + diffuseCircumsolar + diffuseHorizon);
  // Was die Umgebung zurückwirft, steht bei der Bodenreflexion: beides kommt
  // von unterhalb des Horizonts oder von einer Fläche statt vom Himmel.
  const groundReflected = irradiance.groundReflected
    + (reflection ? reflectedFromSurroundings(shading, reflection) : 0);

  return {
    total: beam + diffuse + groundReflected,
    beam,
    diffuse,
    diffuseIsotropic,
    diffuseCircumsolar,
    diffuseHorizon,
    groundReflected,
  };
}

/** Nur mit Vordach. */
export function irradianceUnderOverhang(
  irradiance: TiltedIrradiance,
  sun: SolarPosition,
  surface: SurfaceOrientation,
  overhang: Overhang,
): TiltedIrradiance {
  return irradianceWithExternalShading(irradiance, sun, surface, { overhang });
}

/** Wirft bei einer Geometrie, die diese Rechnung nicht abbildet. */
export function assertExternalShadingApplies(shading: ExternalShading, surface: SurfaceOrientation): void {
  if (!shading.overhang && !shading.obstruction) return;
  if (surface.tilt !== 90) {
    throw new Error(`Verschattung von aussen nur bei senkrechten Fenstern gerechnet, nicht bei ${surface.tilt}° Neigung`);
  }
  for (const [key, value] of Object.entries(shading.overhang ?? {})) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Vordach: ${key} = ${value} ist keine Geometrie`);
  }
  for (const albedo of [shading.overhang?.albedo, shading.obstruction?.albedo]) {
    if (albedo !== undefined && !(albedo >= 0 && albedo <= 1)) {
      throw new Error(`Reflexionsgrad ${albedo} liegt nicht zwischen 0 und 1`);
    }
  }
  const angle = shading.obstruction?.angle;
  if (angle !== undefined && !(angle >= 0 && angle < 90)) {
    throw new Error(`Verbauung: ${angle}° liegt nicht zwischen 0 und 90°`);
  }
}

/** Nur mit Vordach. */
export function assertOverhangApplies(overhang: Overhang, surface: SurfaceOrientation): void {
  assertExternalShadingApplies({ overhang }, surface);
}
