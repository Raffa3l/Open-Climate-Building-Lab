# Adaptiver Komfort nach EN 16798-1

Implementierung: [`core/src/indicators.ts`](../../core/src/indicators.ts)

Grundgedanke des adaptiven Modells: In frei laufenden Gebäuden passt sich die
Komforterwartung dem Aussenklima an. Was im März als zu warm empfunden wird,
ist im August angenehm. Das Modell macht diese Verschiebung rechenbar.

## Gleitendes Aussentemperaturmittel

$$\Theta_{rm} = (1-\alpha)\,\Theta_{ed-1} + \alpha\,\Theta_{rm-1}, \qquad \alpha = 0.8$$

Anlaufwert aus den sieben Vortagen mit den Normgewichten:

$$\Theta_{rm} = \frac{\Theta_{ed-1} + 0.8\,\Theta_{ed-2} + 0.6\,\Theta_{ed-3} + 0.5\,\Theta_{ed-4} + 0.4\,\Theta_{ed-5} + 0.3\,\Theta_{ed-6} + 0.2\,\Theta_{ed-7}}{3.8}$$

Die ersten sieben Tage einer Reihe bleiben `NaN`. Sie zu extrapolieren wäre
eine Erfindung, kein Ergebnis.

$\alpha = 0.8$ entspricht einer Halbwertszeit von rund drei Tagen. Der Test
verankert das an einem Temperatursprung: von 10 °C auf 20 °C ergibt der erste
Folgetag exakt 12 °C.

## Komfortband

$$\Theta_{o,max} = 0.33\,\Theta_{rm} + 18.8 + \Delta_{oben}$$
$$\Theta_{o,min} = 0.33\,\Theta_{rm} + 18.8 - \Delta_{unten}$$

| Kategorie | $\Delta_{oben}$ | $\Delta_{unten}$ |
|---|---|---|
| I | 2 K | 3 K |
| II | 3 K | 4 K |
| III | 4 K | 5 K |

Standard ist **Kategorie II** — Neubau und Sanierung im Normalfall.

### Gültigkeitsbereich

Das Band ist nur für $10\ °\text{C} \le \Theta_{rm} \le 30\ °\text{C}$ definiert.
Ausserhalb liefert die Implementierung `NaN` statt eines extrapolierten Werts.

Für Zürich/Fluntern 2024 heisst das konkret: an 203 von 366 Tagen ist das Band
definiert, die Obergrenze bewegt sich zwischen 25.1 °C und 29.5 °C.

## Übertemperaturstunden

**Die Grenzen beziehen sich auf die operative Raumtemperatur, nicht auf die
Aussentemperatur.**

Deshalb nimmt `exceedanceHours()` das Ergebnis des Raummodells entgegen, und
zwar als `Computation` aus `simulate5R1C()`, nicht als nackte Reihe. Würde man
ersatzweise die Aussentemperatur einsetzen, käme eine plausibel aussehende und
vollständig falsche Zahl heraus. Seit Version 2.0.0 verhindert das der Typ.

$$\text{ÜTS} = \left|\{i \in \text{Belegung} : \Theta_{o,i} > \Theta_{o,max}(d_i)\}\right|$$

Mitgeführt werden zusätzlich die Kelvinstunden der Überschreitung — eine
Überschreitung um 0.2 K ist etwas anderes als eine um 5 K — und die Zahl der
überhaupt bewerteten Stunden.

### Eingänge und Identität

Die Funktion baut auf zwei Berechnungen auf und führt beide als Vorgänger
([ADR 0007](../adr/0007-verkettete-berechnungs-hashes.md)):

| Rolle | Berechnung | Beitrag |
|---|---|---|
| `simulation` | `building.simulate5R1C` | Operative Raumtemperatur, Raumparameter, Einschwingphase |
| `comfortBand` | `comfort.adaptiveComfortBand` | Obergrenze je Tag und Kategorie |

Das Komfortband führt seinerseits das gleitende Mittel als Vorgänger
(`runningMean`), damit α in seinen Hash eingeht.

Der Berechnungs-Hash umfasst damit die ganze Kette. Vor 2.0.0 standen die
Raumparameter nur im Hash der Simulation: 40 % und 70 % Fensteranteil ergaben
in Zürich/Fluntern 2024 403 und 662 Übertemperaturstunden unter demselben Hash.

**Die Einschwingphase verwirft die Funktion selbst.** Aus den abgeleiteten
Kenngrössen der Simulation bestimmt sie dieselbe Stundenzahl wie
`warmupHours()` und legt sie in `params.warmupHours` ab. **Die Kategorie**
kommt aus dem Komfortband und wird nicht ein zweites Mal angegeben, weil sich
zwei Angaben widersprechen könnten.

### Tageswerte

Dieselben Grössen gibt die Funktion auch **je lokalem Tag** zurück:
`dailyHours` und `dailyKelvinHours`. Sie entstehen in derselben Schleife wie
die Jahressummen und summieren deshalb immer auf die Kennzahl.

Wer Tagesstunden ausserhalb nachzählt, braucht eine eigene Zuordnung von
Stunde zu Lokalzeit und driftet ab, sobald eine Quelle eine andere
Zeitkonvention hat. Das Frontend hat die Tagesstunden bis 13.09.2026 selbst
aus dem Zeitstempel abgeleitet. Für Messreihen (Stempel am Intervallende) war
das zufällig richtig. Für die DRY-Szenarien (Intervallbeginn, Stichzeitpunkt
hh:10, siehe [009](009-klimaszenarien.md)) lag das Belegungsfenster eine Stunde
zu früh: In Zürich/Fluntern wies die Tabelle 423 statt 369 Stunden aus (2035
RCP 8.5) und 529 statt 465 (2060 RCP 8.5). Die Kennzahl selbst war nie
betroffen.

An Tagen ohne eine einzige bewertete Stunde, etwa weil das Komfortband
undefiniert ist, stehen beide Werte auf `NaN`. «Nicht bewertet» ist etwas
anderes als «keine Überschreitung».

Die Tageswerte kamen **ohne Versionssprung** hinzu. Für gleiche Eingaben ändert
sich keine bestehende Zahl, und die Version geht in den Berechnungs-Hash ein:
Ein Sprung hätte jeden Permalink gebrochen, ohne dass sich ein publizierter
Wert verändert hätte. Der Sprung auf 2.0.0 kam danach mit ADR 0007, aus einem
anderen Grund: Die Signatur wurde inkompatibel, und der Hash sollte sich ändern.

## Verhältnis zu SIA 180

SIA 180 kennt einen eigenen Nachweis des sommerlichen Wärmeschutzes mit eigenen
Grenzkurven. Die Umsetzung ist v1; für v0 wird EN 16798-1 verwendet, weil das
Verfahren europäisch harmonisiert und breiter zitierbar ist.

Wo beide Verfahren vorliegen, sind sie **nebeneinander** auszuweisen. Die
Differenz zwischen ihnen ist selbst eine interessante Grösse, keine
Ungenauigkeit.
