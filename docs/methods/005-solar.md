# Sonnenstand und Einstrahlung

Implementierung: [`core/src/solar.ts`](../../core/src/solar.ts)
Prüfung: [`core/test/solar.test.ts`](../../core/test/solar.test.ts)

Winkelkonvention durchgehend:

| Grösse | Konvention |
|---|---|
| Höhe | 0° = Horizont, 90° = Zenit |
| Azimut | 0° = Nord, 90° = Ost, **180° = Süd**, 270° = West |
| Neigung | 0° = horizontal, 90° = senkrecht |

Das ist die meteorologische Azimutkonvention. Wer eine Fassade nach Süden
ausrichtet, schreibt `azimuth: 180` — nicht 0, wie es Teile der
bauphysikalischen Literatur handhaben.

## Sonnenstand

Verfahren nach Michalsky (1988) in der NOAA-Fassung: mittlere Länge und
Anomalie aus den Tagen seit J2000.0, daraus ekliptikale Länge, Rektaszension
und Deklination, dann über die mittlere Sternzeit Greenwich der Stundenwinkel.

Genauigkeit rund 0.01° — für Gebäudesimulation um Grössenordnungen mehr als
nötig, aber der Rechenaufwand ist derselbe wie bei einer gröberen Näherung.

**Der übergebene Zeitpunkt muss die Intervallmitte sein**, nicht der
Rohdaten-Zeitstempel. Siehe [Zeitkonventionen](000-time-conventions.md);
`intervalMidpointUtcMs()` liefert ihn.

### Verankerte Stützstellen für Zürich/Fluntern (47.381° N, 8.567° O)

Die Mittagshöhe ist 90° − Breite + Deklination, also astronomisch nachprüfbar:

| Datum | Mittagshöhe | Tageslänge |
|---|---|---|
| 21. Juni | 66.06° | 15.9 h |
| 21. Dezember | 19.18° | 8.5 h |
| Äquinoktium | 42.62° | 12 h |

Zusätzlich geprüft: Deklination erreicht an den Wendepunkten ±23.44°, der
Azimut zur Kulmination liegt bei 180°, und die Kulmination fällt auf den wahren
Ortsmittag — für Zürich rund 34 Minuten vor 12:00 UTC.

## Zerlegung in direkt und diffus

Nötig, weil längst nicht jede SMN-Station die Diffusstrahlung misst. Bei
Zürich/Fluntern fehlt `ods000h0` **vollständig** — die Spalte existiert, ist
aber über das ganze Jahr leer.

Korrelation nach Erbs et al. (1982) über den Klarheitsindex
$k_t = G / G_0$ mit $G_0$ = extraterrestrische Strahlung auf die Horizontale:

$$
k_d = \begin{cases}
1.0 - 0.09\,k_t & k_t \le 0.22 \\
0.9511 - 0.1604\,k_t + 4.388\,k_t^2 - 16.638\,k_t^3 + 12.336\,k_t^4 & 0.22 < k_t \le 0.80 \\
0.165 & k_t > 0.80
\end{cases}
$$

$$G_0 = 1367 \cdot \left(1 + 0.033\cos\frac{2\pi\,n}{365}\right) \cdot \sin(h_s)$$

**Wo die Diffusstrahlung gemessen vorliegt, ist der Messwert vorzuziehen.** Das
Raummodell nimmt sie entgegen und greift nur ersatzweise auf Erbs zurück; der
Report weist aus, welcher Weg verwendet wurde.

Geprüft ist die Monotonie über den gesamten Bereich: mit zunehmender Klarheit
fällt der Diffusanteil streng.

## Einstrahlung auf geneigte Flächen

Zwei Modelle stehen zur Wahl, als **getrennte Verfahren mit eigener
`MethodRef`** — nicht als zwei Versionen desselben. So bleiben Werte beider
Modelle nebeneinander zuordenbar.

### Direktanteil, beiden gemeinsam

$$I_{bn} = \min\left(\frac{I_{b,hor}}{\sin h_s},\ I_{bn,max}\right), \qquad I_\beta^{beam} = I_{bn}\max(0, \cos\theta)$$

mit dem Einfallswinkel

$$\cos\theta = \cos h_s \sin\beta \cos(\gamma_s - \gamma_f) + \sin h_s \cos\beta$$

**Die Obergrenze $I_{bn,max} = 1.035 \cdot 1367\ \text{W/m²}$ ist nicht
kosmetisch.** Die Zerlegung teilt durch $\sin h_s$; bei flachem Sonnenstand
geht der Nenner gegen null, während ein womöglich fehlerhaft gemessener Zähler
stehen bleibt. Ohne Grenze entstehen Einstrahlungen von mehreren tausend W/m².
Die Grenze ist die extraterrestrische Bestrahlungsstärke im Perihel — mehr kann
am Boden unter keinen Umständen ankommen.

An den SwissMetNet-Daten von Zürich/Fluntern greift sie in **5 von 26'078
Sonnenstunden** (0.019 %); der höchste unbegrenzte Wert lag bei 1561 W/m².
Selten, aber real.

Zusätzlich wird der Direktanteil unterhalb $\sin h_s = 0.01$ (etwa 0.6°
Sonnenhöhe) ganz auf null gesetzt.

### Isotropes Himmelsmodell

Nach Liu & Jordan (1963) — der Himmel strahlt aus allen Richtungen gleich:

$$I_\beta = I_\beta^{beam} + I_d \frac{1 + \cos\beta}{2} + G \rho \frac{1 - \cos\beta}{2}$$

Einfach und robust, aber es kennt weder die Aufhellung um die Sonne noch den
helleren Horizontstreifen. Auf sonnenzugewandten Fassaden unterschätzt es
deshalb bei klarem Himmel.

### Anisotropes Himmelsmodell nach Perez

Perez et al. (1990) zerlegen die Diffusstrahlung in drei Anteile:

$$I_{d,\beta} = I_d\left[(1 - F_1)\frac{1 + \cos\beta}{2} + F_1\frac{a}{b} + F_2 \sin\beta\right]$$

| Term | Bedeutung |
|---|---|
| $(1-F_1)\frac{1+\cos\beta}{2}$ | isotroper Rest |
| $F_1 \frac{a}{b}$ | **zirkumsolare Aufhellung** — der helle Bereich um die Sonne |
| $F_2 \sin\beta$ | **Horizontaufhellung** |

mit $a = \max(0, \cos\theta)$ und $b = \max(\cos 85°, \sin h_s)$; die
Begrenzung von $b$ hält den zirkumsolaren Term bei streifendem Einfall endlich.

Die Koeffizienten $F_1, F_2$ folgen aus Himmelsklarheit ε und -helligkeit Δ:

$$\varepsilon = \frac{(I_d + I_{bn})/I_d + \kappa Z^3}{1 + \kappa Z^3}, \qquad \kappa = 1.041,\ Z\ \text{in rad}$$

$$\Delta = \frac{I_d \cdot m}{I_0}$$

Die Luftmasse $m$ folgt Kasten & Young (1989) statt der Näherung $1/\cos Z$,
die bei tiefem Sonnenstand entgleist. ε reicht von 1 bei völlig bedecktem
Himmel bis über 6 bei sehr klarem; daraus wählt eine Achtertabelle
(Perez 1990, Tabelle 6) die sechs Koeffizienten.

**Bei bedecktem Himmel geht Perez in das isotrope Modell über** — ε → 1 macht
$F_1$ und $F_2$ klein. Im Test verankert.

### Validierung an Jahressummen

Jahressumme der Einstrahlung, kWh/m², Zürich/Fluntern:

| Fläche | 2019 | 2021 | 2023 | Modell |
|---|---|---|---|---|
| horizontal | 1253 | 1198 | 1252 | isotrop |
| horizontal | 1253 | 1197 | 1252 | **Perez** |
| Süd 90° | 959 | 908 | 937 | isotrop |
| Süd 90° | 1033 | 979 | 1008 | **Perez** |
| Süd 30° geneigt | 1412 | 1340 | 1399 | isotrop |
| Süd 30° geneigt | 1476 | 1403 | 1462 | **Perez** |
| Ost 90° | 723 | 687 | 708 | isotrop |
| Ost 90° | 749 | 709 | 731 | **Perez** |
| Nord 90° | 415 | 411 | 419 | isotrop |
| Nord 90° | 369 | 360 | 371 | **Perez** |

Drei Prüfungen daraus:

1. **Horizontal ist in beiden Modellen identisch.** Das muss so sein — auf der
   Horizontalen reduzieren sich beide auf die Globalstrahlung. Die Zeile ist
   der schärfste Selbsttest der Implementierung.
2. **Die Richtung stimmt.** Perez hebt sonnenzugewandte Flächen (Süd +8 %,
   Ost und West +4 %, 30° geneigt +5 %) und senkt Nord um 12 %. Genau das ist
   das bekannte Verhalten anisotroper gegenüber isotropen Modellen: Das
   isotrope Modell verteilt zu viel Diffusstrahlung auf abgewandte Flächen.
3. **Die Grössenordnung passt.** Für Zürich liegen publizierte Werte bei rund
   1150–1250 kWh/m² horizontal, 900–1000 auf der Südfassade und 1350–1450 bei
   30° Südneigung. Die Werte liegen am oberen Rand — Fluntern liegt erhöht,
   und 2019 und 2023 waren überdurchschnittlich sonnige Jahre.

### Wirkung auf die Überhitzung

Südbüro Zürich 2023, Sonnenschutz und Nachtlüftung aktiv:

| Fall | ÜTS | θ_op max |
|---|---|---|
| Neubau, isotrop | 480 | 36.15 |
| Neubau, **Perez** | 501 | 36.32 |
| Altbau, isotrop | 140 | 34.36 |
| Altbau, **Perez** | 148 | 34.32 |

Rund **4 bis 6 % mehr Übertemperaturstunden** — das isotrope Modell lag auf der
optimistischen Seite, wie erwartet. Der Effekt ist moderat, weil der
Sonnenschutz ohnehin 70 % der Einstrahlung wegnimmt und die hohe Sommersonne
ungünstig auf senkrechte Südflächen trifft.

Perez ist seit `building.simulate5R1C@1.2.0` der Standard. `skyModel: "isotrop"`
schaltet zurück.

### Was weiterhin fehlt

Verschattung durch Umgebung, Horizont und Auskragungen. Beide Modelle
unterstellen freie Sicht auf den ganzen Himmel — in einer Strassenschlucht ist
das deutlich falsch.
