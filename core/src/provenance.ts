/**
 * Reproduzierbarkeit als Datenstruktur.
 *
 * Grundsatz: Jeder publizierte Zahlenwert trägt mit sich, wie er entstanden ist.
 * Nicht als nachträglich geschriebene Erklärseite, sondern als Rückgabewert der
 * Funktion, die ihn berechnet hat. Eine Grafik ohne Provenance kann es damit
 * gar nicht geben — der Typ erlaubt sie nicht.
 */

/** Verweis auf ein dokumentiertes Rechenverfahren. */
export interface MethodRef {
  /** Stabiler Bezeichner, z. B. "psychro.wetBulb". */
  id: string;
  /**
   * Semver des Verfahrens. Erhöht sich, sobald sich das Ergebnis für gleiche
   * Eingaben ändert — auch bei einer Fehlerkorrektur. Publizierte Werte bleiben
   * dadurch zuordenbar.
   */
  version: string;
  /** Pfad auf die Herleitung in docs/methods/. */
  doc: string;
  /** Zitierschlüssel, aufgelöst in docs/methods/sources.md. */
  sources: string[];
}

/** Verweis auf einen konkreten, unveränderlichen Eingangsdatensatz. */
export interface DatasetRef {
  /** STAC-Collection, z. B. "ch.meteoschweiz.ogd-smn". */
  collection: string;
  /** Stationskürzel nach MeteoSchweiz, z. B. "SMA". */
  station: string;
  year: number;
  variables: string[];
  /** SHA-256 der gepackten Binärdatei. Macht den Datenstand fälschungssicher. */
  sha256: string;
  /** SPDX-Kennung oder Bezeichnung der Nutzungsbedingung. */
  license: string;
  /** Urheber des Datensatzes. */
  attribution: string;
  /** Titel des Datensatzes. Teil der geforderten Quellenangabe. */
  title?: string;
  /** Link auf den Datensatz. Teil der geforderten Quellenangabe. */
  url?: string;
}

export type ParamValue = number | string | boolean;

/** Ein Ergebnis mitsamt seiner vollständigen Entstehungsgeschichte. */
export interface Computation<T> {
  value: T;
  unit: string;
  method: MethodRef;
  params: Record<string, ParamValue>;
  inputs: DatasetRef[];
  /**
   * Berechnungen, auf denen diese aufbaut, je mit ihrer Rolle. Ihre Identität
   * geht in den Hash ein: Eine Kennzahl aus einer Raumtemperatur trägt so die
   * Raumparameter mit, ohne sie selbst zu kennen. Fehlt das Feld, bleibt der
   * Hash, was er ohne Vorgänger immer war.
   */
  upstream?: Upstream[];
}

/** Eine vorgelagerte Berechnung und wofür sie steht, z. B. "simulation". */
export interface Upstream {
  role: string;
  computation: Computation<unknown>;
}

/**
 * Deterministische JSON-Serialisierung: Objektschlüssel werden rekursiv
 * sortiert, damit derselbe Sachverhalt immer dieselbe Zeichenkette ergibt.
 * Ohne das wäre der Hash von der Einfügereihenfolge abhängig.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Der kanonische Zustand einer Berechnung: Verfahren + Version + Parameter +
 * Prüfsummen der Eingangsdaten. Genau das, was reproduziert werden muss —
 * und bewusst nicht mehr. Der Ergebniswert selbst geht nicht ein, sonst wäre
 * der Hash nicht mehr prüfbar.
 */
export function canonicalForm<T>(c: Computation<T>): string {
  return stableStringify(canonicalObject(c));
}

/**
 * Vorgänger stehen verschachtelt in voller kanonischer Form, nicht als Hash.
 * So bleibt canonicalForm() synchron, und der Hash einer Kette ist trotzdem
 * eindeutig. Ohne Vorgänger ist `upstream` undefined und fällt in
 * stableStringify() weg: Die Zeichenkette ist dann byte-gleich zu der vor
 * Verkettete Hashes. Ein Test hält das an einem festen Hash fest.
 */
function canonicalObject<T>(c: Computation<T>): unknown {
  return {
    method: { id: c.method.id, version: c.method.version },
    params: c.params,
    inputs: c.inputs
      .map((i) => ({ collection: i.collection, station: i.station, year: i.year, sha256: i.sha256 }))
      .sort((a, b) => (canonicalKey(a) < canonicalKey(b) ? -1 : 1)),
    upstream: c.upstream?.length
      ? [...c.upstream]
          .sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0))
          .map((u) => ({ role: u.role, computation: canonicalObject(u.computation) }))
      : undefined,
  };
}

function canonicalKey(i: { collection: string; station: string; year: number }): string {
  return `${i.collection}/${i.station}/${i.year}`;
}

/**
 * Eingangsdatensätze mehrerer Berechnungen, dedupliziert über den Datenstand.
 *
 * Eine abgeleitete Berechnung führt die Datensätze ihrer Vorgänger selbst mit.
 * So funktionieren citations() und die Anzeige der Eingangsdaten, ohne die
 * Kette ablaufen zu müssen.
 */
export function mergeInputs(...lists: DatasetRef[][]): DatasetRef[] {
  const seen = new Map<string, DatasetRef>();
  for (const list of lists) {
    for (const i of list) {
      const key = `${canonicalKey(i)}/${i.sha256}`;
      if (!seen.has(key)) seen.set(key, i);
    }
  }
  return [...seen.values()];
}

/** Die vorgelagerte Berechnung einer Rolle; wirft, wenn sie fehlt. */
export function upstreamOf<T>(c: Computation<unknown>, role: string): Computation<T> {
  const found = c.upstream?.find((u) => u.role === role);
  if (!found) throw new Error(`${c.method.id} hat keine vorgelagerte Berechnung "${role}"`);
  return found.computation as Computation<T>;
}

/**
 * Permalink-Identität einer Grafik. Gleiche Eingaben, gleiches Verfahren,
 * gleiche Parameter ergeben denselben Hash — auf jeder Maschine, zu jeder Zeit.
 * Läuft über die WebCrypto-API und damit in Browser und Node identisch.
 */
export async function computationHash<T>(c: Computation<T>): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalForm(c));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Kurzform für die Anzeige neben einer Grafik. */
export async function shortHash<T>(c: Computation<T>): Promise<string> {
  return (await computationHash(c)).slice(0, 12);
}

/** Sammelt die Quellenangaben aller Eingangsdatensätze, dedupliziert. */
export function attributions<T>(c: Computation<T>): string[] {
  return [...new Set(c.inputs.map((i) => i.attribution))].sort();
}

/**
 * Vollständige Quellenangabe, wie CC BY 4.0 und die opendata.swiss-Stufe
 * `terms_by` sie verlangen: **Autor, Titel, Link und Lizenz**.
 *
 * Ein blosser Name genügt beiden nicht. Siehe
 * docs/methods/sources.md#was-eine-vollständige-quellenangabe-enthalten-muss
 */
export function citations<T>(c: Computation<T>): string[] {
  const seen = new Map<string, string>();
  for (const i of c.inputs) {
    const parts = [i.attribution];
    if (i.title) parts.push(i.title);
    if (i.url) parts.push(i.url);
    parts.push(i.license);
    const text = parts.join(" · ");
    seen.set(text, text);
  }
  return [...seen.values()].sort();
}
