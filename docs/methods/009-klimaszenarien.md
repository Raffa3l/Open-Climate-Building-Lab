# Klimaszenarien für das Innenraumklima

Implementierung: [`data/ocbl_data/dry.py`](../../data/ocbl_data/dry.py)
Prüfung: [`data/ocbl_data/qa.py`](../../data/ocbl_data/qa.py) — Strahlungsbilanz
Auswertung: [`core/scripts/climate-change.ts`](../../core/scripts/climate-change.ts)

## Was der Datensatz enthält

Collection `ch.meteoschweiz.klimaszenarien-raumklima`, erstellt von
MeteoSchweiz, Baudirektion Kanton Zürich, BAFU, SIA und HSLU auf Basis der
Klimaszenarien CH2018.

| | |
|---|---|
| Stationen | 45, davon 41 mit SwissMetNet-Messreihe |
| Perioden | 2035 (2020–2049), 2060 (2045–2074) |
| Szenarien | RCP 2.6 (nur 2060), RCP 8.5 |
| Typen | **DRY** (Design Reference Year) und **1 in 10 warmer Sommer** |
| Auflösung | stündlich, 8760 Werte |
| Grössen | Temperatur, Feuchte, Wind, Global-, Diffus- und Direktstrahlung, Bewölkung |

Lizenz: *„Freie Nutzung. Quellenangabe ist Pflicht."* — siehe
[sources.md](sources.md#meteoschweiz-raumklima--geklärt-nutzbar).

## Zwei rückwärts erschlossene Konventionen

**Weder die Zeitkonvention noch die Definition der Strahlungsgrössen stehen in
der Metadatendatei.** Beide mussten empirisch bestimmt werden — genau die
Fehlerquelle, vor der [000](000-time-conventions.md) warnt.

### Zeitstempel: Intervallbeginn, Stichzeitpunkt +10 min

Die Spalten `time.yy/mm/dd/hh` tragen keine Zeitzonenangabe. Bestimmt wurde sie
über die geometrische Beziehung, die der Datensatz selbst mitliefert:

$$\text{gls} = \text{str.diffus} + \text{str.direkt} \cdot \sin(h_s)$$

Für Versätze von −120 bis +120 Minuten wurde der mittlere Betragsfehler dieser
Gleichung berechnet. Das Ergebnis ist ein scharfes Minimum:

| Versatz | Restfehler |
|---|---|
| −30 min | 26,91 W/m² |
| 0 min | 13,21 W/m² |
| **+10 min** | **9,62 W/m²** |
| +30 min | 18,87 W/m² |
| +60 min | 34,14 W/m² |

Geprüft an sechs Dateien über verschiedene Stationen, Perioden, Szenarien und
Typen — **+10 min ausnahmslos**, mit Restfehlern bis hinunter zu 1,03 W/m²
(Lugano).

Daraus folgt: Die Zeit ist **UTC**, der Stempel bezeichnet den
**Intervallbeginn**, und der für die Sonnengeometrie repräsentative Zeitpunkt
liegt bei `hh:10`.

> **Das ist die umgekehrte Konvention der SwissMetNet-Messreihen**, wo der
> Stempel das Intervall*ende* meint. Beide zu verwechseln verschiebt den
> Sonnenstand um eine volle Stunde. Deshalb trägt die Zeitachse den
> Stichzeitpunkt als eigenes Feld `sampleOffsetMin`, und jedes `.ocbl` führt
> ihn im Header mit — der Rechenkern muss die Herkunft nicht kennen.

### `str.direkt` ist die Direkt**normal**strahlung

Geprüft über dieselbe Beziehung:

| Annahme | mittlerer Betragsfehler |
|---|---|
| `str.direkt` horizontal | 105,17 W/m² |
| **`str.direkt` normal** | **13,65 W/m²** |

Eindeutig. Das Projekt speichert die Direktstrahlung nicht, sondern nur Global-
und Diffusstrahlung — das Raummodell leitet den Direktanteil selbst ab, genau
wie bei den Messdaten. `str.direkt` dient damit als **Kreuzprüfung**, nicht als
Eingang.

### Die Kreuzprüfung als laufende Kontrolle

`--qa` rechnet die Strahlungsbilanz beim Bauen nach. Typische Werte:

| Station | mittlerer Fehler |
|---|---|
| Lugano | 0,93 W/m² |
| Genève | 1,64 W/m² |
| Zürich/Fluntern | 9,44 W/m² |
| Scuol | 13,70 W/m² |

Scuol liegt in einem engen Alpental; die erhöhte Abweichung dürfte auf
Horizontverschattung in den Ausgangsdaten zurückgehen, die eine einfache
Zerlegung nicht abbildet. Sollte die Zeitkonvention je falsch werden, steigen
diese Werte um ein Vielfaches — die Prüfung ist damit ein Wächter, kein
einmaliger Nachweis.

## Das Schaltjahrproblem

Die Dateien haben **8760 Zeilen, also 365 Tage** — und kennen keinen
29. Februar. **2060 ist aber ein Schaltjahr.** Würde man die Reihe auf den
1. Januar 2060 legen, verschöben sich alle Datumsangaben ab dem 1. März um
einen Tag, und mit ihnen der Sonnenstand.

Gelegt wird deshalb auf das nächste **Nicht**-Schaltjahr: 2035 bleibt 2035,
2060 wird zu 2061. Der Unterschied in der Sonnendeklination zwischen
benachbarten Jahren liegt bei wenigen Zehntelgrad und ist gegenüber der Aussage
eines synthetischen Referenzjahres bedeutungslos. Die Periode wird als eigenes
Feld geführt und ist die Angabe, die zählt.

## Stationshöhen weichen ab

Die Metadaten des Szenariendatensatzes geben für Zürich/Fluntern **556 m** an,
das SwissMetNet-Verzeichnis **604 m**. Ähnliche Abweichungen gibt es an anderen
Stationen. Der Grund ist nicht dokumentiert; plausibel ist der Bezug auf einen
Modellgitterpunkt statt auf den Messstandort.

Für das Raummodell ist die Höhe nur über den Luftdruck relevant, und der wird
in den Szenariodaten ohnehin nicht mitgeliefert. Die Abweichung ist deshalb
folgenlos — sie gehört aber notiert, weil sie beim Vergleich zweier Kataloge
auffällt und sonst nach einem Fehler aussieht.

## Wie der Vergleich zu lesen ist

> **Ein Design Reference Year ist kein Mittel gemessener Jahre.** Es ist ein
> synthetisches *typisches* Jahr für eine Periode. Es gegen eine kurze Reihe
> beobachteter Jahre zu stellen ist nur dann aussagekräftig, wenn diese Reihe
> selbst lang genug ist, um typisch zu sein.

Beim ersten Lauf war die Basis die Jahre 2020–2024 — fünf Jahre mit zwei
Rekordsommern. Ihr Mittel von 10,9 °C lag über dem Szenario 2035 unter
RCP 8.5, und der Vergleich sah dadurch aus wie ein Rechenfehler. Die Basis
wurde deshalb auf die **Normalperiode 1991–2020** umgestellt; für die 41
Stationen mit beidem liegt die Messreihe ab 1991 vor.

### Zürich / Fluntern, Südbüro mit Sonnenschutz und Nachtlüftung

| Klimastand | Ø °C | Hitzetage | Tropennächte | ÜTS | θ_op max |
|---|---|---|---|---|---|
| **Basis 1991–2020** (30 Jahre) | 9,9 | 7 | 3 | 343 | 34,2 |
| gemessen 2021–2024 (4 Jahre) | 10,9 | 10 | 5 | 406 | 35,1 |
| 2035 · RCP 8.5 · Referenzjahr | 10,6 | 6 | 4 | 369 | 35,6 |
| 2035 · RCP 8.5 · warmer Sommer | 11,0 | 16 | 9 | 456 | 37,8 |
| 2060 · RCP 2.6 · Referenzjahr | 10,5 | 6 | 2 | 336 | 35,0 |
| 2060 · RCP 2.6 · warmer Sommer | 10,8 | 16 | 9 | 428 | 37,8 |
| **2060 · RCP 8.5 · Referenzjahr** | 11,7 | 19 | 14 | 465 | 37,5 |
| **2060 · RCP 8.5 · warmer Sommer** | 12,3 | 34 | 32 | 624 | 38,9 |

Drei Dinge stehen darin:

1. **Die beobachtete Erwärmung ist der Projektion vorausgeeilt.** Die vier
   Jahre 2021–2024 liegen mit 10,9 °C bereits über dem, was CH2018 für 2035
   unter RCP 8.5 als typisches Jahr ausweist (10,6 °C). Das ist kein
   Rechenfehler, sondern eine Aussage über die Kalibrierung der Szenarien —
   und ein Grund, die Referenzjahre eher als untere Schranke zu lesen.
2. **RCP 2.6 hält den Zustand von heute.** Das Referenzjahr 2060 unter
   RCP 2.6 liegt bei 336 Übertemperaturstunden und damit unter der
   Normalperiode. Der Unterschied zwischen den beiden Szenarien bei 2060 —
   336 gegen 465 Stunden — ist die eigentliche Aussage des Datensatzes.
3. **Tropennächte wachsen am stärksten.** Von 3 in der Normalperiode auf 14
   im Referenzjahr 2060 unter RCP 8.5 und auf 32 im warmen Sommer. Für die
   Nachtauskühlung, den grössten passiven Hebel, ist das die kritische Grösse.

Aussagekräftig bleiben in jedem Fall die **Vergleiche innerhalb des
Szenariensatzes**: 2060 RCP 8.5 gegen 2060 RCP 2.6, oder Referenzjahr gegen
warmen Sommer. Dort ist die Kalibrierung dieselbe, und die Differenz ist genau
das, was die Szenarien aussagen sollen.
