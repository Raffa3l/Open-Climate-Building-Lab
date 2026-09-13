/**
 * Download: die Stundenreihe als CSV und ihr Nachweis als JSON.
 *
 * Im Kern und nicht im Frontend, aus demselben Grund wie alles andere hier:
 * Browser und CLI sollen byte-gleiche Dateien erzeugen. Zwei Serialisierer
 * driften auseinander, und eine Datei, deren Prüfsumme vom Werkzeug abhängt,
 * ist keine prüfbare Datei.
 *
 * Das Format ist in docs/methods/010-export.md beschrieben.
 */

import type { Computation, DatasetRef, MethodRef, ParamValue } from "./provenance.ts";
import { canonicalForm, citations, computationHash, upstreamOf } from "./provenance.ts";
import type { TimeAxis } from "./series.ts";
import { intervalMidpointUtcMs, localDayIndex, localHour } from "./series.ts";
import type { SimulationResult } from "./building.ts";
import type { ComfortBand, ExceedanceResult } from "./indicators.ts";

/** Erhöhen, sobald sich Spalten, Einheiten oder Schreibweise ändern. */
export const EXPORT_FORMAT_VERSION = 1;

export interface ColumnSpec {
  name: string;
  unit: string;
  description: string;
}

/**
 * Spaltennamen in ASCII: Excel öffnet eine CSV ohne BOM als Windows-1252, und
 * ein «θ» im Kopf käme dort als Zeichensalat an. Die Bedeutung steht im Manifest.
 */
export const HOURLY_COLUMNS: readonly ColumnSpec[] = [
  { name: "zeitstempel_utc", unit: "ISO 8601", description: "Zeitstempel der Quelle in UTC; ob er Intervallbeginn oder -ende meint, steht in timeAxis.label" },
  { name: "lokal_tag", unit: "JJJJ-MM-TT", description: "Lokaler Kalendertag des Stichzeitpunkts, fester Offset timeAxis.localOffsetMin, ohne Sommerzeit" },
  { name: "lokal_stunde", unit: "0-23", description: "Lokale Stunde des Stichzeitpunkts, dieselbe Zuordnung wie in exceedanceHours()" },
  { name: "einschwingphase", unit: "0/1", description: "1 = Stunde liegt in der verworfenen Einschwingphase des Raummodells" },
  { name: "theta_e_C", unit: "°C", description: "Aussenlufttemperatur, Eingangsdaten" },
  { name: "theta_op_C", unit: "°C", description: "Operative Raumtemperatur, ungefiltert auch in der Einschwingphase" },
  { name: "theta_air_C", unit: "°C", description: "Raumlufttemperatur" },
  { name: "theta_m_C", unit: "°C", description: "Temperatur des Massenknotens" },
  { name: "phi_sol_W", unit: "W", description: "Solare Wärmeeinträge nach Abzug der Himmelsabstrahlung" },
  { name: "phi_r_W", unit: "W", description: "Wirksamer Verlust durch Abstrahlung gegen den Himmel" },
  { name: "grenze_C", unit: "°C", description: "Adaptive Obergrenze des lokalen Tages, leer wo das Komfortband undefiniert ist" },
  { name: "bewertet", unit: "0/1", description: "1 = Stunde geht in die Übertemperaturstunden ein: im Belegungsfenster, nach der Einschwingphase, Grenze definiert" },
  { name: "ueber_grenze_K", unit: "K", description: "Überschreitung der Grenze; 0 bei bewerteter Stunde ohne Überschreitung, leer bei nicht bewerteter" },
];

export interface HourlyExportInput {
  axis: TimeAxis;
  outdoorTemperature: ArrayLike<number>;
  /**
   * Alles Weitere kommt aus dieser Berechnung: Simulation und Komfortband aus
   * ihren Vorgängern, Belegungsfenster und Einschwingphase aus ihren params.
   * Getrennt übergeben, könnten die Teile zu verschiedenen Rechnungen gehören.
   */
  exceedance: Computation<ExceedanceResult>;
}

const DELIMITER = ";";
const LINE_END = "\r\n";

/**
 * Zahl mit fester Nachkommazahl; leer für Fehlwerte.
 *
 * Leer statt "NaN": Excel liest "NaN" als Text und rechnet damit nicht, pandas
 * liest die leere Zelle ohnehin als NaN. «-0.00» wird zu «0.00», sonst
 * unterschieden sich zwei inhaltlich gleiche Dateien in der Prüfsumme.
 */
function formatNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "";
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

/**
 * Die Stundenreihe als CSV.
 *
 * Semikolon als Trenner und Punkt als Dezimalzeichen: So öffnet ein Schweizer
 * Excel die Datei per Doppelklick richtig, und `pandas.read_csv(sep=";")` liest
 * sie ohne weitere Angaben. Keine Kommentarzeilen, damit jedes Werkzeug die
 * erste Zeile als Kopf erkennt; alles Weitere steht im Manifest.
 */
export function hourlyCsv(input: HourlyExportInput): string {
  const { axis, outdoorTemperature, exceedance } = input;
  const simulation = upstreamOf<SimulationResult>(exceedance, "simulation").value;
  const dailyUpperLimit = upstreamOf<ComfortBand>(exceedance, "comfortBand").value.upper;
  const warmupHours = Number(exceedance.params.warmupHours ?? 0);
  const from = Number(exceedance.params.occupiedFromHour ?? 0);
  const to = Number(exceedance.params.occupiedToHour ?? 24);

  const lines: string[] = [HOURLY_COLUMNS.map((c) => c.name).join(DELIMITER)];

  for (let i = 0; i < axis.length; i++) {
    const stamp = new Date(axis.startUtcMs + i * axis.stepMs).toISOString();
    const localMs = intervalMidpointUtcMs(axis, i) + axis.localOffsetMin * 60_000;
    const hour = localHour(axis, i);
    const limit = dailyUpperLimit[localDayIndex(axis, i)] ?? NaN;
    const inWarmup = i < warmupHours;
    const operative = simulation.operativeTemperature[i];

    // Dieselbe Auswahl wie exceedanceHours(): Fenster, gültige Grenze, gültige
    // bewertete Temperatur. Ein Test stellt sicher, dass die Zeilen auf die
    // Kennzahl summieren; weicht diese Regel ab, fällt er.
    const evaluated =
      hour >= from && hour < to && Number.isFinite(limit) && !inWarmup && Number.isFinite(operative);
    const over = evaluated ? Math.max(0, operative - limit) : NaN;

    lines.push([
      `${stamp.slice(0, 16)}Z`,
      new Date(localMs).toISOString().slice(0, 10),
      String(hour),
      inWarmup ? "1" : "0",
      formatNumber(outdoorTemperature[i], 2),
      formatNumber(operative, 2),
      formatNumber(simulation.airTemperature[i], 2),
      formatNumber(simulation.massTemperature[i], 2),
      formatNumber(simulation.solarGains[i], 1),
      formatNumber(simulation.skyLoss[i], 1),
      formatNumber(limit, 2),
      evaluated ? "1" : "0",
      formatNumber(over, 3),
    ].join(DELIMITER));
  }

  return lines.join(LINE_END) + LINE_END;
}

/** SHA-256 als Hex, über die WebCrypto-API, in Browser und Node identisch. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ManifestComputation {
  /** Wofür die Berechnung im Export steht, z. B. "simulation". */
  role: string;
  hash: string;
  /** Genau die Zeichenkette, deren SHA-256 `hash` ergibt. */
  canonicalForm: string;
  method: MethodRef;
  params: Record<string, ParamValue>;
  inputs: DatasetRef[];
  /** Nur skalare Ergebnisse; Reihen stehen in der CSV. */
  value?: Record<string, number | string>;
}

export interface ExportManifest {
  format: "ocbl-export";
  formatVersion: number;
  file: {
    name: string;
    sha256: string;
    delimiter: string;
    decimalSeparator: string;
    missingValue: string;
    lineEnding: "CRLF";
    columns: readonly ColumnSpec[];
  };
  subject: Record<string, number | string | boolean>;
  timeAxis: TimeAxis;
  warmupHours: number;
  computations: ManifestComputation[];
  citations: string[];
  verification: string;
}

export interface ManifestInput {
  csv: string;
  csvFileName: string;
  subject: Record<string, number | string | boolean>;
  axis: TimeAxis;
  warmupHours: number;
  computations: Array<{
    role: string;
    computation: Computation<unknown>;
    value?: Record<string, number | string>;
  }>;
}

/**
 * Der Nachweis zur CSV.
 *
 * Bewusst ohne Erstellungszeitpunkt: Zwei Exporte desselben Sachverhalts sollen
 * dieselbe Datei ergeben. Ein Zeitstempel machte jede Datei einzigartig und
 * damit jeden Vergleich zweier Downloads wertlos.
 */
export async function exportManifest(input: ManifestInput): Promise<ExportManifest> {
  const computations: ManifestComputation[] = [];
  const allCitations = new Set<string>();

  for (const { role, computation, value } of input.computations) {
    const entry: ManifestComputation = {
      role,
      hash: await computationHash(computation),
      canonicalForm: canonicalForm(computation),
      method: computation.method,
      params: computation.params,
      inputs: computation.inputs,
    };
    if (value) entry.value = value;
    computations.push(entry);
    for (const c of citations(computation)) allCitations.add(c);
  }

  return {
    format: "ocbl-export",
    formatVersion: EXPORT_FORMAT_VERSION,
    file: {
      name: input.csvFileName,
      sha256: await sha256Hex(input.csv),
      delimiter: DELIMITER,
      decimalSeparator: ".",
      missingValue: "",
      lineEnding: "CRLF",
      columns: HOURLY_COLUMNS,
    },
    subject: input.subject,
    timeAxis: input.axis,
    warmupHours: input.warmupHours,
    computations,
    citations: [...allCitations].sort(),
    verification:
      "SHA-256 über canonicalForm (UTF-8) ergibt hash. SHA-256 über die CSV-Datei ergibt file.sha256. " +
      "Die Zeilen mit ueber_grenze_K > 0 summieren auf value.hours der Berechnung exceedance.",
  };
}
