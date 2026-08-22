import { test } from "node:test";
import assert from "node:assert/strict";
import { hourlyAxis } from "../src/series.ts";
import { computationHash, type DatasetRef } from "../src/provenance.ts";
import {
  NO_SHADING,
  deriveRoom,
  simulate5R1C,
  warmupHours,
  type RoomSpec,
  type SimulationInput,
} from "../src/building.ts";

const ZH_LAT = 47.381003;
const ZH_LON = 8.567194;
const HOURS = 8760;
const axis = hourlyAxis(Date.UTC(2021, 0, 1), HOURS);

const SOURCE: DatasetRef = {
  collection: "test",
  station: "TST",
  year: 2021,
  variables: ["tre200h0", "gre000h0"],
  sha256: "0".repeat(64),
  license: "CC-BY-4.0",
  attribution: "Testdaten",
};

/** Büroraum, 20 m², eine Südfassade. Basis für alle Vergleiche. */
function referenceRoom(overrides: Partial<RoomSpec> = {}): RoomSpec {
  const facadeArea = 9.8;
  const windowFraction = 0.4;
  const windowArea = facadeArea * windowFraction;
  return {
    floorArea: 20,
    height: 2.8,
    opaqueArea: facadeArea - windowArea,
    opaqueUValue: 0.2,
    thermalBridges: 0.5,
    windows: [
      {
        area: windowArea,
        orientation: { tilt: 90, azimuth: 180 },
        uValue: 1.0,
        gValue: 0.5,
        frameFraction: 0.25,
        shading: NO_SHADING,
      },
    ],
    massClass: "mittel",
    airChangeRate: 0.7,
    internalGains: 8,
    ...overrides,
  };
}

function constant(value: number): Float64Array {
  return new Float64Array(HOURS).fill(value);
}

function input(outdoor: Float64Array, global: Float64Array): SimulationInput {
  return {
    outdoorTemperature: outdoor,
    globalHorizontal: global,
    axis,
    latitude: ZH_LAT,
    longitude: ZH_LON,
  };
}

/** Sinusförmiger Tages- und Jahresgang, deterministisch. */
function syntheticTemperature(mean: number, annualAmp: number, dailyAmp: number): Float64Array {
  const out = new Float64Array(HOURS);
  for (let i = 0; i < HOURS; i++) {
    const day = Math.floor(i / 24);
    const hour = i % 24;
    out[i] =
      mean -
      annualAmp * Math.cos((2 * Math.PI * (day - 15)) / 365) -
      dailyAmp * Math.cos((2 * Math.PI * (hour - 15)) / 24);
  }
  return out;
}

/** Klarer Himmel, grob: Globalstrahlung proportional zur Tageszeit. */
function syntheticGlobal(peak: number): Float64Array {
  const out = new Float64Array(HOURS);
  for (let i = 0; i < HOURS; i++) {
    const day = Math.floor(i / 24);
    const hour = i % 24;
    const seasonal = 0.45 + 0.55 * Math.sin((Math.PI * (day - 80)) / 365) ** 2;
    const daily = Math.max(0, Math.sin((Math.PI * (hour - 6)) / 12));
    out[i] = peak * seasonal * daily;
  }
  return out;
}

const mean = (a: Float64Array, from = 0) => {
  const v = [...a.slice(from)].filter(Number.isFinite);
  return v.reduce((x, y) => x + y, 0) / v.length;
};
const maxOf = (a: Float64Array, from = 0) => Math.max(...[...a.slice(from)].filter(Number.isFinite));

// ---------------------------------------------------------------------------

test("abgeleitete Kenngrössen entsprechen Tabelle 12 der Norm", () => {
  const d = deriveRoom(referenceRoom());
  assert.equal(d.effectiveMassArea, 2.5 * 20, "A_m = 2.5 · A_f bei mittlerer Bauart");
  assert.equal(d.effectiveCapacity, 165_000 * 20, "C_m = 165 kJ/(m²K) · A_f");
  assert.equal(d.totalInternalArea, 4.5 * 20, "A_t = 4.5 · A_f");
  assert.equal(d.airSurfaceConductance, 3.45 * 90);
  assert.equal(d.surfaceMassConductance, 9.1 * 50);
  assert.equal(d.volume, 56);

  const heavy = deriveRoom(referenceRoom({ massClass: "schwer" }));
  assert.equal(heavy.effectiveMassArea, 3.0 * 20);
  assert.equal(heavy.effectiveCapacity, 260_000 * 20);
});

test("ohne Gewinne läuft der Raum exakt auf die Aussentemperatur", () => {
  const room = referenceRoom({ internalGains: 0, windows: [] });
  const r = simulate5R1C(room, input(constant(12), constant(0)), [SOURCE]).value;

  const last = HOURS - 1;
  assert.ok(Math.abs(r.operativeTemperature[last] - 12) < 1e-6, `θ_op = ${r.operativeTemperature[last]}`);
  assert.ok(Math.abs(r.airTemperature[last] - 12) < 1e-6);
  assert.ok(Math.abs(r.massTemperature[last] - 12) < 1e-6);
});

test("im Beharrungszustand ist die Energiebilanz geschlossen", () => {
  // Konstante interne Last, konstantes Aussenklima, keine Sonne.
  const room = referenceRoom({ internalGains: 8, windows: [] });
  const outdoorC = 10;
  const r = simulate5R1C(room, input(constant(outdoorC), constant(0)), [SOURCE]).value;

  const i = HOURS - 1;
  const air = r.airTemperature[i];
  const operative = r.operativeTemperature[i];
  const massT = r.massTemperature[i];
  // θ_op = 0.3·θ_air + 0.7·θ_s  →  θ_s zurückrechnen
  const surface = (operative - 0.3 * air) / 0.7;

  const d = r.derived;
  const ventilation = (1200 * room.airChangeRate * d.volume) / 3600;

  const gains = room.internalGains * room.floorArea;
  const losses =
    ventilation * (air - outdoorC) +
    d.windowConductance * (surface - outdoorC) +
    d.externalMassConductance * (massT - outdoorC);

  assert.ok(
    Math.abs(gains - losses) < 1e-6,
    `Gewinne ${gains.toFixed(6)} W ≠ Verluste ${losses.toFixed(6)} W`,
  );
});

test("schwere Bauart dämpft den Tagesgang stärker als leichte", () => {
  const outdoor = syntheticTemperature(10, 9, 6);
  const global = syntheticGlobal(700);
  const skip = 24 * 30;

  const swing = (massClass: RoomSpec["massClass"]) => {
    const r = simulate5R1C(referenceRoom({ massClass }), input(outdoor, global), [SOURCE]).value;
    // Mittlere Tagesamplitude über den Sommer
    let sum = 0;
    let days = 0;
    for (let d = 150; d < 240; d++) {
      const slice = r.operativeTemperature.slice(d * 24, d * 24 + 24);
      sum += Math.max(...slice) - Math.min(...slice);
      days++;
    }
    return sum / days;
  };

  const light = swing("sehr leicht");
  const heavy = swing("sehr schwer");
  assert.ok(heavy < light, `schwer ${heavy.toFixed(2)} K sollte unter leicht ${light.toFixed(2)} K liegen`);
  assert.ok(skip > 0);
});

test("Südfenster bringt im Sommer mehr Ertrag als Nordfenster", () => {
  const outdoor = syntheticTemperature(10, 9, 6);
  const global = syntheticGlobal(700);

  const gainsFor = (azimuth: number) => {
    const room = referenceRoom();
    room.windows[0].orientation = { tilt: 90, azimuth };
    const r = simulate5R1C(room, input(outdoor, global), [SOURCE]).value;
    return mean(r.solarGains);
  };

  assert.ok(gainsFor(180) > gainsFor(0), "Süd über Nord");
  assert.ok(gainsFor(180) > gainsFor(90), "Süd über Ost");
});

test("Fensterflächenanteil 40 % → 60 % erhöht die Raumtemperatur", () => {
  const outdoor = syntheticTemperature(10, 9, 6);
  const global = syntheticGlobal(700);
  const facade = 9.8;

  const peakFor = (fraction: number) => {
    const windowArea = facade * fraction;
    const room = referenceRoom({ opaqueArea: facade - windowArea });
    room.windows[0].area = windowArea;
    const r = simulate5R1C(room, input(outdoor, global), [SOURCE]).value;
    return maxOf(r.operativeTemperature, 24 * 30);
  };

  const at40 = peakFor(0.4);
  const at60 = peakFor(0.6);
  assert.ok(at60 > at40, `60 % ergibt ${at60.toFixed(1)} °C, 40 % ergibt ${at40.toFixed(1)} °C`);
});

test("Sonnenschutz senkt die Spitzentemperatur deutlich", () => {
  const outdoor = syntheticTemperature(10, 9, 6);
  const global = syntheticGlobal(700);

  const withoutShading = referenceRoom();
  const withShading = referenceRoom();
  withShading.windows[0].shading = { factorClosed: 0.15, activationIrradiance: 200 };

  const a = simulate5R1C(withoutShading, input(outdoor, global), [SOURCE]).value;
  const b = simulate5R1C(withShading, input(outdoor, global), [SOURCE]).value;

  const peakA = maxOf(a.operativeTemperature, 24 * 30);
  const peakB = maxOf(b.operativeTemperature, 24 * 30);
  assert.ok(peakB < peakA - 2, `mit Sonnenschutz ${peakB.toFixed(1)} °C, ohne ${peakA.toFixed(1)} °C`);
  assert.equal(a.shadedHours, 0, "ohne Sonnenschutz keine verschatteten Stunden");
  assert.ok(b.shadedHours > 0);
});

test("Nachtlüftung senkt die Spitzentemperatur und wird nur nachts aktiv", () => {
  const outdoor = syntheticTemperature(10, 9, 6);
  const global = syntheticGlobal(700);

  const without = simulate5R1C(referenceRoom(), input(outdoor, global), [SOURCE]).value;
  const withNv = simulate5R1C(
    referenceRoom({
      nightVentilation: { airChangeRate: 3, fromHour: 22, toHour: 6, minIndoorC: 22, minDeltaK: 2 },
    }),
    input(outdoor, global),
    [SOURCE],
  ).value;

  const peakA = maxOf(without.operativeTemperature, 24 * 30);
  const peakB = maxOf(withNv.operativeTemperature, 24 * 30);
  assert.ok(peakB < peakA, `mit Nachtlüftung ${peakB.toFixed(1)} °C, ohne ${peakA.toFixed(1)} °C`);
  assert.equal(without.nightVentilationHours, 0);
  assert.ok(withNv.nightVentilationHours > 0);
  // Höchstens acht Stunden je Tag im Fenster 22–6
  assert.ok(withNv.nightVentilationHours <= 8 * 365);
});

test("Nachtlüftung bleibt aus, wenn kein Gefälle nach aussen besteht", () => {
  // Ohne Gewinne läuft der Raum auf die Aussentemperatur — dann ist die
  // Bedingung θ_innen − θ_aussen > minDeltaK nie erfüllt, obwohl es mit 30 °C
  // warm genug für die Freigabe wäre.
  const r = simulate5R1C(
    referenceRoom({
      internalGains: 0,
      windows: [],
      nightVentilation: { airChangeRate: 3, fromHour: 22, toHour: 6, minIndoorC: 22, minDeltaK: 2 },
    }),
    input(constant(30), constant(0)),
    [SOURCE],
  ).value;
  assert.ok(Math.abs(r.airTemperature[HOURS - 1] - 30) < 1e-6, "Raum folgt der Aussentemperatur");
  assert.equal(r.nightVentilationHours, 0);
});

test("interne Lasten treiben die Raumtemperatur weit über aussen", () => {
  // Dichter, gut gedämmter Raum ohne Kühlung: 8 W/m² heben die Temperatur
  // um rund 160 W / 18.7 W/K ≈ 8.5 K an. Genau deshalb überhitzen Büros.
  const room = referenceRoom({ windows: [] });
  const r = simulate5R1C(room, input(constant(20), constant(0)), [SOURCE]).value;
  const rise = r.airTemperature[HOURS - 1] - 20;
  assert.ok(rise > 7 && rise < 11, `Anhebung ${rise.toFixed(1)} K`);
});

test("fehlende Aussentemperatur ergibt NaN statt einer erfundenen Zahl", () => {
  const outdoor = constant(15);
  for (let i = 100; i < 110; i++) outdoor[i] = NaN;
  const r = simulate5R1C(referenceRoom(), input(outdoor, constant(0)), [SOURCE]).value;

  for (let i = 100; i < 110; i++) {
    assert.ok(Number.isNaN(r.operativeTemperature[i]), `Stunde ${i} sollte NaN sein`);
  }
  assert.ok(Number.isFinite(r.operativeTemperature[99]));
  assert.ok(Number.isFinite(r.operativeTemperature[110]));
});

test("Bauart ausserhalb des Modellbereichs wird abgewiesen", () => {
  assert.throws(
    () => deriveRoom(referenceRoom({ opaqueArea: 500, opaqueUValue: 3.0, massClass: "sehr leicht" })),
    /ausserhalb des Modellbereichs/,
  );
});

test("Einschwingzeit skaliert mit der Speicherfähigkeit", () => {
  const light = warmupHours(referenceRoom({ massClass: "sehr leicht" }));
  const heavy = warmupHours(referenceRoom({ massClass: "sehr schwer" }));
  assert.ok(heavy > light, `schwer ${heavy} h, leicht ${light} h`);
  assert.equal(heavy % 24, 0, "auf ganze Tage aufgerundet");
});

test("die Stellgrössen landen in der Provenance und ändern den Hash", async () => {
  const outdoor = constant(20);
  const global = constant(300);

  const base = simulate5R1C(referenceRoom(), input(outdoor, global), [SOURCE]);
  assert.equal(base.params.massClass, "mittel");
  assert.equal(base.params.airChangeRate, 0.7);
  assert.equal(base.params.nightVentilation, "aus");
  assert.match(String(base.params.windows), /"azimuth":180/);

  const other = simulate5R1C(referenceRoom({ massClass: "schwer" }), input(outdoor, global), [SOURCE]);
  assert.notEqual(await computationHash(base), await computationHash(other));

  const shaded = referenceRoom();
  shaded.windows[0].shading = { factorClosed: 0.15, activationIrradiance: 200 };
  assert.notEqual(
    await computationHash(base),
    await computationHash(simulate5R1C(shaded, input(outdoor, global), [SOURCE])),
  );
});

test("Belegungsprofil senkt die internen Lasten ausserhalb der Nutzung", () => {
  const withoutSchedule = referenceRoom({ windows: [] });
  const withSchedule = referenceRoom({
    windows: [],
    occupancy: { fromHour: 7, toHour: 19, weekdaysOnly: true, gainsUnoccupied: 2, airChangeOccupied: 1.5 },
  });

  const a = simulate5R1C(withoutSchedule, input(constant(20), constant(0)), [SOURCE]).value;
  const b = simulate5R1C(withSchedule, input(constant(20), constant(0)), [SOURCE]).value;

  assert.equal(a.occupiedHours, HOURS, "ohne Profil gilt durchgehende Belegung");
  // 12 h an 5 von 7 Tagen ≈ 8760 · 12/24 · 5/7 ≈ 3129
  assert.ok(b.occupiedHours > 3000 && b.occupiedHours < 3300, `belegt ${b.occupiedHours} h`);
  assert.ok(
    mean(b.operativeTemperature, 24 * 60) < mean(a.operativeTemperature, 24 * 60),
    "mit Profil ist es im Mittel kühler",
  );
});

test("am Wochenende ruhen die internen Lasten", () => {
  const room = referenceRoom({
    windows: [],
    occupancy: { fromHour: 7, toHour: 19, weekdaysOnly: true, gainsUnoccupied: 0 },
  });
  const r = simulate5R1C(room, input(constant(20), constant(0)), [SOURCE]).value;

  // 1. Januar 2021 war ein Freitag → Index 0 ist Freitag, Samstag beginnt bei 24.
  const saturdayNoon = 24 + 12;
  const fridayNoon = 12;
  assert.ok(
    r.operativeTemperature[saturdayNoon + 24 * 7] < r.operativeTemperature[fridayNoon + 24 * 7],
    "Samstagmittag kühler als Freitagmittag",
  );
});

test("Belegungsprofil landet in der Provenance", async () => {
  const outdoor = constant(20);
  const global = constant(300);
  const base = simulate5R1C(referenceRoom(), input(outdoor, global), [SOURCE]);
  assert.equal(base.params.occupancy, "durchgehend");

  const scheduled = simulate5R1C(
    referenceRoom({ occupancy: { fromHour: 7, toHour: 19, weekdaysOnly: true, gainsUnoccupied: 2 } }),
    input(outdoor, global),
    [SOURCE],
  );
  assert.match(String(scheduled.params.occupancy), /"weekdaysOnly":true/);
  assert.notEqual(await computationHash(base), await computationHash(scheduled));
});
