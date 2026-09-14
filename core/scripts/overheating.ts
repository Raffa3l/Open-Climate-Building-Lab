/**
 * Übertemperaturstunden für einen realen Raum an einer realen Station.
 *
 *   node core/scripts/overheating.ts SMA 2023
 *
 * Rechnet die Parametervariationen, die das Frontend hinter Reglern zeigt:
 * Fensterflächenanteil, Sonnenschutz, Nachtlüftung, Bauart. Raum und Auswertung
 * kommen aus core/src/reference-case.ts, derselben Stelle wie im Browser. Mit
 * denselben Reglern zeigt das Frontend deshalb dieselbe Zahl unter demselben
 * Berechnungs-Hash.
 *
 * Bis 14.09.2026 baute das Skript den Raum selbst und setzte «g_tot 0.15» als
 * Abminderungsfaktor ein. Gerechnet wurde damit g_tot 0.075, halb so viel
 * Sonnendurchlass wie beschriftet.
 */

import { shortHash } from "../src/provenance.ts";
import { warmupHours } from "../src/building.ts";
import {
  DEFAULT_ROOM_SETTINGS,
  evaluateReferenceCase,
  peakOperativeTemperature,
  referenceComfortBand,
  referenceRoom,
  roomSettingsToParams,
  type RoomSettings,
} from "../src/reference-case.ts";
import { station } from "./catalog.ts";

const stationAbbr = (process.argv[2] ?? "SMA").toUpperCase();
const year = process.argv[3] ?? "2023";

const { catalog, entry, meta, series } = await station(stationAbbr, year);
const hasDiffuse = series.variables.has("ods000h0");
const hasLongwave = series.variables.has("oli000h0");

// Komfortband aus dem Aussenklima — für alle Varianten dasselbe.
const band = referenceComfortBand(series);

/** Basisfall: wirksamer Sonnenschutz, so wird gebaut, aber noch ohne Nachtlüftung. */
const BASE: RoomSettings = { ...DEFAULT_ROOM_SETTINGS, nightVentOn: false };
const NIGHT = { nightVentOn: true, nightVent: 3 } as const;

// Die Varianten ohne Sonnenschutz stehen am Schluss als Kontrast und sind
// ausdrücklich keine realistische Ausführung.
const variants: Array<{ label: string; settings: RoomSettings }> = [
  { label: "Basis: 40 % Fenster, Sonnenschutz g_tot 0.15", settings: BASE },
  { label: "+ Nachtlüftung 3 1/h", settings: { ...BASE, ...NIGHT } },
  { label: "+ Nachtlüftung, schwere Bauart", settings: { ...BASE, ...NIGHT, massClass: "schwer" } },
  { label: "+ Nachtlüftung, leichte Bauart", settings: { ...BASE, ...NIGHT, massClass: "sehr leicht" } },
  { label: "Fensteranteil 60 %, Sonnenschutz + Nachtlüftung", settings: { ...BASE, ...NIGHT, windowFraction: 0.6 } },
  { label: "Sonnenschutz g_tot 0.35 statt 0.15", settings: { ...BASE, ...NIGHT, shading: 0.35 } },
  { label: "ohne Sonnenschutz — Kontrast, nicht baubar", settings: { ...BASE, shading: 1 } },
  { label: "ohne Sonnenschutz, 60 % Fenster — Kontrast", settings: { ...BASE, shading: 1, windowFraction: 0.6 } },
];

console.log(`\n${stationAbbr} — ${entry.name} (${entry.canton}, ${Math.round(entry.altitudeM)} m), ${year}`);
console.log(`Südorientiertes Büro, 20 m², U_opak 0.2, U_Fenster 1.0, g 0.5`);
console.log(`Belegung Mo–Fr 07–19 Uhr, 20 W/m² belegt / 2 W/m² unbelegt, n 1.5 / 0.3 1/h`);
console.log(`Bewertung: EN 16798-1 Kat. II, Belegung 07–19 Uhr`);
console.log(`Diffusstrahlung: ${hasDiffuse ? "gemessen" : "aus Globalstrahlung nach Erbs (1982)"}`);
console.log(`Himmelstemperatur: ${hasLongwave ? "aus oli000h0 gemessen" : "pauschal 11 K nach EN ISO 13790"}\n`);

const header =
  "Variante".padEnd(46) + "ÜTS".padStart(6) + "Kh".padStart(8) + "θ_op max".padStart(10) +
  "Schutz".padStart(8) + "NachtL".padStart(8) + "  Hash";
console.log(header);
console.log("-".repeat(header.length + 4));

for (const { label, settings } of variants) {
  const { simulation, exceedance } = evaluateReferenceCase(series, entry, settings, band);
  console.log(
    label.padEnd(46) +
      String(exceedance.value.hours).padStart(6) +
      exceedance.value.kelvinHours.toFixed(0).padStart(8) +
      peakOperativeTemperature(exceedance).toFixed(1).padStart(10) +
      String(simulation.value.shadedHours).padStart(8) +
      String(simulation.value.nightVentilationHours).padStart(8) +
      "  " + (await shortHash(exceedance)),
  );
}

const reference = evaluateReferenceCase(series, entry, BASE, band).simulation.value;
const permalink = new URLSearchParams([["station", stationAbbr], ["year", `y${year}`], ...roomSettingsToParams(BASE)]);
console.log(`\nBasisfall im Frontend: #${permalink}`);
console.log(`Belegte Stunden: ${reference.occupiedHours} von ${series.axis.length}`);
console.log(`Vorlauf aus dem Jahresende: ${warmupHours(referenceRoom(BASE))} h (5 · Zeitkonstante), das ganze Jahr bewertet`);
console.log(`Komfortband definiert an ${[...band.value.upper].filter(Number.isFinite).length} Tagen`);
console.log(`Datenstand ${meta.sha256.slice(0, 12)} · ${catalog.license} · ${catalog.attribution}\n`);
