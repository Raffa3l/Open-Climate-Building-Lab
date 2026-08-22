# Änderungen

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

Zusätzlich zur Projektversion trägt **jedes Rechenverfahren eine eigene
Version** in seinem `MethodRef`. Sie wird erhöht, sobald sich Ergebnisse für
gleiche Eingaben ändern — auch bei einer Fehlerkorrektur, damit publizierte
Werte zuordenbar bleiben. Solche Änderungen stehen unten unter
**Verfahrensversionen** und sind für Nutzerinnen der API die wichtigste Rubrik:
ein erhöhter Verfahrensstand ändert alle davon abhängigen Berechnungs-Hashes.

## [Unveröffentlicht]

### Hinzugefügt
- `solar` — Sonnenstand nach Michalsky/NOAA, Diffusanteil nach Erbs (1982),
  Einstrahlung auf geneigte Flächen im isotropen Himmelsmodell (Liu & Jordan).
- `building` — Raummodell **5R1C nach EN ISO 13790:2008**, Simple Hourly
  Method: Bauartklassen nach Tabelle 12, Sonnenschutzregelung an einer
  Bestrahlungsschwelle, Nachtlüftungsregelung, Belegungsprofil mit
  Wochenendaussparung, `warmupHours()` für die Einschwingphase.
- `core/scripts/overheating.ts` — Übertemperaturstunden für Parametervarianten
  eines Raums an einer realen Station.
- Methodenseiten [005](docs/methods/005-solar.md) und
  [006](docs/methods/006-room-model-5r1c.md).

### Geändert
- **`building.simulate5R1C` auf 1.2.0**, weil Perez das neue Standard-Modell
  ist. Zuvor 1.1.0 wegen der Himmelsabstrahlung.
- **`solar.tiltedIrradiance` auf 1.0.1:** Die Direktnormalstrahlung ist auf
  1,035 · 1367 W/m² begrenzt — die extraterrestrische Bestrahlungsstärke im
  Perihel. Ohne Grenze erzeugte die Zerlegung I_bn = I_b/sin(h) bei flachem
  Sonnenstand Werte von mehreren tausend W/m². Betrifft 5 von 26 078
  Sonnenstunden an Zürich/Fluntern (0,019 %).
- **`building.simulate5R1C` auf 1.1.0**, weil die Himmelsabstrahlung die
  Ergebnisse für gleiche Eingaben ändert. Alle davon abhängigen
  Berechnungs-Hashes ändern sich mit. `skyViewFactor: 0` schaltet den Term ab,
  reproduziert aber nicht den 1.0.0-Hash — das ist beabsichtigt.
- `SimulationResult.skyLoss` meldet den **wirksamen** Verlust F_r · Φ_r, nicht
  den ungewichteten. Die erste Fassung war hier zweideutig.
- **Normzuordnung korrigiert:** Das 5R1C-Modell stammt aus EN ISO 13790:2008,
  nicht aus ISO 52016-1. 52016-1 hat 13790 abgelöst, verwendet aber ein
  anderes, knotenbasiertes Stundenverfahren. Die früheren Verweise waren
  falsch und sind in allen Dokumenten berichtigt.

### Gemessen
- **Jahressummen der Einstrahlung** als unabhängiger Anker, Zürich/Fluntern:
  horizontal 1198–1253 kWh/m², Südfassade 979–1033 (Perez), 30° Südneigung
  1403–1476. Die Grössenordnungen decken sich mit publizierten Werten für
  Zürich. Horizontal liefern beide Modelle identische Summen — das muss so
  sein und ist der schärfste Selbsttest.
- **Perez gegen isotrop:** Süd +8 %, Ost/West +4 %, Nord −12 %. Auf die
  Überhitzung wirkt das mit +4 bis +6 % Übertemperaturstunden — das isotrope
  Modell lag auf der optimistischen Seite.
- Wirkung der Himmelsabstrahlung, Südbüro Zürich 2023: beim **Neubau** −9 %
  Übertemperaturstunden und −0,15 K Spitzentemperatur, beim **ungedämmten
  Altbau** −26 %. Der Schritt von „gar nicht" zu „pauschal 11 K" wiegt dabei
  schwerer als der von „pauschal" zu „gemessen" (2–3 %).
- Δθ_sky an Zürich/Fluntern 2023: Mittel 9,78 K, aber Spannweite 1,4 bis
  25,3 K — der Pauschalwert der Norm kann eine bedeckte Nacht nicht von einer
  klaren unterscheiden.

### Validierung
- **Geschlossene Energiebilanz im Beharrungszustand** auf besser als 10⁻⁶ W —
  die schärfste verfügbare Prüfung des Raummodells.
- Sonnenstand gegen astronomisch nachprüfbare Stützstellen für Zürich:
  Mittagshöhe 66,06° / 19,18° an den Wendepunkten, Tageslänge 15,9 h / 8,5 h,
  Kulmination im Süden am wahren Ortsmittag.

- **Frontend** (`web/`) — Regler für Fensterflächenanteil, Sonnenschutz,
  interne Lasten, Nachtlüftung, Bauart und Ausrichtung; Jahresdiagramm mit
  Fadenkreuz und Tooltip; Kennzahlen; Tabelle der überschrittenen Tage;
  «Berechnung anzeigen» mit Verfahren, Version, Parametern, Prüfsumme der
  Eingangsdaten und Berechnungs-Hash. Der Zustand steht im Permalink.
  Kein Framework, keine Diagrammbibliothek.
- `scripts/build-web.sh` — übersetzt `core/src` per `tsc` nach nativem ESM und
  legt die Stationsjahre daneben.
- [ADR 0006](docs/adr/0006-browser-emit.md) und
  [Methode 007](docs/methods/007-visualisierung.md).
- `sky` — **langwellige Abstrahlung gegen den Himmel** nach EN ISO 13790
  §11.3.5. Himmelstemperatur aus der gemessenen Einstrahlung `oli000h0`, sonst
  Pauschalwert 11 K der Norm. Neuer Parameter `skyViewFactor` (0,5 senkrecht).
- `core/scripts/model-effects.ts` — beziffert die Wirkung der
  Modellverfeinerungen an echten Daten; Grundlage für die Zahlen in
  [Methode 005](docs/methods/005-solar.md) und
  [008](docs/methods/008-langwellige-abstrahlung.md).
- **Anisotropes Himmelsmodell nach Perez (1990)** als eigenes Verfahren
  `solar.tiltedIrradiancePerez` — zirkumsolare Aufhellung und
  Horizontaufhellung, Koeffizienten über die Himmelsklarheit ε, Luftmasse nach
  Kasten & Young. Seit `building.simulate5R1C@1.2.0` der Standard;
  `skyModel: "isotrop"` schaltet zurück. Im Frontend wählbar.

### Geplant
- Verschattung statt isotropem Himmel, als eigenes Verfahren
- Zukunftsklima, sobald Lizenz und Publikationsstand geklärt sind
  ([ADR 0004](docs/adr/0004-v0-nur-vergangenheit.md))

## [0.1.0] — 2026-08-22

Erste lauffähige Fassung der vollständigen Kette von MeteoSchweiz-OGD bis zum
Kennwert mit Berechnungs-Hash. Kein Frontend, kein Raummodell.

### Hinzugefügt

**Rechenkern (`core/`, TypeScript, ohne Build-Schritt)**
- `provenance` — `Computation<T>`, stabile Serialisierung mit sortierten
  Schlüsseln, Berechnungs-Hash über Verfahren, Version, Parameter und
  Prüfsummen der Eingangsdaten. Ergebniswert und `doc`-Pfad gehen bewusst nicht
  ein.
- `psychro` — Sättigungsdampfdruck nach Magnus/Sonntag, Taupunkt, Feuchtegehalt,
  Enthalpie, absolute Feuchte, Feuchtkugeltemperatur über Bisektion der
  Psychrometergleichung.
- `series` — Zeitachse mit expliziter Intervallkonvention, Intervallmitte für
  Sonnenstände, Lokalzeit als fester Offset ohne Sommerzeit.
- `indicators` — Tagesmittel und -extreme, Sommer- und Hitzetage, Tropennächte,
  Kühlgradstunden, Nachtlüftungspotenzial, gleitendes Aussentemperaturmittel und
  adaptives Komfortband nach EN 16798-1, Übertemperaturstunden.
- `pack` — Leseseite des `.ocbl`-Formats mit Prüfsummenverifikation und
  Erkennung beschädigter Dateien.
- `scripts/report.ts` — Kennwerttabelle je Station mit Berechnungs-Hash.

**ETL (`data/`, Python, nur Standardbibliothek)**
- STAC-Abfrage von `data.geo.admin.ch`, Downloads mit Plattencache.
- Stationsverzeichnis aus `ogd-smn_meta_stations.csv` (157 Stationen).
- Stundendateien: Dekaden- und `recent`-File werden zusammengesetzt, späteres
  File gewinnt.
- 13 Variablen mit Gültigkeitsbereich; `_self_check()` prüft beim Import, dass
  die Int16-Skalierung den Bereich trägt.
- `.ocbl`-Schreibseite, Katalog mit SHA-256 und Vollständigkeit je Stationsjahr.
- CLI: `stations`, `build`, `verify`.
- QA: Taupunkt-Kreuzvergleich gegen `tde200h0` mit zweiter, unabhängig
  getippter Fassung der Formeln.

**Dokumentation**
- Fünf Methodenseiten: Zeitkonventionen, Feuchte Luft, Hitzekennwerte,
  adaptiver Komfort, Binärformat.
- `docs/methods/sources.md` mit allen Zitierschlüsseln, Datenlizenzen und den
  offenen Lizenzfragen.
- Fünf ADRs mit Begründung und verworfenen Alternativen.
- README, CONTRIBUTING, CLAUDE.md, CI mit Typprüfung und echtem
  Integrationslauf.
- `scripts/check-references.sh` — prüft, dass jeder `MethodRef.doc` auf eine
  existierende Überschrift zeigt und jeder `sources`-Schlüssel in
  `docs/methods/sources.md` aufgelöst ist.

### Behoben
- Zwei `MethodRef.doc`-Verweise zeigten auf nicht existierende Überschriften
  (`#spezifische-enthalpie`, `#hitze--und-sommertage`), gefunden vom neuen
  Prüfskript. Da `doc` nicht in den Berechnungs-Hash eingeht, brechen dadurch
  keine Permalinks und es war kein Versionssprung nötig.

### Entschieden
- Kern offen unter **Apache-2.0** ([0001](docs/adr/0001-open-source-apache-2.md))
- Rechenkern in **TypeScript**, ETL in Python ([0002](docs/adr/0002-rechenkern-in-typescript.md))
- **Keine Datenbank** im heissen Pfad ([0003](docs/adr/0003-keine-datenbank.md))
- v0 rechnet **nur Vergangenheit** ([0004](docs/adr/0004-v0-nur-vergangenheit.md))
- Klimaachse als **Erwärmungsniveau**, nicht als Jahreszahl
  ([0005](docs/adr/0005-globale-erwaermungsniveaus.md))

### Validierung
- Taupunkt-Kreuzvergleich Zürich/Fluntern 2023, 8760 Stunden: mittlere
  Abweichung **+0,002 K**, maximal 0,434 K, 100 % innerhalb 0,5 K. Die
  Reststreuung entspricht der Publikationsrundung.
- Feuchtkugeltemperatur gegen Stützstellen des h,x-Diagramms; über den gesamten
  Bereich ist $T_d \le T_w \le T$ geprüft.
- 42 Tests grün, `tsc --noEmit` sauber im strict-Modus.

### Gemessen
- Ein Stationsjahr mit elf Variablen: **189,4 kB** (Zürich/Fluntern 2023).
  Bestätigt die Architektur ohne Datenbank.

### Bekannte Einschränkungen
- `exceedanceHours()` ist implementiert und geprüft, aber ohne Raummodell nicht
  produktiv nutzbar — sie verlangt eine Raumtemperaturreihe.
- SIA 180 hat eigene Grenzkurven; umgesetzt ist vorerst nur EN 16798-1.
- Diffusstrahlung `ods000h0` wird nicht an allen Stationen gemessen — bei
  Zürich/Fluntern fehlt sie vollständig.
- Ältere Jahrgänge führen `prestah0` und `tde200h0` teils nicht; die
  Rückfallebene über die Stationshöhe ist dokumentiert.

### Verfahrensversionen
Alle Verfahren starten bei `1.0.0`:
`psychro.saturationVapourPressure`, `psychro.wetBulbTemperature`,
`psychro.specificEnthalpy`, `indicator.tropicalNights`,
`indicator.thresholdDays`, `indicator.coolingDegreeHours`,
`indicator.nightVentilationPotential`,
`comfort.runningMeanOutdoorTemperature`, `comfort.adaptiveComfortBand`,
`comfort.exceedanceHours`.

Neu in Unveröffentlicht bei `1.0.0`: `solar.position`,
`solar.diffuseFraction`, `solar.tiltedIrradiance`, `sky.temperature`.

Neu bei `1.0.0`: `solar.tiltedIrradiancePerez`.

**`building.simulate5R1C` steht bei `1.2.0`, `solar.tiltedIrradiance` bei
`1.0.1`.**

Das Frontend führt keine eigenen Verfahren: Es ruft denselben Rechenkern auf
und zeigt dessen `MethodRef` an. Ein Versionssprung dort schlägt unmittelbar
auf die angezeigten Hashes durch.

`.ocbl`-Formatversion: **1**.
