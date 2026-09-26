import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributions,
  citations,
  canonicalForm,
  computationHash,
  mergeInputs,
  shortHash,
  stableStringify,
  upstreamOf,
  type Computation,
  type DatasetRef,
} from "../src/provenance.ts";

const ds = (station: string, sha: string): DatasetRef => ({
  collection: "ch.meteoschweiz.ogd-smn",
  station,
  year: 2023,
  variables: ["tre200h0"],
  sha256: sha,
  license: "CC-BY-4.0",
  attribution: "© MeteoSchweiz",
});

const base = (): Computation<number> => ({
  value: 42,
  unit: "Nächte",
  method: {
    id: "indicator.tropicalNights",
    version: "1.0.0",
    doc: "docs/methods/002-heat-indicators.md#tropennächte",
    sources: ["meteoschweiz-klimaindikatoren"],
  },
  params: { thresholdC: 20, nightStartHour: 18, nightEndHour: 6 },
  inputs: [ds("SMA", "a".repeat(64))],
});

test("stableStringify ist unabhängig von der Schlüsselreihenfolge", () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.equal(stableStringify({ x: { d: 1, c: [3, { f: 1, e: 2 }] } }), '{"x":{"c":[3,{"e":2,"f":1}],"d":1}}');
});

test("stableStringify erhält die Reihenfolge in Arrays", () => {
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
});

test("gleiche Berechnung ergibt denselben Hash", async () => {
  assert.equal(await computationHash(base()), await computationHash(base()));
});

test("der Ergebniswert geht bewusst nicht in den Hash ein", async () => {
  const a = base();
  const b = { ...base(), value: 999 };
  assert.equal(await computationHash(a), await computationHash(b));
});

test("ein geänderter Parameter ändert den Hash", async () => {
  const b = base();
  b.params = { ...b.params, thresholdC: 21 };
  assert.notEqual(await computationHash(base()), await computationHash(b));
});

test("eine geänderte Verfahrensversion ändert den Hash", async () => {
  const b = base();
  b.method = { ...b.method, version: "1.0.1" };
  assert.notEqual(await computationHash(base()), await computationHash(b));
});

test("ein geänderter Datenstand ändert den Hash", async () => {
  const b = base();
  b.inputs = [ds("SMA", "b".repeat(64))];
  assert.notEqual(await computationHash(base()), await computationHash(b));
});

test("die Reihenfolge der Eingangsdatensätze ist unerheblich", async () => {
  const a = base();
  a.inputs = [ds("SMA", "a".repeat(64)), ds("BER", "c".repeat(64))];
  const b = base();
  b.inputs = [ds("BER", "c".repeat(64)), ds("SMA", "a".repeat(64))];
  assert.equal(await computationHash(a), await computationHash(b));
});

test("die Doku-Referenz ist nicht Teil der Identität", async () => {
  // Ein Tippfehler in der Wegangabe darf publizierte Permalinks nicht brechen.
  const b = base();
  b.method = { ...b.method, doc: "docs/methods/andere-datei.md" };
  assert.equal(await computationHash(base()), await computationHash(b));
});

test("Kanonische Form enthält genau die identitätsstiftenden Felder", () => {
  const c = canonicalForm(base());
  assert.match(c, /"id":"indicator.tropicalNights"/);
  assert.match(c, /"thresholdC":20/);
  assert.match(c, /"sha256":"a{64}"/);
  assert.doesNotMatch(c, /"value"/);
  assert.doesNotMatch(c, /"attribution"/);
});

test("Kurzhash ist die zwölfstellige Vorsilbe", async () => {
  const c = base();
  assert.equal(await shortHash(c), (await computationHash(c)).slice(0, 12));
});

test("Quellenangaben werden dedupliziert und sortiert", () => {
  const c = base();
  c.inputs = [ds("SMA", "a".repeat(64)), ds("BER", "b".repeat(64))];
  assert.deepEqual(attributions(c), ["© MeteoSchweiz"]);
});

test("vollständige Quellenangabe nennt Autor, Titel, Link und Lizenz", () => {
  const c = base();
  c.inputs = [{
    ...ds("SMA", "a".repeat(64)),
    title: "Automatische Wetterstationen - Messwerte (SwissMetNet)",
    url: "https://opendata.swiss/de/dataset/automatische-wetterstationen-messwerte",
  }];
  const [text] = citations(c);
  assert.match(text, /MeteoSchweiz/);
  assert.match(text, /SwissMetNet/);
  assert.match(text, /opendata\.swiss/);
  assert.match(text, /CC-BY-4\.0/);
});

test("fehlende Titel- und Linkangabe bricht die Zitation nicht", () => {
  // Ältere Datenstände tragen die Felder noch nicht.
  const [text] = citations(base());
  assert.equal(text, "© MeteoSchweiz · CC-BY-4.0");
});

test("Titel und Link ändern den Berechnungs-Hash nicht", async () => {
  // Sie gehören zur Quellenangabe, nicht zur Identität der Rechnung — eine
  // nachgetragene Angabe darf publizierte Permalinks nicht brechen.
  const withMeta = base();
  withMeta.inputs = [{ ...ds("SMA", "a".repeat(64)), title: "T", url: "U" }];
  assert.equal(await computationHash(base()), await computationHash(withMeta));
});

test("Berechnung ohne Vorgänger behält den Hash von vor den verketteten Hashes", async () => {
  // Fester Anker, vor der Einführung von `upstream` mit dem damaligen Code
  // gerechnet. Bricht er, sind alle bestehenden Permalinks gebrochen.
  const c: Computation<number> = {
    value: 1,
    unit: "h",
    method: { id: "anchor.test", version: "1.0.0", doc: "x", sources: [] },
    params: { category: "II", occupiedFromHour: 7 },
    inputs: [{
      collection: "test", station: "TST", year: 2021, variables: ["tre200h0"],
      sha256: "0".repeat(64), license: "CC-BY-4.0", attribution: "Testdaten",
    }],
  };
  assert.equal(await computationHash(c), "a34dbce68a33dd906a02f476b80295bd91131e35678bcfbd64c6efd323467326");
  assert.equal(await computationHash({ ...c, upstream: [] }), await computationHash(c), "eine leere Liste zählt wie keine");
});

const derived = (upstream: Computation<unknown>): Computation<number> => ({
  ...base(),
  method: { ...base().method, id: "derived.test" },
  upstream: [{ role: "quelle", computation: upstream }],
});

test("ein geänderter Vorgänger ändert den Hash der abgeleiteten Berechnung", async () => {
  const changed = base();
  changed.params = { ...changed.params, thresholdC: 21 };
  assert.notEqual(await computationHash(derived(base())), await computationHash(derived(changed)));
});

test("der Ergebniswert eines Vorgängers geht nicht in den Hash ein", async () => {
  assert.equal(await computationHash(derived(base())), await computationHash(derived({ ...base(), value: 7 })));
});

test("die Reihenfolge der Vorgänger ist unerheblich", async () => {
  const other: Computation<number> = { ...base(), params: { thresholdC: 25 } };
  const a: Computation<number> = { ...base(), upstream: [{ role: "a", computation: base() }, { role: "b", computation: other }] };
  const b: Computation<number> = { ...base(), upstream: [{ role: "b", computation: other }, { role: "a", computation: base() }] };
  assert.equal(await computationHash(a), await computationHash(b));
});

test("Vorgänger stehen verschachtelt in der kanonischen Form", () => {
  const c = canonicalForm(derived(base()));
  assert.match(c, /"upstream":\[\{"computation":\{.*"id":"indicator.tropicalNights"/);
  assert.match(c, /"role":"quelle"/);
});

test("upstreamOf findet die Rolle und wirft bei einer fehlenden", () => {
  const c = derived(base());
  assert.equal(upstreamOf<number>(c, "quelle").method.id, "indicator.tropicalNights");
  assert.throws(() => upstreamOf(c, "gibtsnicht"), /keine vorgelagerte Berechnung "gibtsnicht"/);
});

test("mergeInputs dedupliziert über den Datenstand, nicht über die Objektidentität", () => {
  const merged = mergeInputs([ds("SMA", "a".repeat(64))], [ds("SMA", "a".repeat(64)), ds("BER", "b".repeat(64))]);
  assert.deepEqual(merged.map((i) => i.station), ["SMA", "BER"]);
});
