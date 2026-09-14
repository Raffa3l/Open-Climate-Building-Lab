# Quellen

Die Schlüssel dieser Liste erscheinen im Feld `sources` jedes `MethodRef` im
Rechenkern. Wer einen publizierten Wert prüfen will, findet über den Schlüssel
die Primärquelle.

## Daten

### `meteoschweiz-ogd-smn`
Bundesamt für Meteorologie und Klimatologie MeteoSchweiz:
*Automatische Wetterstationen – Messwerte* (SwissMetNet).
STAC-Collection `ch.meteoschweiz.ogd-smn`, <https://data.geo.admin.ch>.
**Lizenz: CC BY 4.0.** 158 Stationen, Stundenwerte seit 1980 in
Zehnjahresdateien.

### `meteoschweiz-ogd-ch2025`
MeteoSchweiz / ETH Zürich / C2SM unter dem Dach des NCCS:
*Klimaszenarien CH2025 pro Station (DAILY-LOCAL)*, publiziert 4. November 2025.
STAC-Collection `ch.meteoschweiz.ogd-climate-scenarios-ch2025`.
**Lizenz: CC BY 4.0.** Tageswerte, gegliedert nach Erwärmungsniveaus
(`gwl1.5`, `gwl2.0`, `gwl2.5`, `gwl3.0`) statt nach RCP und Zeitperiode.

### `meteoschweiz-klimaindikatoren`
MeteoSchweiz, Definitionen der Klimaindikatoren (Hitzetag, Sommertag,
Tropennacht, Frosttag).

## Was eine vollständige Quellenangabe enthalten muss

Sowohl CC BY 4.0 als auch die opendata.swiss-Stufe `terms_by` verlangen mehr
als einen Namen. Nach den Nutzungsbedingungen sind es **Autor, Titel und Link
zum Datensatz**; CC BY 4.0 verlangt zusätzlich die Nennung der Lizenz.

Der Rechenkern führt diese Angaben deshalb als eigene Felder im `DatasetRef`
(`attribution`, `title`, `url`, `license`) mit, statt sie als freien Text zu
behandeln. Wer abgeleitete Werte publiziert, kann sie damit vollständig
ausweisen — im Frontend steht das unter «Berechnung anzeigen».

## Weitere Datensätze

### `meteoschweiz-raumklima` — geklärt, nutzbar
*Klimaszenarien fürs zukünftige Innenraumklima (SIA 2028)*,
Collection `ch.meteoschweiz.klimaszenarien-raumklima`. 45 Stationen, stündlich,
Design Reference Years und warme Sommer für die Perioden 2020–2049 und
2045–2074, auf CH2018 basierend. Erstellt von MeteoSchweiz, Baudirektion
Kanton Zürich, BAFU, SIA und HSLU.

**Nutzungsbedingung: „Freie Nutzung. Quellenangabe ist Pflicht."**
([opendata.swiss](https://opendata.swiss/de/dataset/klimaszenarien-furs-zukunftige-innenraumklima-sia-2028),
Stufe `terms_by`)

Der Wortlaut der Stufe nach den
[Nutzungsbedingungen von opendata.swiss](https://opendata.swiss/de/terms-of-use):

> Sie dürfen diesen Datensatz für nicht kommerzielle Zwecke nutzen.
> Sie dürfen diesen Datensatz für kommerzielle Zwecke nutzen.
> Eine Quellenangabe ist Pflicht (Autor, Titel und Link zum Datensatz).

Damit ist der Datensatz **auch kommerziell nutzbar und weitergebbar**, sofern
die Quelle vollständig genannt wird. Es ist ausdrücklich **nicht** eine der
beiden eingeschränkten Stufen, die für kommerzielle Nutzung eine Bewilligung
des Datenlieferanten verlangen.

#### Zum früheren Widerspruch

Der STAC-Katalog auf `data.geo.admin.ch` führt die Collection als
`proprietary`. Das ist **kein Widerspruch**, sondern eine Eigenheit des
STAC-Vokabulars: `proprietary` bedeutet dort lediglich „keine
SPDX-Standardkennung", und der hinterlegte Lizenzlink zeigt auf die
allgemeinen Nutzungsbedingungen des Bundes. Die Angabe ist uninformativ, nicht
einschränkend.

Massgeblich ist der OGD-Eintrag auf opendata.swiss: Dort tragen alle sieben
Ressourcen — einschliesslich „Daten aller 45 Stationen" — die Stufe
`terms_by`, und die Datensatzseite zeigt sie als sichtbares Abzeichen.

Geprüft am 22. August 2026 über die CKAN-API (`package_show`) und die
gerenderte Datensatzseite.

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

### `en-iso-13790-2008`
SN EN ISO 13790:2008: *Energieeffizienz von Gebäuden – Berechnung des
Energiebedarfs für Heizung und Kühlung*, Anhang C, Simple Hourly Method.
→ Raummodell 5R1C, Normkonstanten h_is, h_ms, Λ_at, Bauartklassen Tabelle 12.

**Abgelöst durch ISO 52016-1**, die ein anderes, knotenbasiertes
Stundenverfahren verwendet. 5R1C ist hier bewusst gewählt: breit dokumentiert,
in vielen Werkzeugen umgesetzt, und mit den Kennwerten einer frühen
Planungsphase rechenbar. Siehe [006](006-room-model-5r1c.md#zur-normenlage).

### `michalsky1988`
Michalsky, J. J. (1988): *The Astronomical Almanac's algorithm for approximate
solar position (1950–2050).* Solar Energy 40 (3), 227–235.
→ Sonnenstand, Genauigkeit rund 0.01°.

### `noaa-solar`
NOAA Global Monitoring Laboratory, Solar Calculation Details.
→ Gebräuchliche Fassung des Michalsky-Verfahrens, Sternzeitformulierung.

### `erbs1982`
Erbs, D. G.; Klein, S. A.; Duffie, J. A. (1982): *Estimation of the diffuse
radiation fraction for hourly, daily and monthly-average global radiation.*
Solar Energy 28 (4), 293–302.
→ Zerlegung der Globalstrahlung in Direkt- und Diffusanteil über den
Klarheitsindex. Rückfallebene, wo `ods000h0` nicht gemessen wird.

### `perez1990`
Perez, R.; Ineichen, P.; Seals, R.; Michalsky, J.; Stewart, R. (1990):
*Modeling daylight availability and irradiance components from direct and
global irradiance.* Solar Energy 44 (5), 271–289.
→ Anisotropes Himmelsmodell, Koeffiziententabelle über die Himmelsklarheit ε.

### `kasten-young-1989`
Kasten, F.; Young, A. T. (1989): *Revised optical air mass tables and
approximation formula.* Applied Optics 28 (22), 4735–4738.
→ Relative optische Luftmasse; bleibt bei tiefem Sonnenstand endlich, anders
als die Näherung 1/cos Z.

### `liu-jordan-1963`
Liu, B. Y. H.; Jordan, R. C. (1963): *The long-term average performance of
flat-plate solar energy collectors.* Solar Energy 7 (2), 53–74.
→ Isotropes Himmelsmodell für die Einstrahlung auf geneigte Flächen.

### `sia180-2014`
SN 520 180 / SIA 180:2014: *Wärmeschutz, Feuchteschutz und Raumklima in
Gebäuden.*
→ Nachweis des sommerlichen Wärmeschutzes, Nachtlüftung.

### `iso-9060-2018`
ISO 9060:2018: *Solar energy — Specification and classification of instruments
for measuring hemispherical solar and direct solar radiation.*
→ Zulässiger Nullpunktversatz eines Pyranometers auf −200 W/m²
Nettowärmestrahlung («zero offset a»): Klasse A ±7 W/m², B ±15 W/m², C ±30 W/m².
Begründet die untere Gültigkeitsgrenze der Strahlung, siehe
[004](004-binary-format.md#negative-strahlung-ist-ein-messwert). Die Grenzwerte
sind aus der Klassentabelle bei Apogee Instruments übernommen,
<https://www.apogeeinstruments.com/content/ISO_9060_Apogee_Comparison.pdf>,
abgerufen am 14.09.2026; der Normtext selbst lag nicht vor.

> **Hinweis zu Normen.** EN 16798-1 und SIA 180 sind kostenpflichtige
> Normwerke. Dieses Projekt gibt ihren Text nicht wieder, sondern implementiert
> die darin beschriebenen Verfahren und benennt die Fundstelle. Wer das
> Ergebnis prüfen will, braucht die Norm — das ist der Preis dafür, dass die
> Rechnung normkonform bleibt.
