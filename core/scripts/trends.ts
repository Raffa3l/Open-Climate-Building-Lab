/**
 * Wo hat sich die Überhitzung am stärksten verschoben?
 *
 *   node core/scripts/trends.ts
 *   node core/scripts/trends.ts 'windowFraction=60'   (Regler wie im Browser)
 *   node core/scripts/trends.ts '' 10                 (Mindestzahl Messjahre)
 *
 * Derselbe Raum an jeder Station mit langer Messreihe: Trend der
 * Übertemperaturstunden, Mittel der Normalperiode und der letzten zehn Jahre.
 * Der Schlüssel `station` im Permalink spielt keine Rolle; gerechnet werden
 * alle Stationen.
 *
 * **Nur Stationen mit mindestens 30 vollständigen Jahren.** Ein Trend über
 * 14 Jahre steht neben einem über 34 nicht in derselben Spalte: Die kurze Reihe
 * beginnt nach 2010 und trifft damit eine andere Klimaperiode.
 */

import { evaluateReferenceCase, isCompleteMeasuredYear, roomSettingsFromParams } from "../src/reference-case.ts";
import { exceedancePeriodMean, exceedanceTrend, NORMAL_PERIOD } from "../src/trend.ts";
import { loadCatalog, loadSeries, loadStationIndex } from "./catalog.ts";

const link = process.argv[2] ?? "";
const params = new URLSearchParams(link.includes("#") ? link.slice(link.indexOf("#") + 1) : link);
const settings = roomSettingsFromParams(params);
const MIN_YEARS = Number(process.argv[3] ?? 30);
const RECENT = { fromYear: 2015, toYear: 2024, minYears: 8 };

const catalog = await loadCatalog();
type Row = {
  abbr: string; name: string; canton: string; altitude: number;
  years: number; perDecade: number; rSquared: number; normal: number; recent: number;
};
const rows: Row[] = [];
let short = 0;

for (const [abbr, entry] of Object.entries(catalog.stations) as [string, any][]) {
  if (entry.roomModelYears.length < MIN_YEARS) {
    if (entry.roomModelYears.length) short++;
    continue;
  }
  const index = await loadStationIndex(entry);
  const byYear = [];
  for (const year of entry.roomModelYears) {
    const meta = index[String(year)];
    if (!isCompleteMeasuredYear(meta.completeness)) continue;
    const { exceedance } = evaluateReferenceCase(await loadSeries(meta), entry, settings);
    byYear.push({ year, exceedance });
  }
  if (byYear.length < MIN_YEARS) {
    short++;
    continue;
  }
  const trend = exceedanceTrend(byYear).value;
  rows.push({
    abbr, name: entry.name, canton: entry.canton, altitude: entry.altitudeM,
    years: byYear.length,
    perDecade: trend.perDecade,
    rSquared: trend.rSquared,
    normal: exceedancePeriodMean(byYear, NORMAL_PERIOD).value.mean,
    recent: exceedancePeriodMean(byYear, RECENT).value.mean,
  });
}

if (rows.length === 0) {
  console.log(`\nKeine Station hat ${MIN_YEARS} vollständige Messjahre. Vorhanden sind höchstens ` +
    `${Math.max(0, ...Object.values(catalog.stations).map((e: any) => e.roomModelYears.length))} Jahre.`);
  console.log(`Mehr bauen:  cd data && python3 -m ocbl_data build --from 1991 --to 2024 --jobs 12 --quiet`);
  console.log(`Oder mit kleinerer Mindestzahl:  node core/scripts/trends.ts '' 10\n`);
  process.exit(0);
}

rows.sort((a, b) => b.perDecade - a.perDecade);

console.log(`\nDerselbe Referenzraum an ${rows.length} Stationen mit mindestens ${MIN_YEARS} vollständigen Messjahren`);
console.log(`Südbüro 20 m², 40 % Fenster, Sonnenschutz g_tot 0.15, Nachtlüftung 3 1/h`);
console.log(`Übertemperaturstunden EN 16798-1 Kat. II, Belegung Mo–Fr 07–19 Uhr\n`);

const head = "  # Station".padEnd(34) + "Höhe".padStart(7) + "Jahre".padStart(7) +
  "h/10 a".padStart(9) + "r²".padStart(6) + "91–20".padStart(8) + "15–24".padStart(8) + "Δ".padStart(7);
console.log(head);
console.log("-".repeat(head.length));

const num = (v: number, sign = false) =>
  Number.isFinite(v) ? `${sign && v >= 0 ? "+" : ""}${v.toFixed(0)}` : "—";

const show = (r: Row, i: number) =>
  `${String(i + 1).padStart(3)} ${(r.name + " (" + r.canton + ")").slice(0, 29).padEnd(30)}` +
  `${r.altitude.toFixed(0).padStart(6)}m${String(r.years).padStart(7)}` +
  `${(r.perDecade >= 0 ? "+" : "") + r.perDecade.toFixed(1)}`.padStart(9) +
  // Ohne eine einzige Übertemperaturstunde gibt es keine Streuung und kein r².
  `${Number.isFinite(r.rSquared) ? r.rSquared.toFixed(2) : "—"}`.padStart(6) +
  // Ohne genug Jahre der Periode gibt es kein Mittel und keine Differenz.
  num(r.normal).padStart(8) + num(r.recent).padStart(8) +
  num(r.recent - r.normal, true).padStart(7);

// Kurze Ranglisten ganz, sonst Kopf und Schluss — sonst stünde dieselbe Zeile zweimal da.
if (rows.length <= 20) {
  rows.forEach((r, i) => console.log(show(r, i)));
} else {
  rows.slice(0, 15).forEach((r, i) => console.log(show(r, i)));
  console.log("   …");
  rows.slice(-5).forEach((r, i) => console.log(show(r, rows.length - 5 + i)));
}

const mean = (pick: (r: Row) => number) => {
  const values = rows.map(pick).filter(Number.isFinite);
  return values.reduce((a, b) => a + b, 0) / values.length;
};
const withTrend = rows.filter((r) => Number.isFinite(r.rSquared)).length;
console.log(`\nMittel über alle ${rows.length} Stationen: ${mean((r) => r.perDecade).toFixed(1)} h pro Jahrzehnt, ` +
  `r² ${mean((r) => r.rSquared).toFixed(2)} über die ${withTrend} Stationen mit Übertemperaturstunden; ` +
  `${mean((r) => r.normal).toFixed(0)} h in 1991–2020 gegen ${mean((r) => r.recent).toFixed(0)} h in 2015–2024.`);
console.log(`${short} Stationen mit kürzerer oder lückenhafter Messreihe nicht gerechnet.`);
