/**
 * Stündliche Zeitreihen und — wichtiger — die Zeitkonventionen dahinter.
 *
 * Die stillen Fehler in solchen Pipelines sitzen fast nie in der Physik,
 * sondern hier. Deshalb ist die Konvention ein explizites Feld und kein
 * implizites Wissen im Kopf der Entwicklerin.
 */

import type { DatasetRef } from "./provenance.ts";

/**
 * Wofür steht ein Zeitstempel?
 *
 * MeteoSchweiz liefert Stundenwerte mit `reference_timestamp` in **UTC**, und
 * der Stempel bezeichnet das **Ende** des Aggregationsintervalls: "01:00" ist
 * das Mittel über 00:00–01:00. Wer das übersieht, verschiebt bei
 * Strahlungsgrössen den Sonnenstand um eine halbe Stunde.
 *
 * Zu prüfen in den Collection-Metadaten, bevor produktiv gerechnet wird —
 * siehe docs/methods/000-time-conventions.md.
 */
export type IntervalLabel = "start" | "end";

export interface TimeAxis {
  /** Erster Zeitstempel als Unix-Millisekunden UTC. */
  startUtcMs: number;
  /** Schrittweite in Millisekunden. Für Stundenwerte 3_600_000. */
  stepMs: number;
  length: number;
  label: IntervalLabel;
  /**
   * Fester Offset zur lokalen Zeit in Minuten, für tages- und nachtbezogene
   * Kennwerte. Standard 60 = MEZ ohne Sommerzeit. Bewusst *ohne* Sommerzeit:
   * ein DST-Sprung erzeugt sonst eine 23- und eine 25-Stunden-Nacht und damit
   * Artefakte in der Statistik.
   */
  localOffsetMin: number;
  /**
   * Repräsentativer Zeitpunkt innerhalb des Intervalls, in Minuten relativ
   * zum Zeitstempel. Ohne Angabe gilt die Intervallmitte, abgeleitet aus
   * `label`.
   *
   * Nötig, weil nicht jede Quelle die Mitte meint: Für die DRY-Datensätze der
   * Klimaszenarien liegt der repräsentative Zeitpunkt empirisch bei +10 min,
   * nicht bei +30 — siehe docs/methods/009-klimaszenarien.md.
   */
  sampleOffsetMin?: number;
}

export function hourlyAxis(
  startUtcMs: number,
  length: number,
  opts: Partial<Pick<TimeAxis, "label" | "localOffsetMin" | "sampleOffsetMin">> = {},
): TimeAxis {
  const axis: TimeAxis = {
    startUtcMs,
    stepMs: 3_600_000,
    length,
    label: opts.label ?? "end",
    localOffsetMin: opts.localOffsetMin ?? 60,
  };
  if (opts.sampleOffsetMin !== undefined) axis.sampleOffsetMin = opts.sampleOffsetMin;
  return axis;
}

/**
 * Der Zeitpunkt, der ein Intervall für Sonnenstandsrechnungen vertritt.
 *
 * Standardmässig die Intervallmitte. Führt die Achse einen ausdrücklichen
 * `sampleOffsetMin`, gilt dieser — manche Quellen meinen nicht die Mitte.
 */
export function intervalMidpointUtcMs(axis: TimeAxis, index: number): number {
  const stamp = axis.startUtcMs + index * axis.stepMs;
  if (axis.sampleOffsetMin !== undefined) return stamp + axis.sampleOffsetMin * 60_000;
  return axis.label === "end" ? stamp - axis.stepMs / 2 : stamp + axis.stepMs / 2;
}

/** Lokale Stunde (0–23) des Intervalls, für Nacht- und Tagfenster. */
export function localHour(axis: TimeAxis, index: number): number {
  const local = intervalMidpointUtcMs(axis, index) + axis.localOffsetMin * 60_000;
  return Math.floor(local / 3_600_000) % 24;
}

/** Fortlaufender lokaler Kalendertag, Tag 0 = Tag des ersten Werts. */
export function localDayIndex(axis: TimeAxis, index: number): number {
  const local = intervalMidpointUtcMs(axis, index) + axis.localOffsetMin * 60_000;
  const localStart = intervalMidpointUtcMs(axis, 0) + axis.localOffsetMin * 60_000;
  return Math.floor(local / 86_400_000) - Math.floor(localStart / 86_400_000);
}

/**
 * Lokaler Wochentag: 0 = Sonntag, 1 = Montag … 6 = Samstag.
 * Für Belegungsprofile, die am Wochenende aussetzen.
 */
export function localWeekday(axis: TimeAxis, index: number): number {
  const local = intervalMidpointUtcMs(axis, index) + axis.localOffsetMin * 60_000;
  return new Date(local).getUTCDay();
}

/**
 * Eine Variable als Stundenreihe. Fehlwerte sind NaN — nicht -999, nicht null.
 * Damit propagieren sie in jeder Rechnung sichtbar, statt sich als plausible
 * Zahl zu tarnen.
 */
export interface Variable {
  /** MeteoSchweiz-Parameterkürzel, z. B. "tre200h0". */
  code: string;
  unit: string;
  values: Float64Array;
}

export interface StationSeries {
  station: string;
  /** Stationshöhe in m ü. M., für die Druckkorrektur. */
  altitudeM: number;
  axis: TimeAxis;
  variables: Map<string, Variable>;
  source: DatasetRef;
}

export function getVariable(series: StationSeries, code: string): Float64Array {
  const v = series.variables.get(code);
  if (!v) {
    const have = [...series.variables.keys()].sort().join(", ");
    throw new Error(`Variable "${code}" fehlt in Station ${series.station}. Vorhanden: ${have || "(keine)"}`);
  }
  return v.values;
}

/** Anteil gültiger Werte, 0…1. Gehört in jede publizierte Kennzahl. */
export function completeness(values: Float64Array): number {
  if (values.length === 0) return 0;
  let ok = 0;
  for (const v of values) if (Number.isFinite(v)) ok++;
  return ok / values.length;
}
