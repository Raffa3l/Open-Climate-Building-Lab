# Quellen

Die Schlüssel dieser Liste erscheinen im Feld `sources` jedes `MethodRef` im
Rechenkern. Wer einen publizierten Wert prüfen will, findet über den Schlüssel
die Primärquelle.

## Daten

### `meteoschweiz-ogd-smn`
Bundesamt für Meteorologie und Klimatologie MeteoSchweiz:
*Automatische Wetterstationen – Messwerte* (SwissMetNet).
STAC-Collection `ch.meteoschweiz.ogd-smn`, <https://data.geo.admin.ch>.
**Lizenz: CC BY 4.0.** 157 Stationen, Stundenwerte seit 1980 in
Zehnjahresdateien. Quellenangabe ist Pflicht.

### `meteoschweiz-ogd-ch2025`
MeteoSchweiz / ETH Zürich / C2SM unter dem Dach des NCCS:
*Klimaszenarien CH2025 pro Station (DAILY-LOCAL)*, publiziert 4. November 2025.
STAC-Collection `ch.meteoschweiz.ogd-climate-scenarios-ch2025`.
**Lizenz: CC BY 4.0.** Tageswerte, gegliedert nach Erwärmungsniveaus
(`gwl1.5`, `gwl2.0`, `gwl2.5`, `gwl3.0`) statt nach RCP und Zeitperiode.

### `meteoschweiz-klimaindikatoren`
MeteoSchweiz, Definitionen der Klimaindikatoren (Hitzetag, Sommertag,
Tropennacht, Frosttag).

## Offene Lizenzfragen

### `meteoschweiz-raumklima` — **ungeklärt, nicht verwenden**
*Klimaszenarien fürs zukünftige Innenraumklima (SIA 2028)*,
Collection `ch.meteoschweiz.klimaszenarien-raumklima`. 45 Stationen, stündlich,
Design Reference Years und warme Sommer für 2020–2049 und 2045–2074, auf
CH2018 basierend.

Die Katalogangaben widersprechen sich:

| Katalog | Angabe |
|---|---|
| STAC `data.geo.admin.ch` | `proprietary`, Link auf die admin.ch-Nutzungsbedingungen |
| `opendata.swiss` | `terms_by` — „Freie Nutzung. Quellenangabe ist Pflicht." |

`proprietary` bedeutet im STAC-Vokabular lediglich „keine SPDX-Standardlizenz"
und nicht zwingend „nicht weitergebbar". Bis die Frage bei MeteoSchweiz
schriftlich geklärt ist, wird dieser Datensatz nicht ausgeliefert.

Falls die Klärung einschränkend ausfällt, bleibt der Ausweg, ausschliesslich
**abgeleitete Kennwerte** zu publizieren statt der Zeitreihen selbst — aus
Übertemperaturstunden lässt sich der Originaldatensatz nicht rekonstruieren.

### `sia-4028` — **Status zu prüfen**
SIA: *Klimadaten für bauphysikalische, energetische und gebäudetechnische
Berechnungen*, Nachfolger des Merkblatts SIA 2028:2010.
53 Stationen plus Wärmeinselmodellierung für sieben Städte, Messbasis
1994–2023 mit Trendkorrektur, DRY und „1 in 10"-Extremsommer, stündlich.
Zukunftsbezug nur noch RCP 8.5, Zieljahr gemäss CH2025 auf 2050 angepasst.
Bezug über energytools.ch, kostenlos, keine Printausgabe.

Die technische Vernehmlassung lief März bis Mai 2026. Vor einer Referenzierung
ist zu klären, ob eine Schlussfassung vorliegt und welche Nutzungsbedingungen
für die Datensätze gelten.

## Verfahren

### `sonntag1990`
Sonntag, D. (1990): *Important new values of the physical constants of 1986,
vapour pressure formulations based on the ITS-90, and psychrometer formulae.*
Zeitschrift für Meteorologie 40 (5), 340–344.
→ Magnus-Koeffizienten des Sättigungsdampfdrucks über Wasser.

### `wmo-no8`
World Meteorological Organization: *Guide to Instruments and Methods of
Observation* (WMO-No. 8), CIMO Guide.
→ Psychrometergleichung und Psychrometerkonstante A = 6.53·10⁻⁴ K⁻¹ für
ventilierte Messung über Wasser.

### `ashrae-fundamentals-2021`
ASHRAE Handbook — Fundamentals, Kapitel *Psychrometrics*.
→ Enthalpie feuchter Luft, Bezugszustand, Gradstunden-Konzept.

### `en16798-1`
SN EN 16798-1: *Energetische Bewertung von Gebäuden – Lüftung von Gebäuden.
Teil 1: Eingangsparameter für das Innenraumklima*, Anhang B.
→ Gleitendes Aussentemperaturmittel Θrm, adaptives Komfortmodell,
Kategorien I bis III. Nachfolger von EN 15251.

### `sia180-2014`
SN 520 180 / SIA 180:2014: *Wärmeschutz, Feuchteschutz und Raumklima in
Gebäuden.*
→ Nachweis des sommerlichen Wärmeschutzes, Nachtlüftung.

> **Hinweis zu Normen.** EN 16798-1 und SIA 180 sind kostenpflichtige
> Normwerke. Dieses Projekt gibt ihren Text nicht wieder, sondern implementiert
> die darin beschriebenen Verfahren und benennt die Fundstelle. Wer das
> Ergebnis prüfen will, braucht die Norm — das ist der Preis dafür, dass die
> Rechnung normkonform bleibt.
