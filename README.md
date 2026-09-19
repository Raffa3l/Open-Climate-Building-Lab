# Open Climate Building Lab

Eine frei zugängliche Plattform für Gebäude, Klima und Energie in der Schweiz.

Keine Studie über Daten, sondern rechnende Modelle: Parameter verändern,
Wirkung sofort sehen — und zu jeder Zahl nachvollziehen können, aus welchen
Daten, Annahmen und Gleichungen sie entstanden ist.

**Daten → Modell → interaktive Visualisierung → Erklärung → Quellen → Download**

## Status

Die Kette steht vollständig: **158 Stationen, 4'154 Stationsjahre, 594 MB**.

- ✅ ETL von MeteoSchweiz-OGD (SwissMetNet, stündlich, seit 1980)
- ✅ Rechenkern mit Psychrometrie, Hitzekennwerten, adaptivem Komfort
- ✅ Provenance und Berechnungs-Hashes
- ✅ Binärformat mit Prüfsummen, Python schreibt, TypeScript liest
- ✅ Sonnenstand, Strahlungszerlegung, Einstrahlung geneigter Flächen (isotrop und Perez)
- ✅ Raummodell 5R1C nach EN ISO 13790 mit Belegungsprofil und Himmelsabstrahlung
- ✅ Vordach oder Balkon über dem Fenster, Verbauung gegenüber ([011](docs/methods/011-vordach.md))
- ✅ Frontend mit Reglern, Permalink und «Berechnung anzeigen»
- ✅ Vergleichsmodus: zwei Klimastände in einem Diagramm, mit Differenz je Kennzahl
- ✅ Mehrjahresverlauf: derselbe Raum in jedem Messjahr einer Station, mit Trend ([012](docs/methods/012-mehrjahresverlauf.md))
- ✅ Download: Stundenreihe als CSV und Manifest zum Nachprüfen ohne dieses Projekt, byte-gleich auch aus der Kommandozeile ([010](docs/methods/010-export.md))
- ✅ Alle SwissMetNet-Stationen, ab 1991 oder ab Messbeginn
- ✅ Zukunftsklima: DRY-Szenarien 2035 und 2060, RCP 2.6 und 8.5, 45 Stationen

## Schnellstart

Voraussetzungen: Node ≥ 22.6, Python ≥ 3.9. Keine weiteren Abhängigkeiten —
das ETL nutzt ausschliesslich die Standardbibliothek, der Rechenkern läuft
ohne Build-Schritt.

```bash
# Stationsverzeichnis ansehen
cd data && python3 -m ocbl_data stations --canton ZH

# Ein paar Stationsjahre bauen (lädt von data.geo.admin.ch, mit Cache)
python3 -m ocbl_data build --station SMA --from 2019 --to 2024 --qa

# Oder alles: 158 Stationen ab 1991, rund 40 Minuten, ~4 GB Download
python3 -m ocbl_data build --from 1991 --to 2024 --jobs 12 --quiet \
  --cache-dir ~/.cache/ocbl

# Prüfsummen nachrechnen
python3 -m ocbl_data verify

# Kennwerte rechnen und mit Berechnungs-Hash ausgeben
cd .. && node core/scripts/report.ts SMA

# Übertemperaturstunden für Parametervarianten eines Raums
node core/scripts/overheating.ts SMA 2023

# Derselbe Raum an allen Stationen, nach Überhitzung rangiert
node core/scripts/stations.ts 2023

# Alle Messjahre einer Station mit Trend, wie im Browser
node core/scripts/trend.ts 'station=SMA'

# Und der Trend an allen Stationen mit mindestens 30 vollständigen Jahren
node core/scripts/trends.ts

# Klimaszenarien bauen und Gegenwart gegen 2035/2060 stellen
cd data && python3 -m ocbl_data scenarios --qa && cd ..
node core/scripts/climate-change.ts SMA

# Frontend bauen und ansehen
./scripts/build-web.sh
cd web && python3 -m http.server 8000     # http://localhost:8000

# Tests und Verweisprüfung
node --test "core/test/*.test.ts"
./scripts/check-references.sh
```

Beispielausgabe für Zürich/Fluntern:

```
Jahr     Ø °C  Sommertage  Hitzetage  Tropennächte  KGh 22 °C  NachtLüft Kh  Hash
------------------------------------------------------------------------------------------
2019     10.6          48         13             8       2615         44766  764a1bd60aef
2021      9.6          31          3             2       1270         47028  35721bcb25d9
2023     11.4          64         13             8       3052         41839  d641f729f46b
```

Und derselbe Referenzraum an allen Stationen — nur das Klima unterscheidet sich:

```
  # Station                          Höhe   Ø °C    ÜTS  θ_op max
  1 Lugano (TI)                      273m   14.3    778      37.4
  2 Locarno / Monti (TI)             367m   14.3    767      38.3
  3 Vevey / Corseaux (VD)            405m   13.4    765      38.4
  6 Genève / Cointrin (GE)           411m   12.7    653      38.6
 11 Basel / Binningen (BL)           316m   12.7    603      36.7
    …
129 Jungfraujoch (VS)               3571m   -5.8      0      22.7
```

Und die Parametervarianten, die das Frontend hinter Reglern zeigt, für ein
südorientiertes Büro in Zürich, 2023. Raum und Auswertung kommen aus demselben
Kern wie im Browser; die Zeile mit Nachtlüftung ist die Voreinstellung der App:

```
Variante                                         ÜTS      Kh  θ_op max
Basis: 40 % Fenster, Sonnenschutz g_tot 0.15    1773    8387      41.8
+ Nachtlüftung 3 1/h                             501     801      36.3
+ Nachtlüftung, schwere Bauart                   338     431      34.9
Fensteranteil 60 %, Sonnenschutz + Nachtlüftung   698    1404      37.5
ohne Sonnenschutz — Kontrast, nicht baubar      2123   20656      50.8
```

## Aufbau

| Verzeichnis | Inhalt |
|---|---|
| [`core/`](core/) | Rechenkern in TypeScript. Läuft im Browser, in der API und im CLI — **eine** Implementierung. |
| [`data/`](data/) | ETL in Python. Lädt MeteoSchweiz-OGD, prüft, packt nach `.ocbl`. |
| [`docs/methods/`](docs/methods/) | Herleitung jedes Verfahrens. Ziel des Knopfs «Berechnung anzeigen». |
| [`docs/adr/`](docs/adr/) | Architekturentscheide mit Begründung und verworfenen Alternativen. |
| [`web/`](web/) | Frontend. Regler, Jahresdiagramm, Nachweis. Kein Framework, kein Bundler. |

Von 158 Stationen messen **149** Temperatur und Feuchte, **132** zusätzlich
die Globalstrahlung — nur an diesen ist das Raummodell rechenbar. Die
Diffusstrahlung liegt an 83, die langwellige Einstrahlung an 46 Stationen
gemessen vor; sonst greifen die dokumentierten Rückfallebenen. Der Katalog
führt das je Station unter `capabilities`.

Rohdaten und Build-Artefakte werden nicht eingecheckt. Im Repo steht das
Rezept, nicht das Ergebnis — `python3 -m ocbl_data build` stellt es jederzeit
wieder her.

## Das Prinzip: Reproduzierbarkeit als Architektur

«Berechnung anzeigen» ist kein Feature, das man nachträglich anschraubt. Eine
nachträglich geschriebene Erklärseite driftet von der tatsächlichen Rechnung ab.

Deshalb gibt jede Funktion, die einen publizierbaren Wert liefert, eine
`Computation<T>` zurück statt einer nackten Zahl:

```ts
{
  value:  { count: 8, completeness: 1.0 },
  unit:   "Nächte",
  method: { id: "indicator.tropicalNights", version: "1.0.0",
            doc: "docs/methods/002-heat-indicators.md#tropennächte",
            sources: ["meteoschweiz-klimaindikatoren"] },
  params: { thresholdC: 20, nightStartHour: 18, nightEndHour: 6 },
  inputs: [ { collection: "ch.meteoschweiz.ogd-smn", station: "SMA",
              year: 2023, sha256: "b03ae9…", license: "CC-BY-4.0" } ]
}
```

Daraus folgt der **Berechnungs-Hash** über Verfahren, Version, Parameter und
Prüfsummen der Eingangsdaten — der Permalink einer Grafik. Gleiche Eingaben
ergeben denselben Hash, auf jeder Maschine, zu jeder Zeit. Der Ergebniswert
geht bewusst nicht ein, sonst wäre der Hash nicht prüfbar.

Eine Grafik ohne Provenance kann es damit nicht geben — der Typ erlaubt sie nicht.

Drei Regeln, die daraus folgen:

1. **Annahmen sind Parameter.** Was man diskutieren kann, steht in `params`
   und damit im Hash. Die Kühlgradstunden-Basis ist eine Konvention, keine
   Naturkonstante.
2. **Ausserhalb des Gültigkeitsbereichs kommt `NaN`**, keine Extrapolation.
   Das adaptive Komfortband ist nur für 10–30 °C definiert und liefert sonst
   nichts.
3. **Version erhöhen, wenn sich Ergebnisse ändern** — auch bei einer
   Fehlerkorrektur. Publizierte Werte müssen zuordenbar bleiben.

## Validierung

Der Taupunkt-Kreuzvergleich prüft die Psychrometrie gegen die Messreihe:
MeteoSchweiz liefert `tde200h0` mit, und `data/ocbl_data/qa.py` enthält eine
zweite, getrennt getippte Fassung der Formeln.

Zürich/Fluntern 2023, 8760 verglichene Stunden: mittlere Abweichung **+0.002 K**,
maximale Abweichung 0.434 K, 100 % innerhalb 0.5 K. Die Reststreuung ist
Rundung in der Publikationsauflösung.

## Daten und Lizenz

Der **Code** steht unter [Apache-2.0](LICENSE) — Begründung in
[ADR 0001](docs/adr/0001-open-source-apache-2.md).

Die **Daten** stammen vom Bundesamt für Meteorologie und Klimatologie
MeteoSchweiz und stehen unter CC BY 4.0. Quellenangabe ist Pflicht und wird
über die Provenance mitgeführt. Details, offene Lizenzfragen und alle
Zitierschlüssel: [`docs/methods/sources.md`](docs/methods/sources.md).

Eine **vollständige** Quellenangabe verlangen beide Lizenzen: Autor, Titel und
Link zum Datensatz, bei CC BY zusätzlich die Lizenz. Der `DatasetRef` führt
diese Felder deshalb einzeln mit, und «Berechnung anzeigen» weist sie aus.

> **Geklärt am 22. August 2026.** Der stündliche DRY-Datensatz
> `ch.meteoschweiz.klimaszenarien-raumklima` (45 Stationen, CH2018-basiert)
> steht unter *„Freie Nutzung. Quellenangabe ist Pflicht."* — kommerzielle
> Nutzung eingeschlossen. Das `proprietary` im STAC-Katalog war kein
> Widerspruch, sondern bedeutet dort nur „keine SPDX-Standardkennung".
> Der Datensatz ist damit **nutzbar**; das Zukunftsklima ist nicht mehr durch
> eine Lizenzfrage blockiert.
