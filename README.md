# Open Climate Building Lab

Eine frei zugängliche Plattform für Gebäude, Klima und Energie in der Schweiz.

Nicht Artikel über Daten, sondern rechnende Modelle: Parameter verändern,
Wirkung sofort sehen — und zu jeder Zahl nachvollziehen können, aus welchen
Daten, Annahmen und Gleichungen sie entstanden ist.

**Daten → Modell → interaktive Visualisierung → Erklärung → Quellen → Download**

## Status

Frühes Gerüst. Die Kette steht vollständig, aber schmal:

- ✅ ETL von MeteoSchweiz-OGD (SwissMetNet, stündlich, seit 1980)
- ✅ Rechenkern mit Psychrometrie, Hitzekennwerten, adaptivem Komfort
- ✅ Provenance und Berechnungs-Hashes
- ✅ Binärformat mit Prüfsummen, Python schreibt, TypeScript liest
- ⬜ Frontend
- ⬜ Raummodell (5R1C nach ISO 52016-1)
- ⬜ Zukunftsklima (siehe [ADR 0004](docs/adr/0004-v0-nur-vergangenheit.md))

## Schnellstart

Voraussetzungen: Node ≥ 22.6, Python ≥ 3.9. Keine weiteren Abhängigkeiten —
das ETL nutzt ausschliesslich die Standardbibliothek, der Rechenkern läuft
ohne Build-Schritt.

```bash
# Stationsverzeichnis ansehen
cd data && python3 -m ocbl_data stations --canton ZH

# Ein paar Stationsjahre bauen (lädt von data.geo.admin.ch, mit Cache)
python3 -m ocbl_data build --station SMA --from 2019 --to 2024 --qa

# Prüfsummen nachrechnen
python3 -m ocbl_data verify

# Kennwerte rechnen und mit Berechnungs-Hash ausgeben
cd .. && node core/scripts/report.ts SMA

# Tests und Verweisprüfung
node --test "core/test/*.test.ts"
./scripts/check-references.sh
```

Beispielausgabe für Zürich/Fluntern:

```
Jahr     Ø °C  Sommertage  Hitzetage  Tropennächte  KGh 22 °C  NachtLüft Kh  Hash
------------------------------------------------------------------------------------------
2019     10.6          48         13             8       2615         44766  2cf9dbbb79ec
2021      9.6          31          3             2       1270         47028  2eb5f39f707d
2023     11.4          64         13             8       3052         41839  ceecad96a7ad
```

## Aufbau

| Verzeichnis | Inhalt |
|---|---|
| [`core/`](core/) | Rechenkern in TypeScript. Läuft im Browser, in der API und im CLI — **eine** Implementierung. |
| [`data/`](data/) | ETL in Python. Lädt MeteoSchweiz-OGD, prüft, packt nach `.ocbl`. |
| [`docs/methods/`](docs/methods/) | Herleitung jedes Verfahrens. Ziel des Knopfs «Berechnung anzeigen». |
| [`docs/adr/`](docs/adr/) | Architekturentscheide mit Begründung und verworfenen Alternativen. |
| `web/` | Frontend. Noch leer. |

Änderungen und Verfahrensversionen: [`CHANGELOG.md`](CHANGELOG.md).
Hinweise für Claude Code: [`CLAUDE.md`](CLAUDE.md).

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

Zürich/Fluntern 2023, 8760 verglichene Stunden: mittlere Abweichung **+0,002 K**,
maximale Abweichung 0,434 K, 100 % innerhalb 0,5 K. Die Reststreuung ist
Rundung in der Publikationsauflösung.

## Daten und Lizenz

Der **Code** steht unter [Apache-2.0](LICENSE) — Begründung in
[ADR 0001](docs/adr/0001-open-source-apache-2.md).

Die **Daten** stammen vom Bundesamt für Meteorologie und Klimatologie
MeteoSchweiz und stehen unter CC BY 4.0. Quellenangabe ist Pflicht und wird
über die Provenance mitgeführt. Details, offene Lizenzfragen und alle
Zitierschlüssel: [`docs/methods/sources.md`](docs/methods/sources.md).

> Eine Lizenzfrage ist ausdrücklich **ungeklärt**: der stündliche
> DRY-Datensatz `ch.meteoschweiz.klimaszenarien-raumklima` ist im STAC-Katalog
> als `proprietary`, auf opendata.swiss als frei nutzbar deklariert. Bis das
> geklärt ist, wird er nicht verwendet.
