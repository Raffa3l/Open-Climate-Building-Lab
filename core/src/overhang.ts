/**
 * Verschattung eines senkrechten Fensters durch ein Vordach oder einen Balkon.
 *
 * Das Vordach gilt als lang gegenüber der Fensterbreite, wie eine durchgehende
 * Balkonplatte. Dann reicht ein Schnitt senkrecht zur Fassade, und der Schatten
 * hängt nur am Profilwinkel. Seitlich vorbeischeinende Sonne bei einem kurzen
 * Vordach bildet das nicht ab; es überschätzt dessen Wirkung.
 *
 * Welche Anteile der Einstrahlung das Vordach mindert, folgt dem NREL «Solar
 * Radiation Data Manual for Buildings»: Direktstrahlung und zirkumsolare
 * Aufhellung werfen denselben Schatten, der übrige Himmel verliert Sichtfaktor,
 * Horizontaufhellung und Bodenreflexion bleiben unberührt.
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

/** Geometrie bezogen auf die Fensterhöhe H, damit nur Verhältnisse eingehen. */
export interface Overhang {
  /** Auskragung P des Vordachs vor der Fassade, geteilt durch H. */
  depthRatio: number;
  /** Abstand G zwischen Fensteroberkante und Vordach, geteilt durch H. */
  gapRatio: number;
}

const DEG = Math.PI / 180;

/**
 * Beschatteter Anteil der Fensterhöhe für die Direktstrahlung, 0…1.
 *
 * Der Schatten der Vorderkante reicht P · tan α_p unter das Vordach; α_p ist
 * der Profilwinkel, die Sonnenhöhe im Schnitt senkrecht zur Fassade.
 */
export function overhangShadedFraction(
  sun: SolarPosition,
  surface: SurfaceOrientation,
  overhang: Overhang,
): number {
  if (sun.altitude <= 0) return 0;
  const cosAzimuth = Math.cos((sun.azimuth - surface.azimuth) * DEG);
  // Sonne hinter der Fassade: keine Direktstrahlung, also nichts zu beschatten.
  if (cosAzimuth <= 0) return 0;
  const tanProfile = Math.tan(sun.altitude * DEG) / cosAzimuth;
  return Math.min(1, Math.max(0, overhang.depthRatio * tanProfile - overhang.gapRatio));
}

/**
 * Sichtfaktor des Fensters zum Himmel unter dem Vordach, bezogen auf den
 * unverbauten Wert 1/2 einer senkrechten Fläche.
 *
 * Nach der Fadenmethode von Hottel im Schnitt: Der Anteil, den das Fenster
 * (Höhe 1) auf die Unterseite des Vordachs sieht, ist
 * F = (√(p² + g²) + 1 − √(p² + (1 + g)²)) / 2. Dem Himmel bleibt 1/2 − F.
 */
export function overhangSkyViewRatio(overhang: Overhang): number {
  const p = overhang.depthRatio;
  const g = overhang.gapRatio;
  const toOverhang = (Math.hypot(p, g) + 1 - Math.hypot(p, 1 + g)) / 2;
  return 1 - 2 * toOverhang;
}

/** Einstrahlung auf das Fenster unter dem Vordach. */
export function irradianceUnderOverhang(
  irradiance: TiltedIrradiance,
  sun: SolarPosition,
  surface: SurfaceOrientation,
  overhang: Overhang,
): TiltedIrradiance {
  const sunlit = 1 - overhangShadedFraction(sun, surface, overhang);
  const sky = overhangSkyViewRatio(overhang);

  const beam = irradiance.beam * sunlit;
  const diffuseIsotropic = irradiance.diffuseIsotropic * sky;
  const diffuseCircumsolar = irradiance.diffuseCircumsolar * sunlit;
  const diffuseHorizon = irradiance.diffuseHorizon;
  const diffuse = Math.max(0, diffuseIsotropic + diffuseCircumsolar + diffuseHorizon);

  return {
    total: beam + diffuse + irradiance.groundReflected,
    beam,
    diffuse,
    diffuseIsotropic,
    diffuseCircumsolar,
    diffuseHorizon,
    groundReflected: irradiance.groundReflected,
  };
}

/** Wirft bei einer Geometrie, die diese Rechnung nicht abbildet. */
export function assertOverhangApplies(overhang: Overhang, surface: SurfaceOrientation): void {
  if (surface.tilt !== 90) {
    throw new Error(`Vordach nur über senkrechten Fenstern gerechnet, nicht bei ${surface.tilt}° Neigung`);
  }
  for (const [key, value] of Object.entries(overhang)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Vordach: ${key} = ${value} ist keine Geometrie`);
  }
}
