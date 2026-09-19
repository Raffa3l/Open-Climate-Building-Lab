# Mehrjahresverlauf

Umsetzung: [`core/src/trend.ts`](../../core/src/trend.ts), die Auswahl der Jahre
in [`core/src/reference-case.ts`](../../core/src/reference-case.ts)
(`isCompleteMeasuredYear`), im Frontend unter «Übertemperaturstunden je
Messjahr», aus der Kommandozeile mit
[`core/scripts/trend.ts`](../../core/scripts/trend.ts)
Prüfung: [`core/test/trend.test.ts`](../../core/test/trend.test.ts)

## Worum es geht

Derselbe Raum in jedem Messjahr einer Station, und wie sich seine
Übertemperaturstunden über die Jahre verschoben haben. Das ist die Frage, mit
der das Projekt begann ([ADR 0004](../adr/0004-v0-nur-vergangenheit.md)): wie
stark sich das Raumklima an *meiner* Station wirklich verändert hat, gemessen
statt projiziert.

## Welche Jahre

Ein Jahr geht ein, wenn es fürs Raummodell taugt (`roomModelYears`) und
Temperatur und Globalstrahlung zu mindestens 95 % vorliegen. Seit
`simulate5R1C` 1.4.0 rechnet ein Jahr mit Strahlungslücken weniger Stunden
([006](006-room-model-5r1c.md#fehlende-messwerte)) und läge im Vergleich zu
tief. Ausgelassene Jahre nennt das Frontend mit ihrer Strahlungsvollständigkeit,
etwa Grenchen 2010 mit 7 %. Dieselbe Regel gilt in `stations.ts`,
`climate-change.ts` und `trend.ts`.

Jede Säule ist genau die Auswertung, die das obere Diagramm für dieses Jahr
zeigt, unter demselben Hash.

## Trend

Eine Gerade nach der Methode der kleinsten Quadrate über Jahr x und
Übertemperaturstunden y:

$$b = \frac{\sum (x_i - \bar x)(y_i - \bar y)}{\sum (x_i - \bar x)^2}, \qquad a = \bar y - b\,\bar x, \qquad r^2 = \frac{\left(\sum (x_i - \bar x)(y_i - \bar y)\right)^2}{\sum (x_i - \bar x)^2 \sum (y_i - \bar y)^2}$$

Angegeben wird 10 · b in Stunden pro Jahrzehnt, dazu das Bestimmtheitsmass r².
Unter drei Jahren gibt es keine Gerade, sondern `NaN`.

Der Trend ist eine eigene `Computation` (`stats.linearTrend`). Jede
Jahresauswertung hängt als Vorgänger mit der Rolle `y<Jahr>` darin
([ADR 0007](../adr/0007-verkettete-berechnungs-hashes.md)). Der Hash kennt damit
Raum, Bewertung und jeden Datensatz; ein anderes Jahr, ein anderer Regler oder
ein neu gepacktes Stationsjahr ergibt einen anderen.

**Verankert** an Anscombe (1973)
([`anscombe-1973`](sources.md#anscombe-1973)): Seine vier Datensätze ergeben
alle die Gerade y = 3.00 + 0.500 x mit r = 0.816. Der Test rechnet alle vier
nach.

## Normalperiode

Das Mittel der Übertemperaturstunden über 1991–2020 ist eine eigene
`Computation` (`stats.periodMean`), mit jedem Jahr der Periode als Vorgänger im
Hash. Es gilt erst ab 24 der 30 Jahre; darunter kommt `NaN`, und das Frontend
nennt, wie viele Jahre fehlen. Die Schwelle von 80 % ist eine Festlegung dieses
Projekts und steht in den Parametern.

**Verankert** an Anscombe (1973): Das Mittel von y ist in allen vier
Datensätzen 7.50.

## Szenarien

An den Szenariostationen stehen rechts neben den Messjahren die DRY-Szenarien
2035 RCP 8.5, 2060 RCP 2.6 und 2060 RCP 8.5, je als Referenzjahr und als warmer
Sommer (1 in 10). Jedes rechnet derselbe Raum mit seinem eigenen Komfortband,
wie im Vergleichsmodus.

**Ein Szenario ist gegen die Normalperiode zu lesen**, nicht gegen ein einzelnes
Jahr und nicht gegen den Trend. Ein Referenzjahr ist ein synthetisches typisches
Jahr, kein Mittel gemessener Jahre, und CH2018 ist auf eine ältere Periode
kalibriert ([009](009-klimaszenarien.md)). Deshalb läuft die Linie des Mittels
1991–2020 über die ganze Breite, auch unter den Szenarien.

Zürich/Fluntern, Voreinstellung, gegen das Mittel 1991–2020 von 343 h:

| Szenario | Referenzjahr | warmer Sommer |
|---|---:|---:|
| 2035 RCP 8.5 | 369 h (+26) | 456 h (+113) |
| 2060 RCP 2.6 | 336 h (−7) | 428 h (+85) |
| 2060 RCP 8.5 | 465 h (+122) | 624 h (+281) |

Dieselben Zahlen wie in `climate-change.ts`. Das Mittel der gemessenen Jahre
2015–2024 liegt mit 425 h bereits nahe am Referenzjahr 2060 RCP 8.5; das
bestätigt, was 009 für die Temperatur feststellt: Die beobachtete Erwärmung ist
der Projektion vorausgeeilt.

## Ergebnis Zürich/Fluntern

Voreinstellung des Frontends, 34 Messjahre:

| | |
|---|---:|
| Trend | +46 h pro Jahrzehnt |
| r² | 0.31 |
| Mittel 1991–2000 | 289 h |
| Mittel 2015–2024 | 425 h |
| höchstes Jahr | 2003 mit 526 h |
| tiefstes Jahr | 2014 mit 225 h |

Hash des Trends: `da1e06638c63`, des Mittels 1991–2020: `a73a027472b3`. Browser
und `trend.ts` ergeben dieselben.

## Lesart und Grenzen

**Die Gerade beschreibt die mittlere Verschiebung, keine Vorhersage.** Ein
r² von 0.31 heisst, dass gut zwei Drittel der Streuung von Jahr zu Jahr kommen,
nicht vom Trend. Ein Signifikanztest ist nicht Teil des Verfahrens.

**Die Eingänge wechseln über die Jahre.** Alte Jahre führen keine gemessene
Diffusstrahlung und Himmelstemperatur; das Modell nimmt dort Erbs und den
Pauschalwert der Norm, neuere Jahre die Messung. Gemessen am 19.09.2026, Trend
in h pro Jahrzehnt:

| Station | wie gemessen | alle Jahre mit Erbs und Pauschalwert |
|---|---:|---:|
| Zürich/Fluntern | 46.3 | 47.2 |
| Basel/Binningen | 56.0 | 58.6 |
| Lugano | 99.1 | 100.1 |
| Genève/Cointrin | 50.0 | 54.2 |
| Bern/Zollikofen | 39.9 | 42.4 |

Der Wechsel dämpft den Trend um 1 bis 4 h pro Jahrzehnt, 2 bis 8 %. Gerechnet
wird trotzdem mit dem, was jedes Jahr misst: Sonst wäre eine Säule nicht mehr
dasselbe Jahr wie im oberen Diagramm.

**Die stündlichen Messwerte sind nicht homogenisiert.** Ein Standortwechsel
oder ein neues Messgerät erscheint im Verlauf wie eine Klimaänderung.

**Die bewerteten Stunden schwanken.** Das adaptive Komfortband ist nur bei
einem gleitenden Mittel zwischen 10 und 30 °C definiert
([003](003-adaptive-comfort.md)); ein kühler Frühsommer bewertet weniger
Stunden. Die Tabelle nennt sie für jedes Jahr.
