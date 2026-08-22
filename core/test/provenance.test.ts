import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributions,
  canonicalForm,
  computationHash,
  shortHash,
  stableStringify,
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
