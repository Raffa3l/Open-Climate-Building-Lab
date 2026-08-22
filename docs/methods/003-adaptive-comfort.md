# Adaptiver Komfort nach EN 16798-1

Implementierung: [`core/src/indicators.ts`](../../core/src/indicators.ts)

Grundgedanke des adaptiven Modells: In frei laufenden Gebäuden passt sich die
Komforterwartung dem Aussenklima an. Was im März als zu warm empfunden wird,
ist im August angenehm. Das Modell macht diese Verschiebung rechenbar.

## Gleitendes Aussentemperaturmittel

$$\Theta_{rm} = (1-\alpha)\,\Theta_{ed-1} + \alpha\,\Theta_{rm-1}, \qquad \alpha = 0{,}8$$

Anlaufwert aus den sieben Vortagen mit den Normgewichten:

$$\Theta_{rm} = \frac{\Theta_{ed-1} + 0{,}8\,\Theta_{ed-2} + 0{,}6\,\Theta_{ed-3} + 0{,}5\,\Theta_{ed-4} + 0{,}4\,\Theta_{ed-5} + 0{,}3\,\Theta_{ed-6} + 0{,}2\,\Theta_{ed-7}}{3{,}8}$$

Die ersten sieben Tage einer Reihe bleiben `NaN`. Sie zu extrapolieren wäre
eine Erfindung, kein Ergebnis.

$\alpha = 0{,}8$ entspricht einer Halbwertszeit von rund drei Tagen. Der Test
verankert das an einem Temperatursprung: von 10 °C auf 20 °C ergibt der erste
Folgetag exakt 12 °C.

## Komfortband

$$\Theta_{o,max} = 0{,}33\,\Theta_{rm} + 18{,}8 + \Delta_{oben}$$
$$\Theta_{o,min} = 0{,}33\,\Theta_{rm} + 18{,}8 - \Delta_{unten}$$

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
definiert, die Obergrenze bewegt sich zwischen 25,1 °C und 29,5 °C.

## Übertemperaturstunden

**Die Grenzen beziehen sich auf die operative Raumtemperatur, nicht auf die
Aussentemperatur.**

Deshalb ist `exceedanceHours()` eine getrennte Funktion, die eine
Raumtemperaturreihe verlangt. Solange kein Raummodell existiert, lässt sich
diese Kennzahl nicht berechnen — und genau so soll es sein. Würde man
ersatzweise die Aussentemperatur einsetzen, käme eine plausibel aussehende und
vollständig falsche Zahl heraus.

Die Funktion ist bereits vorhanden und geprüft. Sie ist die Schnittstelle, an
der das 5R1C-Raummodell nach ISO 52016-1 andocken wird.

$$\text{ÜTS} = \left|\{i \in \text{Belegung} : \Theta_{o,i} > \Theta_{o,max}(d_i)\}\right|$$

Mitgeführt werden zusätzlich die Kelvinstunden der Überschreitung — eine
Überschreitung um 0,2 K ist etwas anderes als eine um 5 K — und die Zahl der
überhaupt bewerteten Stunden.

## Verhältnis zu SIA 180

SIA 180 kennt einen eigenen Nachweis des sommerlichen Wärmeschutzes mit eigenen
Grenzkurven. Die Umsetzung ist v1; für v0 wird EN 16798-1 verwendet, weil das
Verfahren europäisch harmonisiert und breiter zitierbar ist.

Wo beide Verfahren vorliegen, sind sie **nebeneinander** auszuweisen. Die
Differenz zwischen ihnen ist selbst eine interessante Grösse, keine
Ungenauigkeit.
