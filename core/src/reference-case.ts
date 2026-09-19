/**
 * Der Referenzfall: der Büroraum hinter den Reglern des Frontends, die Lesart
 * seines Permalinks und die Bewertung dazu.
 *
 * Bis 14.09.2026 stand das nur in web/app.js. Ein Export aus der Kommandozeile
 * hätte Raum, Belegungsfenster und Permalink nachbauen müssen, und zwei
 * Fassungen driften, ohne dass ein Hash es bemerkt: Er beschreibt, was gerechnet
 * wurde, nicht ob es dasselbe ist wie im Browser.
 */

import type { Computation } from "./provenance.ts";
import { upstreamOf } from "./provenance.ts";
import { getVariable, type StationSeries } from "./series.ts";
import { simulate5R1C, type MassClass, type OccupancySchedule, type RoomSpec, type SimulationResult } from "./building.ts";
import type { Overhang } from "./overhang.ts";
import type { SkyModel } from "./solar.ts";
import {
  adaptiveComfortBand,
  dailyMean,
  exceedanceHours,
  runningMeanOutdoorTemperature,
  type ComfortBand,
  type ExceedanceResult,
} from "./indicators.ts";

// --- Raum ---------------------------------------------------------------------

/** Büronutzung: werktags 07–19 Uhr, hygienische Lüftung nur bei Belegung. */
export const REFERENCE_OCCUPANCY: OccupancySchedule = {
  fromHour: 7,
  toHour: 19,
  weekdaysOnly: true,
  gainsUnoccupied: 2,
  airChangeOccupied: 1.5,
};

/** Bewertung nach EN 16798-1 im Belegungsfenster. */
export const REFERENCE_EVALUATION = { category: "II", occupiedFromHour: 7, occupiedToHour: 19 } as const;

/** Aussenwand des Raums, m²; der Fensteranteil teilt sie auf. */
const FACADE_AREA = 9.8;
/** Breite der Aussenwand, m: 9.8 m² bei 2.8 m Raumhöhe. */
const FACADE_WIDTH = 3.5;
/** Sturz zwischen Fensteroberkante und Decke, m; darüber liegt das Vordach. */
const LINTEL = 0.2;

/** Die Stellung der Regler. */
export interface RoomSettings {
  /** Fassadenazimut, Grad, 180 = Süd. */
  azimuth: number;
  massClass: MassClass;
  skyModel: SkyModel;
  /** Fensteranteil der Fassade, 0…1. Im Permalink in Prozent. */
  windowFraction: number;
  /** g_tot bei geschlossenem Sonnenschutz; 1 heisst kein Schutz. */
  shading: number;
  /** Auskragung eines Vordachs oder Balkons auf Deckenhöhe, m; 0 heisst keines. */
  overhang: number;
  /** Verbauungswinkel gegenüber, von der Fenstermitte aus, Grad; 0 heisst frei. */
  obstruction: number;
  /** Interne Lasten bei Belegung, W/m². */
  gains: number;
  /** Luftwechsel der Nachtlüftung, 1/h. */
  nightVent: number;
  nightVentOn: boolean;
}

/**
 * Was die Regler zulassen. Ein Test hält web/index.html darauf fest, damit
 * Browser und CLI dieselben Stellungen kennen und dieselben Vorgaben haben.
 */
export const ROOM_SETTING_CHOICES = {
  azimuth: [180, 135, 225, 90, 270, 0],
  massClass: ["sehr leicht", "leicht", "mittel", "schwer", "sehr schwer"],
  skyModel: ["perez", "isotrop"],
} as const satisfies Record<string, readonly (string | number)[]>;

/** Wertebereich der Schieberegler, so wie sie im Permalink stehen. */
export const ROOM_SETTING_RANGES = {
  windowFraction: { min: 10, max: 90, step: 5 },
  shading: { min: 0.05, max: 1, step: 0.05 },
  overhang: { min: 0, max: 2, step: 0.1 },
  obstruction: { min: 0, max: 60, step: 5 },
  gains: { min: 0, max: 45, step: 1 },
  nightVent: { min: 0, max: 8, step: 0.5 },
} as const;

export const DEFAULT_ROOM_SETTINGS: Readonly<RoomSettings> = {
  azimuth: 180,
  massClass: "mittel",
  skyModel: "perez",
  windowFraction: 0.4,
  shading: 0.15,
  overhang: 0,
  obstruction: 0,
  gains: 20,
  nightVent: 3,
  nightVentOn: true,
};

/**
 * Rundet Eingabegeometrie auf sechs Nachkommastellen.
 *
 * 9.8 − 9.8·0.4 ergibt in Gleitkomma 5.880000000000001. Der Rest ist
 * physikalisch bedeutungslos, wandert aber in den Berechnungs-Hash und macht
 * ihn damit vom Rechenweg abhängig statt vom Sachverhalt.
 */
export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function referenceRoom(s: RoomSettings): RoomSpec {
  const windowArea = round6(FACADE_AREA * s.windowFraction);
  return {
    floorArea: 20,
    height: 2.8,
    opaqueArea: round6(FACADE_AREA - windowArea),
    opaqueUValue: 0.2,
    thermalBridges: 0.5,
    windows: [
      {
        area: windowArea,
        orientation: { tilt: 90, azimuth: s.azimuth },
        uValue: 1.0,
        gValue: 0.5,
        frameFraction: 0.25,
        // Der Regler stellt g_tot; daraus folgt der Abminderungsfaktor
        // gegenüber der ungeschützten Verglasung.
        shading: s.shading >= 1
          ? { factorClosed: 1, activationIrradiance: Infinity }
          : { factorClosed: round6(s.shading / 0.5), activationIrradiance: 200 },
        // Ohne Vordach fehlt das Feld, und der Hash bleibt der bisherige.
        ...(s.overhang > 0 ? { overhang: overhangOverWindow(s.overhang, windowArea) } : {}),
        ...(s.obstruction > 0 ? { obstruction: { angle: s.obstruction } } : {}),
      },
    ],
    massClass: s.massClass,
    skyModel: s.skyModel,
    airChangeRate: 0.3,
    internalGains: s.gains,
    occupancy: REFERENCE_OCCUPANCY,
    nightVentilation: s.nightVentOn && s.nightVent > 0
      ? { airChangeRate: s.nightVent, fromHour: 22, toHour: 6, minIndoorC: 22, minDeltaK: 2 }
      : undefined,
  };
}

/**
 * Das Fenster als Band über die ganze Fassadenbreite, Oberkante 0.2 m unter der
 * Decke; das Vordach liegt auf Deckenhöhe. Mehr Fensteranteil heisst ein höheres
 * Fenster, und dasselbe Vordach beschattet davon einen kleineren Teil.
 */
function overhangOverWindow(depth: number, windowArea: number): Overhang {
  const windowHeight = windowArea / FACADE_WIDTH;
  return { depthRatio: round6(depth / windowHeight), gapRatio: round6(LINTEL / windowHeight) };
}

// --- Permalink ----------------------------------------------------------------

/** In dieser Reihenfolge stehen die Schlüssel im Permalink. */
export function roomSettingsToParams(s: RoomSettings): Array<[string, string]> {
  return [
    ["azimuth", String(s.azimuth)],
    ["massClass", s.massClass],
    ["skyModel", s.skyModel],
    ["windowFraction", String(Math.round(s.windowFraction * 100))],
    ["shading", String(s.shading)],
    ["overhang", String(s.overhang)],
    ["obstruction", String(s.obstruction)],
    ["gains", String(s.gains)],
    ["nightVent", String(s.nightVent)],
    ["nightVentOn", s.nightVentOn ? "1" : "0"],
  ];
}

/**
 * Liest die Reglerstellung aus einem Permalink. Fehlende Schlüssel erhalten die
 * Vorgabe, wie im Browser.
 *
 * Anders als der Browser bricht diese Fassung bei einem Wert ab, den kein Regler
 * annehmen kann. Der Browser rundet ihn still auf die nächste Stellung; hier
 * übernommen, ergäbe er einen anderen Raum als dort, unter einem anderen Hash.
 */
export function roomSettingsFromParams(params: URLSearchParams): RoomSettings {
  const choice = <T extends string | number>(key: keyof typeof ROOM_SETTING_CHOICES, fallback: T): T => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const allowed = ROOM_SETTING_CHOICES[key] as unknown as readonly T[];
    const hit = allowed.find((a) => String(a) === raw);
    if (hit === undefined) throw new Error(`${key}=${raw} ist keine Reglerstellung. Möglich: ${allowed.join(", ")}`);
    return hit;
  };

  const range = (key: keyof typeof ROOM_SETTING_RANGES, fallback: number): number => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const { min, max, step } = ROOM_SETTING_RANGES[key];
    const value = raw.trim() === "" ? NaN : Number(raw);
    const k = Math.round((value - min) / step);
    if (!Number.isFinite(value) || k < 0 || min + k * step > max + 1e-9 || Math.abs(min + k * step - value) > 1e-9) {
      throw new Error(`${key}=${raw} liegt nicht auf dem Regler: ${min} bis ${max}, Schritt ${step}`);
    }
    // Aus der Stellung neu gebildet, auf die Nachkommastellen des Schritts:
    // 0.05 + 2·0.05 ergäbe 0.15000000000000002, der Browser liest 0.15.
    const decimals = (String(step).split(".")[1] ?? "").length;
    return Number((min + k * step).toFixed(decimals));
  };

  const flag = (key: string, fallback: boolean): boolean => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (raw !== "0" && raw !== "1") throw new Error(`${key}=${raw}: erwartet 0 oder 1`);
    return raw === "1";
  };

  const d = DEFAULT_ROOM_SETTINGS;
  return {
    azimuth: choice("azimuth", d.azimuth),
    massClass: choice("massClass", d.massClass),
    skyModel: choice("skyModel", d.skyModel),
    windowFraction: range("windowFraction", Math.round(d.windowFraction * 100)) / 100,
    shading: range("shading", d.shading),
    overhang: range("overhang", d.overhang),
    obstruction: range("obstruction", d.obstruction),
    gains: range("gains", d.gains),
    nightVent: range("nightVent", d.nightVent),
    nightVentOn: flag("nightVentOn", d.nightVentOn),
  };
}

/**
 * Mindestvollständigkeit von Temperatur und Globalstrahlung, damit ein Messjahr
 * in einen Vergleich über Jahre eingeht. Seit simulate5R1C 1.4.0 rechnet ein
 * Jahr mit Strahlungslücken weniger Stunden und läge im Vergleich zu tief.
 */
export const MIN_YEAR_COMPLETENESS = 0.95;

export function isCompleteMeasuredYear(completeness: Readonly<Record<string, number>> | undefined): boolean {
  return (completeness?.tre200h0 ?? 0) >= MIN_YEAR_COMPLETENESS
    && (completeness?.gre000h0 ?? 0) >= MIN_YEAR_COMPLETENESS;
}

// --- Klimastand ---------------------------------------------------------------

const MEASURED_KEY = /^y(\d{4})$/;
const SCENARIO_KEY = /^s(\d{4})_RCP(\d)(\d)_(dry|warmsummer)$/;

/**
 * Ein Klimastand im Permalink: "y2024" gemessen, "s2060_RCP85_dry" Szenario.
 * Das Präfix lässt beide Quellen in einem Auswahlfeld nebeneinander stehen.
 */
export function isScenarioKey(key: string): boolean {
  if (MEASURED_KEY.test(key)) return false;
  if (SCENARIO_KEY.test(key)) return true;
  throw new Error(`Klimastand "${key}" unbekannt. Erwartet y2024 oder s2060_RCP85_dry`);
}

/** "s2060_RCP85_dry" → "Szenario 2060 · RCP 8.5 · Referenzjahr". */
export function climateLabel(key: string): string {
  if (!isScenarioKey(key)) return `gemessen ${key.slice(1)}`;
  const [, period, a, b, kind] = SCENARIO_KEY.exec(key)!;
  const type = kind === "dry" ? "Referenzjahr" : "warmer Sommer (1 in 10)";
  return `Szenario ${period} · RCP ${a}.${b} · ${type}`;
}

/** Kurzform für Legende und Kacheln, wo die volle Bezeichnung nicht hinpasst. */
export function climateShortLabel(key: string): string {
  if (!isScenarioKey(key)) return `gemessen ${key.slice(1)}`;
  const [, period, a, b, kind] = SCENARIO_KEY.exec(key)!;
  return `${period} RCP ${a}.${b}${kind === "dry" ? "" : ", warmer Sommer"}`;
}

// --- Rechnen ------------------------------------------------------------------

/** Das Komfortband hängt nur am Klima; das Frontend rechnet es je Klimastand einmal. */
export function referenceComfortBand(series: StationSeries): Computation<ComfortBand> {
  const outdoor = getVariable(series, "tre200h0");
  const runningMean = runningMeanOutdoorTemperature(dailyMean(outdoor, series.axis), [series.source]);
  return adaptiveComfortBand(runningMean, { category: REFERENCE_EVALUATION.category });
}

/**
 * Ein Klimastand, der Referenzraum, eine Auswertung.
 *
 * Gemessene Diffus- und Langwellenstrahlung werden verwendet, wo die Station sie
 * führt; sonst greifen Erbs und der Pauschalwert der Norm.
 */
export function evaluateReferenceCase(
  series: StationSeries,
  location: { lat: number; lon: number },
  settings: RoomSettings,
  band: Computation<ComfortBand> = referenceComfortBand(series),
): { simulation: Computation<SimulationResult>; exceedance: Computation<ExceedanceResult> } {
  const simulation = simulate5R1C(referenceRoom(settings), {
    outdoorTemperature: getVariable(series, "tre200h0"),
    globalHorizontal: getVariable(series, "gre000h0"),
    diffuseHorizontal: series.variables.has("ods000h0") ? getVariable(series, "ods000h0") : undefined,
    downwellingLongwave: series.variables.has("oli000h0") ? getVariable(series, "oli000h0") : undefined,
    axis: series.axis,
    latitude: location.lat,
    longitude: location.lon,
  }, [series.source]);

  const exceedance = exceedanceHours(simulation, band, series.axis, {
    occupiedFromHour: REFERENCE_EVALUATION.occupiedFromHour,
    occupiedToHour: REFERENCE_EVALUATION.occupiedToHour,
  });
  return { simulation, exceedance };
}

/**
 * Höchste operative Temperatur nach der Einschwingphase.
 *
 * Eine nackte Zahl ohne eigenen Hash: Sie folgt vollständig aus der Simulation
 * und steht im Export unter deren Rolle.
 */
export function peakOperativeTemperature(exceedance: Computation<ExceedanceResult>): number {
  const operative = upstreamOf<SimulationResult>(exceedance, "simulation").value.operativeTemperature;
  let peak = NaN;
  for (let i = Number(exceedance.params.warmupHours); i < operative.length; i++) {
    const v = operative[i];
    if (Number.isFinite(v) && !(v <= peak)) peak = v;
  }
  return peak;
}

/**
 * Prüft, ob eine Simulation aus dieser Reglerstellung stammt.
 *
 * Der Export nimmt Einstellungen und Berechnung getrennt entgegen; das Manifest
 * zeigte sonst Einstellungen, die zu einer anderen Rechnung gehören.
 */
export function assertSettingsMatch(settings: RoomSettings, simulation: Computation<SimulationResult>): void {
  const room = referenceRoom(settings);
  const expected: Record<string, unknown> = {
    massClass: room.massClass,
    internalGains: room.internalGains,
    skyModel: room.skyModel,
    opaqueArea: room.opaqueArea,
    windows: JSON.stringify(room.windows),
    nightVentilation: room.nightVentilation ? JSON.stringify(room.nightVentilation) : "aus",
    occupancy: JSON.stringify(room.occupancy),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (simulation.params[key] !== value) {
      throw new Error(`Einstellungen passen nicht zur Simulation: ${key} ist ${simulation.params[key]}, erwartet ${value}`);
    }
  }
}
