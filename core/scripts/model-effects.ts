/**
 * Was bringen die Modellverfeinerungen tatsächlich?
 *
 *   node core/scripts/sky-effect.ts
 *
 * Beziffert an echten Daten, was die langwellige Abstrahlung gegen den Himmel
 * und der Wechsel vom isotropen zum anisotropen Himmelsmodell ausmachen —
 * je für einen Neubau und einen ungedämmten Altbau. Die Zahlen in
 * docs/methods/005 und 008 stammen aus diesem Skript.
 */

import { getVariable } from "../src/series.ts";
import { station } from "./catalog.ts";
import { adaptiveComfortBand, dailyMean, exceedanceHours, runningMeanOutdoorTemperature } from "../src/indicators.ts";
import { simulate5R1C, type RoomSpec } from "../src/building.ts";

// Über den zweistufigen Katalog wie die übrigen Skripte. Der direkte Zugriff auf
// entry.years["2023"].path brach, als der Katalog in Index und Detaildateien
// aufgeteilt wurde: years ist seither eine Liste von Jahreszahlen.
const { entry, series } = await station("SMA", "2023");

const outdoor = getVariable(series, "tre200h0");
const inputs = [series.source];
const band = adaptiveComfortBand(runningMeanOutdoorTemperature(dailyMean(outdoor, series.axis), inputs), { category: "II" });

const base = { outdoorTemperature: outdoor, globalHorizontal: getVariable(series, "gre000h0"), axis: series.axis, latitude: entry.lat, longitude: entry.lon };
const lw = getVariable(series, "oli000h0");

function room(uOpaque: number, uWindow: number, skyViewFactor: number, skyModel: "perez" | "isotrop" = "perez"): RoomSpec {
  const wa = 9.8 * 0.4;
  return {
    floorArea: 20, height: 2.8, opaqueArea: 9.8 - wa, opaqueUValue: uOpaque, thermalBridges: 0.5,
    windows: [{ area: wa, orientation: { tilt: 90, azimuth: 180 }, uValue: uWindow, gValue: 0.5, frameFraction: 0.25,
                shading: { factorClosed: 0.3, activationIrradiance: 200 } }],
    massClass: "mittel", airChangeRate: 0.3, internalGains: 20,
    occupancy: { fromHour: 7, toHour: 19, weekdaysOnly: true, gainsUnoccupied: 2, airChangeOccupied: 1.5 },
    nightVentilation: { airChangeRate: 3, fromHour: 22, toHour: 6, minIndoorC: 22, minDeltaK: 2 },
    skyViewFactor, skyModel,
  };
}

function run(spec: RoomSpec, longwave?: Float64Array) {
  const sim = simulate5R1C(spec, longwave ? { ...base, downwellingLongwave: longwave } : base, inputs);
  const uts = exceedanceHours(sim, band, series.axis, { occupiedFromHour: 7, occupiedToHour: 19 });
  const op = sim.value.operativeTemperature.slice();
  op.fill(NaN, 0, Number(uts.params.warmupHours));
  const peak = Math.max(...[...op].filter(Number.isFinite));
  const meanLoss = [...sim.value.skyLoss].filter(Number.isFinite).reduce((a, b) => a + b, 0) / series.axis.length;
  return { uts: uts.value.hours, kh: uts.value.kelvinHours, peak, meanLoss };
}

const cases: Array<[string, RoomSpec, Float64Array | undefined]> = [
  ["Neubau — ohne Abstrahlung, isotrop", room(0.2, 1.0, 0, "isotrop"), undefined],
  ["Neubau — pauschal 11 K, isotrop", room(0.2, 1.0, 0.5, "isotrop"), undefined],
  ["Neubau — gemessen, isotrop", room(0.2, 1.0, 0.5, "isotrop"), lw],
  ["Neubau — gemessen, Perez", room(0.2, 1.0, 0.5, "perez"), lw],
  ["Altbau — ohne Abstrahlung, isotrop", room(1.4, 2.8, 0, "isotrop"), undefined],
  ["Altbau — gemessen, isotrop", room(1.4, 2.8, 0.5, "isotrop"), lw],
  ["Altbau — gemessen, Perez", room(1.4, 2.8, 0.5, "perez"), lw],
];

console.log("\nWirkung der Modellverfeinerungen — Zürich/Fluntern 2023\n");
console.log("Fall".padEnd(38) + "ÜTS".padStart(6) + "Kh".padStart(8) + "θ_op max".padStart(10) + "Ø Φ_r".padStart(9));
console.log("-".repeat(71));
for (const [label, spec, longwave] of cases) {
  const r = run(spec, longwave);
  console.log(label.padEnd(38) + String(r.uts).padStart(6) + r.kh.toFixed(0).padStart(8) +
    r.peak.toFixed(2).padStart(10) + `${r.meanLoss.toFixed(1)} W`.padStart(9));
}
