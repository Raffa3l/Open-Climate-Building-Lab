/**
 * Raummodell 5R1C nach EN ISO 13790:2008, Simple Hourly Method.
 *
 * Herleitung, Knotenbild und Grenzen: docs/methods/006-room-model-5r1c.md
 *
 * Zur Normenlage: 5R1C stammt aus EN ISO 13790:2008. ISO 52016-1 hat diese
 * Norm abgelöst und verwendet ein anderes, knotenbasiertes Stundenverfahren.
 * Implementiert ist hier bewusst 13790 — es ist breit dokumentiert, in vielen
 * Werkzeugen umgesetzt und damit vergleichbar. Ein Wechsel auf 52016-1 wäre
 * ein eigenes Verfahren mit eigener MethodRef, nicht eine neue Version dieses.
 */

import type { Computation, DatasetRef, MethodRef } from "./provenance.ts";
import { assertOverhangApplies, irradianceUnderOverhang, type Overhang } from "./overhang.ts";
import { intervalMidpointUtcMs, localHour, localWeekday, type TimeAxis } from "./series.ts";
import { diffuseFraction, irradianceOnSurface, solarPosition, type SkyModel, type SurfaceOrientation } from "./solar.ts";
import { DELTA_SKY_DEFAULT_K, skyRadiationLoss, skyTemperature } from "./sky.ts";

// --- Normkonstanten nach EN ISO 13790 ---------------------------------------

/** Wärmeübergang Luftknoten ↔ Oberflächenknoten, W/(m²K). §7.2.2.2 */
const H_IS = 3.45;
/** Wärmeübergang Oberflächen- ↔ Massenknoten, W/(m²K). §12.2.2 */
const H_MS = 9.1;
/** Verhältnis wärmeübertragende Fläche zu Nettogrundfläche. §7.2.2.2 */
const LAMBDA_AT = 4.5;
/** Volumenbezogene Wärmekapazität von Luft, J/(m³K). */
const RHO_C_AIR = 1200;
/** Abminderung für nicht streuende Verglasung, §11.4.2 */
const F_W = 0.9;

export const METHOD_ROOM_5R1C: MethodRef = {
  id: "building.simulate5R1C",
  // 1.1.0: langwellige Abstrahlung gegen den Himmel ergänzt (§11.3.5).
  // 1.2.0: Standard-Himmelsmodell von isotrop auf Perez (1990) umgestellt.
  // 1.3.0: zyklischer Vorlauf aus dem Ende der Reihe (ADR 0008); das ganze
  //        Jahr ist gültig statt der ersten 5·τ verworfen.
  // 1.4.0: fehlt die Globalstrahlung bei Sonne über dem Horizont, ist die
  //        Stunde nicht rechenbar, statt mit 0 W/m² gerechnet zu werden.
  // Das Vordach (WindowSpec.overhang, 011) kam ohne Versionssprung dazu: Ohne
  // Vordach ändert sich kein Ergebnis, mit Vordach steht es in den Parametern.
  // Ergebnisse ändern sich jeweils; publizierte Werte bleiben über die
  // Version zuordenbar.
  version: "1.4.0",
  doc: "docs/methods/006-room-model-5r1c.md#stundenschritt",
  sources: ["en-iso-13790-2008"],
};

// --- Gebäudebeschreibung ----------------------------------------------------

export type MassClass = "sehr leicht" | "leicht" | "mittel" | "schwer" | "sehr schwer";

/** Bauart nach EN ISO 13790, Tabelle 12. */
const MASS_CLASSES: Record<MassClass, { areaFactor: number; capacityPerFloorArea: number }> = {
  "sehr leicht": { areaFactor: 2.5, capacityPerFloorArea: 80_000 },
  leicht: { areaFactor: 2.5, capacityPerFloorArea: 110_000 },
  mittel: { areaFactor: 2.5, capacityPerFloorArea: 165_000 },
  schwer: { areaFactor: 3.0, capacityPerFloorArea: 260_000 },
  "sehr schwer": { areaFactor: 3.5, capacityPerFloorArea: 370_000 },
};

export interface ShadingControl {
  /** Abminderungsfaktor bei aktiviertem Sonnenschutz, F_sh. 1 = keine Wirkung. */
  factorClosed: number;
  /**
   * Bestrahlungsstärke auf die Fläche, ab der geschlossen wird, W/m².
   * `Infinity` bedeutet: Sonnenschutz wird nie aktiviert.
   */
  activationIrradiance: number;
}

export const NO_SHADING: ShadingControl = { factorClosed: 1, activationIrradiance: Infinity };

export interface WindowSpec {
  /** Rohbaulichte Fensterfläche inklusive Rahmen, m². */
  area: number;
  orientation: SurfaceOrientation;
  /** Wärmedurchgangskoeffizient inklusive Rahmen, W/(m²K). */
  uValue: number;
  /** Gesamtenergiedurchlassgrad der Verglasung. */
  gValue: number;
  /** Rahmenanteil an der Fensterfläche, 0…1. */
  frameFraction: number;
  shading: ShadingControl;
  /**
   * Vordach oder Balkon über dem Fenster, nur bei senkrechten Fenstern.
   * Fehlt das Feld, fehlt es auch im Hash: Räume ohne Vordach rechnen und
   * heissen wie vorher.
   */
  overhang?: Overhang;
}

export interface RoomSpec {
  /** Nettogrundfläche, m². */
  floorArea: number;
  /** Lichte Raumhöhe, m. */
  height: number;
  /** Opake Aussenbauteilfläche, m². */
  opaqueArea: number;
  /** Mittlerer U-Wert der opaken Aussenbauteile, W/(m²K). */
  opaqueUValue: number;
  /** Wärmebrückenzuschlag, W/K. */
  thermalBridges: number;
  windows: WindowSpec[];
  massClass: MassClass;
  /** Grundluftwechsel aus Infiltration und Nutzungslüftung, 1/h. */
  airChangeRate: number;
  /** Interne Wärmelasten bei Belegung, W/m² Nettogrundfläche. */
  internalGains: number;
  /** Ohne Profil gelten die internen Lasten rund um die Uhr. */
  occupancy?: OccupancySchedule;
  nightVentilation?: NightVentilationControl;
  /** Bodenreflexionsgrad für die Einstrahlung. */
  groundAlbedo?: number;
  /**
   * Himmelsmodell für die kurzwellige Einstrahlung. Standard `"perez"` —
   * anisotrop und deutlich näher an der Messung. `"isotrop"` reproduziert das
   * einfachere Modell nach Liu & Jordan, siehe docs/methods/005-solar.md.
   */
  skyModel?: SkyModel;
  /**
   * Vorlauf in Stunden, bevor die erste Stunde der Reihe gerechnet wird. Er
   * durchläuft das Ende derselben Reihe, damit der Massenknoten am ersten Tag
   * eingeschwungen ist, siehe docs/methods/006-room-model-5r1c.md#vorlauf.
   * Ohne Angabe gilt die Einschwingzeit `warmupHours()`; 0 schaltet ihn ab.
   */
  spinUpHours?: number;
  /**
   * Formfaktor der Aussenbauteile zum Himmel, 0…1. EN ISO 13790 §11.4.6:
   * 1.0 für ein unverschattetes Flachdach, **0.5 für eine senkrechte Fassade**
   * — die andere Hälfte des Halbraums ist Boden und Umgebung.
   */
  skyViewFactor?: number;
}

/**
 * Belegungsprofil.
 *
 * Ohne Profil laufen interne Lasten rund um die Uhr — das ist die grösste
 * Einzelvereinfachung eines Stundenmodells und treibt die
 * Übertemperaturstunden deutlich nach oben. Ein Büro ist nachts und am
 * Wochenende leer, und die hygienische Lüftung läuft nur bei Belegung.
 */
export interface OccupancySchedule {
  /** Beginn der Belegung, lokale Stunde. */
  fromHour: number;
  /** Ende der Belegung, lokale Stunde. */
  toHour: number;
  /** Wochenende aussparen. */
  weekdaysOnly: boolean;
  /** Interne Lasten ausserhalb der Belegung, W/m² (Standby, Kühlschrank). */
  gainsUnoccupied: number;
  /** Luftwechsel während der Belegung, 1/h. Ohne Angabe gilt der Grundwert. */
  airChangeOccupied?: number;
}

export interface NightVentilationControl {
  /** Zusätzlicher Luftwechsel bei aktivierter Nachtlüftung, 1/h. */
  airChangeRate: number;
  /** Beginn des Fensters, lokale Stunde. */
  fromHour: number;
  /** Ende des Fensters, lokale Stunde. */
  toHour: number;
  /** Erst lüften, wenn der Raum wärmer ist als dieser Wert, °C. */
  minIndoorC: number;
  /** Mindestgefälle Raum minus aussen, K. */
  minDeltaK: number;
}

/** Abgeleitete Kenngrössen der Bauart — nachvollziehbar ausgewiesen. */
export interface RoomDerived {
  /** Wirksame Speicherfläche A_m, m². */
  effectiveMassArea: number;
  /** Wirksame Speicherfähigkeit C_m, J/K. */
  effectiveCapacity: number;
  /** Gesamte wärmeübertragende Innenfläche A_t, m². */
  totalInternalArea: number;
  /** Transmission über Fenster H_tr,w, W/K. */
  windowConductance: number;
  /** Transmission über opake Bauteile H_tr,op, W/K. */
  opaqueConductance: number;
  /** H_tr,em zwischen Massenknoten und aussen, W/K. */
  externalMassConductance: number;
  /** H_tr,ms zwischen Oberflächen- und Massenknoten, W/K. */
  surfaceMassConductance: number;
  /** H_tr,is zwischen Luft- und Oberflächenknoten, W/K. */
  airSurfaceConductance: number;
  volume: number;
}

export function deriveRoom(room: RoomSpec): RoomDerived {
  const massClass = MASS_CLASSES[room.massClass];
  const effectiveMassArea = massClass.areaFactor * room.floorArea;
  const totalInternalArea = LAMBDA_AT * room.floorArea;

  const windowConductance = room.windows.reduce((sum, w) => sum + w.area * w.uValue, 0);
  const opaqueConductance = room.opaqueArea * room.opaqueUValue + room.thermalBridges;
  const surfaceMassConductance = H_MS * effectiveMassArea;

  // H_tr,em nach §12.2.2. Die Reihenschaltung setzt H_tr,op < H_tr,ms voraus;
  // bei sehr schlecht gedämmter, sehr leichter Bauart ist das verletzt.
  if (opaqueConductance >= surfaceMassConductance) {
    throw new Error(
      `Bauart ausserhalb des Modellbereichs: H_tr,op = ${opaqueConductance.toFixed(1)} W/K ist nicht ` +
        `kleiner als H_tr,ms = ${surfaceMassConductance.toFixed(1)} W/K. Schwerere Bauart oder ` +
        `besserer U-Wert nötig — siehe docs/methods/006-room-model-5r1c.md#gültigkeitsbereich`,
    );
  }

  return {
    effectiveMassArea,
    effectiveCapacity: massClass.capacityPerFloorArea * room.floorArea,
    totalInternalArea,
    windowConductance,
    opaqueConductance,
    externalMassConductance: 1 / (1 / opaqueConductance - 1 / surfaceMassConductance),
    surfaceMassConductance,
    airSurfaceConductance: H_IS * totalInternalArea,
    volume: room.floorArea * room.height,
  };
}

// --- Simulation -------------------------------------------------------------

export interface SimulationInput {
  /** Aussenlufttemperatur, °C, stündlich. */
  outdoorTemperature: Float64Array;
  /** Globalstrahlung horizontal, W/m², stündlich. */
  globalHorizontal: Float64Array;
  /** Gemessene Diffusstrahlung horizontal, W/m². Fehlt sie, greift Erbs. */
  diffuseHorizontal?: Float64Array;
  /**
   * Langwellige Einstrahlung horizontal, W/m² — `oli000h0`. Daraus folgt die
   * Himmelstemperatur stündlich. Fehlt sie, greift der Pauschalwert der Norm.
   */
  downwellingLongwave?: Float64Array;
  axis: TimeAxis;
  latitude: number;
  longitude: number;
}

export interface SimulationResult {
  /** Operative Raumtemperatur, °C — die Grösse, die der Komfort bewertet. */
  operativeTemperature: Float64Array;
  airTemperature: Float64Array;
  massTemperature: Float64Array;
  /** Solare Wärmeeinträge nach Abzug der Himmelsabstrahlung, W. */
  solarGains: Float64Array;
  /**
   * Tatsächlich wirksamer Verlust durch Abstrahlung gegen den Himmel, W —
   * also F_r · Φ_r, bereits mit dem Formfaktor gewichtet. Immer ≥ 0.
   * Bei `skyViewFactor: 0` durchgehend null.
   */
  skyLoss: Float64Array;
  /** Woher die Himmelstemperatur stammt. */
  longwaveSource: "gemessen" | "pauschal";
  /** Stunden, in denen der Sonnenschutz aktiv war. */
  shadedHours: number;
  /** Stunden, in denen die Nachtlüftung lief. */
  nightVentilationHours: number;
  /** Stunden mit Belegung. Ohne Profil sind das alle Stunden. */
  occupiedHours: number;
  /** Stunden Vorlauf aus dem Ende der Reihe, vor der ersten Stunde gerechnet. */
  spinUpHours: number;
  /**
   * Stunden mit Sonne über dem Horizont, aber ohne Globalstrahlung. Sie sind
   * nicht gerechnet und stehen auf `NaN`, wie Stunden ohne Aussentemperatur.
   */
  missingSolarHours: number;
  derived: RoomDerived;
}

/**
 * Frei laufende Simulation ohne Heizung und Kühlung: Φ_HC = 0.
 *
 * Das ist der Fall, den der sommerliche Wärmeschutz betrachtet — die Frage ist
 * ja gerade, wie warm es *ohne* Kühlung wird.
 */
export function simulate5R1C(
  room: RoomSpec,
  input: SimulationInput,
  inputs: DatasetRef[],
): Computation<SimulationResult> {
  const derived = deriveRoom(room);
  const n = input.axis.length;
  for (const window of room.windows) {
    if (window.overhang) assertOverhangApplies(window.overhang, window.orientation);
  }

  const operativeTemperature = new Float64Array(n).fill(NaN);
  const airTemperature = new Float64Array(n).fill(NaN);
  const massTemperature = new Float64Array(n).fill(NaN);
  const solarGains = new Float64Array(n).fill(NaN);
  const skyLoss = new Float64Array(n).fill(NaN);

  const albedo = room.groundAlbedo ?? 0.2;
  const skyViewFactor = room.skyViewFactor ?? 0.5;
  const skyModel: SkyModel = room.skyModel ?? "perez";
  const hasLongwave = input.downwellingLongwave !== undefined;

  const spinUpHours = Math.max(0, Math.round(room.spinUpHours ?? warmupHoursFromDerived(derived)));

  // Startwert des Massenknotens: erster gültiger Aussenwert ab dem ersten
  // gerechneten Schritt, mit Vorlauf also ab dessen Beginn. Mit Vorlauf ist er
  // bis zur ersten Stunde der Reihe abgeklungen; ohne Vorlauf wirkt er über die
  // Einschwingphase nach, siehe warmupHours().
  const firstStep = n > 0 ? (((n - spinUpHours) % n) + n) % n : 0;
  let massPrevious = firstFiniteFrom(input.outdoorTemperature, firstStep) ?? 20;

  let shadedHours = 0;
  let nightVentilationHours = 0;
  let occupiedHours = 0;
  let missingSolarHours = 0;
  let airPrevious = massPrevious;

  // Ein Stundenschritt. `record` ist im Vorlauf aus: Der Zustand schreitet fort,
  // aber nichts wird gespeichert oder gezählt.
  const step = (i: number, record: boolean): void => {
    const outdoor = input.outdoorTemperature[i];
    const global = input.globalHorizontal[i];

    if (!Number.isFinite(outdoor)) {
      // Ohne Aussentemperatur ist der Schritt nicht rechenbar. Der Massenknoten
      // wird eingefroren statt fortgeschrieben — eine erfundene Temperatur
      // würde sich über die Speicherfähigkeit tagelang weiterschleppen.
      return;
    }

    // --- solare Einträge ---
    const midpoint = intervalMidpointUtcMs(input.axis, i);
    const sun = solarPosition(midpoint, input.latitude, input.longitude);
    const dayOfYear = dayOfYearFromMs(midpoint);

    // Fehlt die Globalstrahlung bei Tag, ist die Stunde nicht rechenbar. Bis
    // 1.3.0 galt sie als 0 W/m²: Vals 2021 misst an 6 % der Stunden, und das
    // Modell rechnete still einen Raum ohne Sonne. Der Zustand bleibt stehen wie
    // bei fehlender Aussentemperatur. Nachts ist die Einstrahlung ohnehin null.
    if (!Number.isFinite(global) && sun.altitude > 0) {
      if (record) missingSolarHours++;
      return;
    }
    const globalOk = Number.isFinite(global) ? Math.max(0, global) : 0;
    const diffuse =
      input.diffuseHorizontal && Number.isFinite(input.diffuseHorizontal[i])
        ? Math.max(0, input.diffuseHorizontal[i])
        : globalOk * diffuseFraction(globalOk, sun.altitude, dayOfYear);

    let solarW = 0;
    let anyShaded = false;
    for (const window of room.windows) {
      const onSurface = irradianceOnSurface(
        skyModel, globalOk, diffuse, sun, window.orientation, dayOfYear, albedo,
      );
      // Der Sonnenschutz regelt auf das, was unter dem Vordach ankommt, wie ein
      // Fühler am Fenster.
      const irradiance = window.overhang
        ? irradianceUnderOverhang(onSurface, sun, window.orientation, window.overhang).total
        : onSurface.total;
      const shadingActive = irradiance >= window.shading.activationIrradiance;
      if (shadingActive) anyShaded = true;
      const shadingFactor = shadingActive ? window.shading.factorClosed : 1;
      const glazedArea = window.area * (1 - window.frameFraction);
      solarW += shadingFactor * F_W * window.gValue * glazedArea * irradiance;
    }
    if (record && anyShaded) shadedHours++;

    // --- langwellige Abstrahlung gegen den Himmel, §11.3.5 ---
    // Der Himmel ist kälter als die Luft; Flächen mit Himmelssicht verlieren
    // dadurch mehr, als der U-Wert abbildet. Nachts kann der solare Eintrag
    // dadurch negativ werden — das ist physikalisch richtig, kein Fehler.
    let deltaSky = DELTA_SKY_DEFAULT_K;
    if (hasLongwave) {
      const measured = skyTemperature(input.downwellingLongwave![i]);
      if (Number.isFinite(measured)) deltaSky = Math.max(0, outdoor - measured);
    }

    let radiativeLoss = skyRadiationLoss(room.opaqueUValue, room.opaqueArea, deltaSky);
    for (const window of room.windows) {
      radiativeLoss += skyRadiationLoss(window.uValue, window.area, deltaSky);
    }
    const appliedLoss = skyViewFactor * radiativeLoss;
    solarW -= appliedLoss;
    if (record) {
      skyLoss[i] = appliedLoss;
      solarGains[i] = solarW;
    }

    // --- Belegung ---
    const hourLocal = localHour(input.axis, i);
    let occupied = true;
    if (room.occupancy) {
      const o = room.occupancy;
      const inHours = o.fromHour <= o.toHour
        ? hourLocal >= o.fromHour && hourLocal < o.toHour
        : hourLocal >= o.fromHour || hourLocal < o.toHour;
      const weekday = localWeekday(input.axis, i);
      const workday = !o.weekdaysOnly || (weekday >= 1 && weekday <= 5);
      occupied = inHours && workday;
    }
    const gainsPerArea = occupied
      ? room.internalGains
      : room.occupancy?.gainsUnoccupied ?? room.internalGains;
    const internalGainsW = gainsPerArea * room.floorArea;
    if (record && occupied) occupiedHours++;

    // --- Lüftung ---
    let airChange = occupied && room.occupancy?.airChangeOccupied !== undefined
      ? room.occupancy.airChangeOccupied
      : room.airChangeRate;
    const nv = room.nightVentilation;
    if (nv) {
      const inWindow = nv.fromHour <= nv.toHour
        ? hourLocal >= nv.fromHour && hourLocal < nv.toHour
        : hourLocal >= nv.fromHour || hourLocal < nv.toHour;
      // Regelung auf dem Zustand der Vorstunde: eine Regelung kann nicht auf
      // die Temperatur reagieren, die sie selbst erst erzeugt.
      if (inWindow && airPrevious > nv.minIndoorC && airPrevious - outdoor > nv.minDeltaK) {
        airChange += nv.airChangeRate;
        if (record) nightVentilationHours++;
      }
    }
    const ventilationConductance = (RHO_C_AIR * airChange * derived.volume) / 3600;

    // --- Aufteilung der Gewinne nach §C.2 ---
    const phiIa = 0.5 * internalGainsW;
    const phiSt =
      (1 -
        derived.effectiveMassArea / derived.totalInternalArea -
        derived.windowConductance / (H_MS * derived.totalInternalArea)) *
      (0.5 * internalGainsW + solarW);
    const phiM =
      (derived.effectiveMassArea / derived.totalInternalArea) * (0.5 * internalGainsW + solarW);

    // --- Stundenschritt nach §C.3 ---
    const hTr1 = 1 / (1 / ventilationConductance + 1 / derived.airSurfaceConductance);
    const hTr2 = hTr1 + derived.windowConductance;
    const hTr3 = 1 / (1 / hTr2 + 1 / derived.surfaceMassConductance);

    const supply = outdoor; // freie Lüftung, keine Wärmerückgewinnung

    const phiMtot =
      phiM +
      derived.externalMassConductance * outdoor +
      (hTr3 * (phiSt + derived.windowConductance * outdoor + hTr1 * (phiIa / ventilationConductance + supply))) /
        hTr2;

    const capacityPerHour = derived.effectiveCapacity / 3600;
    const conductanceSum = hTr3 + derived.externalMassConductance;

    const massNext =
      (massPrevious * (capacityPerHour - 0.5 * conductanceSum) + phiMtot) /
      (capacityPerHour + 0.5 * conductanceSum);
    const massMean = (massNext + massPrevious) / 2;

    const surface =
      (derived.surfaceMassConductance * massMean +
        phiSt +
        derived.windowConductance * outdoor +
        hTr1 * (supply + phiIa / ventilationConductance)) /
      (derived.surfaceMassConductance + derived.windowConductance + hTr1);

    const air =
      (derived.airSurfaceConductance * surface + ventilationConductance * supply + phiIa) /
      (derived.airSurfaceConductance + ventilationConductance);

    if (record) {
      massTemperature[i] = massMean;
      airTemperature[i] = air;
      operativeTemperature[i] = 0.3 * air + 0.7 * surface;
    }

    massPrevious = massNext;
    airPrevious = air;
  };

  // Zyklischer Vorlauf: die letzten spinUpHours Stunden derselben Reihe, in
  // ihrer Reihenfolge, direkt vor der ersten. Beim Messjahr steht damit der
  // Dezember vor dem Januar, beim Szenario der Dezember des Referenzjahres.
  // Jede Stunde behält ihren eigenen Zeitstempel für Sonnenstand und Belegung.
  // Ist die Reihe kürzer als der Vorlauf, läuft sie mehrfach durch.
  if (n > 0) {
    for (let k = 0; k < spinUpHours; k++) {
      step((((n - spinUpHours + k) % n) + n) % n, false);
    }
  }
  for (let i = 0; i < n; i++) step(i, true);

  return {
    value: {
      operativeTemperature,
      airTemperature,
      massTemperature,
      solarGains,
      skyLoss,
      longwaveSource: hasLongwave ? "gemessen" : "pauschal",
      shadedHours,
      nightVentilationHours,
      occupiedHours,
      spinUpHours,
      missingSolarHours,
      derived,
    },
    unit: "°C",
    method: METHOD_ROOM_5R1C,
    params: {
      floorArea: room.floorArea,
      height: room.height,
      opaqueArea: room.opaqueArea,
      opaqueUValue: room.opaqueUValue,
      thermalBridges: room.thermalBridges,
      massClass: room.massClass,
      airChangeRate: room.airChangeRate,
      internalGains: room.internalGains,
      groundAlbedo: albedo,
      skyModel,
      skyViewFactor,
      longwaveSource: hasLongwave ? "gemessen" : `pauschal ${DELTA_SKY_DEFAULT_K} K`,
      windows: JSON.stringify(room.windows),
      nightVentilation: room.nightVentilation ? JSON.stringify(room.nightVentilation) : "aus",
      occupancy: room.occupancy ? JSON.stringify(room.occupancy) : "durchgehend",
      spinUpHours,
    },
    inputs,
  };
}

/**
 * Stunden, die als Einschwingphase zu verwerfen sind.
 *
 * Der Massenknoten startet auf der Aussentemperatur der ersten Stunde. Wie
 * lange die Erinnerung daran nachwirkt, hängt an der Zeitkonstante
 * τ = C_m / H_tr — bei schwerer Bauart mehrere Tage. Verworfen wird das
 * Fünffache, aufgerundet auf ganze Tage.
 */
export function warmupHours(room: RoomSpec): number {
  return warmupHoursFromDerived(deriveRoom(room));
}

/**
 * Dasselbe aus den abgeleiteten Kenngrössen, die jedes SimulationResult
 * mitführt. Damit verwirft exceedanceHours() die Einschwingphase selbst, ohne
 * die Raumbeschreibung zu kennen, und kein Aufrufer muss daran denken.
 */
export function warmupHoursFromDerived(
  derived: Pick<RoomDerived, "effectiveCapacity" | "opaqueConductance" | "windowConductance">,
): number {
  const totalConductance = derived.opaqueConductance + derived.windowConductance;
  const tauHours = derived.effectiveCapacity / totalConductance / 3600;
  return Math.ceil((5 * tauHours) / 24) * 24;
}

/** Erster gültiger Wert ab `start`, über das Ende hinweg zyklisch weitergesucht. */
function firstFiniteFrom(values: Float64Array, start: number): number | null {
  for (let k = 0; k < values.length; k++) {
    const v = values[(start + k) % values.length];
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function dayOfYearFromMs(utcMs: number): number {
  const d = new Date(utcMs);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((utcMs - start) / 86_400_000) + 1;
}
