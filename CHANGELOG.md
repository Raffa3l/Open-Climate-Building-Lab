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

### Geplant
- 5R1C-Raummodell nach ISO 52016-1 — macht `exceedanceHours()` erstmals
  rechenbar
- Frontend mit Reglern und «Berechnung anzeigen»
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

`.ocbl`-Formatversion: **1**.
