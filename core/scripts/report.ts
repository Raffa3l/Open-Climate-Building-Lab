/**
 * Beweisstück für die Kette: liest die vom Python-ETL gebauten Stationsjahre,
 * rechnet die v0-Kennwerte und druckt sie mit ihrem Berechnungs-Hash.
 *
 *   node core/scripts/report.ts SMA
 *
 * Genau diese Ausgabe wird das Frontend später hinter "Berechnung anzeigen"
 * zeigen — dieselben Funktionen, dieselben Hashes.
 */

import { getVariable } from "../src/series.ts";
import { loadCatalog, loadSeries, loadStationIndex } from "./catalog.ts";
import { citations, shortHash } from "../src/provenance.ts";
import {
  adaptiveComfortBand,
  coolingDegreeHours,
  dailyMean,
  nightVentilationPotential,
  runningMeanOutdoorTemperature,
  thresholdDays,
  tropicalNights,
} from "../src/indicators.ts";

const stationAbbr = (process.argv[2] ?? "SMA").toUpperCase();

const catalog = await loadCatalog();
const entry = catalog.stations[stationAbbr];
if (!entry) {
  throw new Error(`Station ${stationAbbr} nicht im Katalog (${Object.keys(catalog.stations).length} vorhanden)`);
}
const index = await loadStationIndex(entry);

console.log(`\n${stationAbbr} — ${entry.name} (${entry.canton}), ${entry.altitudeM} m ü. M.`);
console.log(`Quelle: ${catalog.collection} · ${catalog.license}\n`);

const head = ["Jahr", "Ø °C", "Sommertage", "Hitzetage", "Tropennächte", "KGh 22 °C", "NachtLüft Kh", "Hash"];
console.log(head[0].padEnd(6) + head[1].padStart(7) + head[2].padStart(12) + head[3].padStart(11) +
  head[4].padStart(14) + head[5].padStart(11) + head[6].padStart(14) + "  " + head[7]);
console.log("-".repeat(90));

for (const [year, meta] of Object.entries(index)) {
  const series = await loadSeries(meta);
  const t = getVariable(series, "tre200h0");
  const inputs = [series.source];

  const daily = dailyMean(t, series.axis);
  const valid = [...daily].filter(Number.isFinite);
  const annual = valid.reduce((a, b) => a + b, 0) / valid.length;

  const summer = thresholdDays(t, series.axis, inputs, { thresholdC: 25 });
  const hot = thresholdDays(t, series.axis, inputs, { thresholdC: 30 });
  const nights = tropicalNights(t, series.axis, inputs);
  const cdh = coolingDegreeHours(t, inputs, { baseC: 22 });
  const nv = nightVentilationPotential(t, series.axis, inputs);

  console.log(
    year.padEnd(6) +
      annual.toFixed(1).padStart(7) +
      String(summer.value.count).padStart(12) +
      String(hot.value.count).padStart(11) +
      String(nights.value.count).padStart(14) +
      cdh.value.kelvinHours.toFixed(0).padStart(11) +
      nv.value.kelvinHours.toFixed(0).padStart(14) +
      "  " + (await shortHash(nights)),
  );
}

// Das Komfortband hängt nur vom Aussenklima ab und lässt sich schon ohne
// Raummodell zeigen — die Übertemperaturstunden kommen erst mit diesem dazu.
const last = Object.entries(index).at(-1)!;
const series = await loadSeries(last[1]);
const daily = dailyMean(getVariable(series, "tre200h0"), series.axis);
const rm = runningMeanOutdoorTemperature(daily, [series.source]);
const band = adaptiveComfortBand(rm.value, [series.source], { category: "II" });
const definedDays = [...band.value.upper].filter(Number.isFinite);

console.log(`\nAdaptives Komfortband EN 16798-1 Kat. II, ${last[0]}:`);
console.log(`  an ${definedDays.length} von ${band.value.upper.length} Tagen definiert (10 °C ≤ Θrm ≤ 30 °C)`);
console.log(`  Obergrenze ${Math.min(...definedDays).toFixed(1)} … ${Math.max(...definedDays).toFixed(1)} °C`);
console.log(`  Verfahren ${band.method.id}@${band.method.version} · Hash ${await shortHash(band)}`);
console.log(`\nQuelle: ${citations(band).join(" | ")}\n`);
