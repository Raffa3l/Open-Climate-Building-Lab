/**
 * Das .ocbl-Binärformat — Leseseite.
 *
 * Warum ein eigenes Format statt CSV oder Parquet: Ein Stationsjahr sind
 * 8760 Stunden × rund zehn Variablen. Als skalierte Int16 sind das etwa
 * 175 kB — klein genug, dass der Browser genau das Jahr lädt, das er
 * anzeigt, ohne Datenbank, ohne Query-Layer, ohne Serverlogik. Genau ein
 * HTTP-Range-fähiger statischer File-Download.
 *
 * Die Schreibseite liegt in data/ocbl_data/pack.py. Beide Seiten teilen sich
 * die Formatbeschreibung in docs/methods/004-binary-format.md; Änderungen
 * erhöhen FORMAT_VERSION und damit die Prüfsumme aller abgeleiteten Werte.
 */

import type { DatasetRef } from "./provenance.ts";
import { hourlyAxis, type IntervalLabel, type StationSeries, type Variable } from "./series.ts";

export const MAGIC = "OCBL";
export const FORMAT_VERSION = 1;

/** Sentinel für Fehlwerte. Kleinster darstellbarer Int16, nie ein echter Messwert. */
export const MISSING_I16 = -32768;

export interface PackedVariable {
  code: string;
  unit: string;
  /** physikalischer Wert = raw · scale + offset */
  scale: number;
  offset: number;
}

export interface PackHeader {
  station: string;
  altitudeM: number;
  startUtcMs: number;
  stepMs: number;
  length: number;
  label: IntervalLabel;
  localOffsetMin: number;
  /** Optional: repräsentativer Zeitpunkt im Intervall, Minuten zum Stempel. */
  sampleOffsetMin?: number;
  variables: PackedVariable[];
  source: Omit<DatasetRef, "sha256">;
}

/**
 * Liest einen .ocbl-Puffer.
 *
 * `sha256` wird von aussen hereingereicht statt im File zu stehen — eine
 * Prüfsumme, die sich selbst enthält, kann nicht stimmen. Der Wert stammt aus
 * dem Katalog (data/build/catalog.json) und ist damit unabhängig prüfbar.
 */
export function readPacked(buffer: ArrayBuffer, sha256: string): StationSeries {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== MAGIC) throw new Error(`Kein .ocbl-File: Magic "${magic}" statt "${MAGIC}"`);

  const version = view.getUint8(4);
  if (version !== FORMAT_VERSION) {
    throw new Error(`Formatversion ${version} wird nicht unterstützt (erwartet ${FORMAT_VERSION})`);
  }

  const headerLen = view.getUint32(8, true);
  const headerBytes = new Uint8Array(buffer, 12, headerLen);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as PackHeader;

  const payloadOffset = 12 + headerLen;
  const expected = header.variables.length * header.length * 2;
  const actual = buffer.byteLength - payloadOffset;
  if (actual !== expected) {
    throw new Error(`Nutzdatenlänge ${actual} B, erwartet ${expected} B — Datei ist unvollständig oder beschädigt`);
  }

  const variables = new Map<string, Variable>();
  for (let v = 0; v < header.variables.length; v++) {
    const spec = header.variables[v];
    const values = new Float64Array(header.length);
    let p = payloadOffset + v * header.length * 2;
    for (let i = 0; i < header.length; i++, p += 2) {
      const raw = view.getInt16(p, true);
      values[i] = raw === MISSING_I16 ? NaN : raw * spec.scale + spec.offset;
    }
    variables.set(spec.code, { code: spec.code, unit: spec.unit, values });
  }

  const axis = hourlyAxis(header.startUtcMs, header.length, {
    label: header.label,
    localOffsetMin: header.localOffsetMin,
    ...(header.sampleOffsetMin !== undefined ? { sampleOffsetMin: header.sampleOffsetMin } : {}),
  });
  if (header.stepMs !== axis.stepMs) {
    throw new Error(`Nur Stundenwerte unterstützt, stepMs=${header.stepMs}`);
  }

  return {
    station: header.station,
    altitudeM: header.altitudeM,
    axis,
    variables,
    source: { ...header.source, sha256 },
  };
}

/** Lädt ein Stationsjahr und prüft dabei die Katalogprüfsumme. */
export async function fetchPacked(url: string, sha256: string): Promise<StationSeries> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} beim Laden von ${url}`);
  const buffer = await res.arrayBuffer();

  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const actual = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (actual !== sha256) {
    throw new Error(`Prüfsumme von ${url} weicht ab: ${actual} statt ${sha256}`);
  }

  return readPacked(buffer, sha256);
}
