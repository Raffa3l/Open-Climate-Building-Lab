# Hitze- und Kühlkennwerte

Implementierung: [`core/src/indicators.ts`](../../core/src/indicators.ts)
Prüfung: [`core/test/indicators.test.ts`](../../core/test/indicators.test.ts)

Alle Schwellenwerte sind Parameter mit dokumentiertem Standardwert. Wer eine
Zahl publiziert, publiziert über die Provenance zwingend auch die Definition,
unter der sie gilt — das ist der ganze Punkt.

## Tagesaggregation

`dailyMean()` bildet das **arithmetische Mittel der 24 Stundenwerte**, nicht
$(T_{min}+T_{max})/2$. Die beiden Definitionen unterscheiden sich in der
Schweiz um mehrere Zehntel Kelvin, und die Differenz wandert direkt in das
gleitende Mittel des Komfortmodells.

Ein Tag mit auch nur einer fehlenden Stunde ergibt `NaN`. Ein aus 23 Stunden
gemitteltes Tagesmittel sähe plausibel aus und wäre doch ein anderer Kennwert.

## Sommer- und Hitzetage

Tage, an denen das **Tagesmaximum** die Schwelle erreicht:

| Kennwert | Schwelle |
|---|---|
| Sommertag | $T_{max} \ge 25\ °\text{C}$ |
| Hitzetag | $T_{max} \ge 30\ °\text{C}$ |

Die Schwelle ist inklusiv — im Test verankert, weil das je nach Quelle
unterschiedlich gehandhabt wird.

## Tropennächte

Nächte, in denen die Temperatur im Fenster **18:00–06:00 Lokalzeit** nicht
unter 20 °C fällt.

Nacht $n$ umfasst die Stunden 18–23 des Tages $n$ und 0–5 des Tages $n{+}1$,
also zwölf Stunden. Angebrochene Nächte am Rand der Reihe zählen nicht mit:
die letzte Nacht eines Jahresfiles hat nur sechs Stunden und wird verworfen.
Ein Jahr kann deshalb höchstens 364 Tropennächte enthalten.

Fehlt auch nur eine Stunde des Fensters, wird die Nacht nicht gewertet.
Andernfalls würde eine Nacht mit ausgefallener Morgenmessung fälschlich als
tropisch gezählt.

**Dieser Kennwert hängt an der Zeitkonvention.** Eine um eine Stunde
verschobene Achse verändert das Ergebnis messbar — siehe
[Zeitkonventionen](000-time-conventions.md).

## Kühlgradstunden

$$\text{KGh} = \sum_{i} \max(0,\ T_i - T_{Basis})\ \text{[Kh]}$$

Standardbasis **22 °C**. Das ist eine Konvention, keine Naturkonstante: mit der
ASHRAE-Basis 18.3 °C ergeben sich deutlich andere Zahlen. Beide sind richtig,
solange die Basis mitpubliziert wird — sie steht in `params`.

Unterschreitungen werden nicht negativ akkumuliert.

## Nachtlüftungspotenzial

$$\text{NLP} = \sum_{i \in \text{Nacht}} \max(0,\ T_{Raum,ref} - T_{aussen,i})\ \text{[Kh]}$$

Standard: Fenster 22:00–06:00, Raumreferenz 24 °C.

Bewusst rein aussenklimatisch. Das ist das **Angebot** — das verfügbare
Temperaturgefälle. Wie viel davon ein Gebäude tatsächlich nutzt, hängt an
Speichermasse, Luftwechsel und Öffnungsquerschnitten und gehört in das
Raummodell, nicht in diese Kennzahl.

Die Zahl der gewerteten Stunden wird mitgeführt: ein Potenzial von 0 Kh bei
2920 gewerteten Stunden ist eine Aussage, bei 0 gewerteten Stunden ein Datenloch.

## Vollständigkeit

Jeder Kennwert führt `completeness` mit, den Anteil gültiger Eingangswerte.
Unter 0.9 ist eine Jahreszahl mit Vorsicht zu lesen; das gehört in der
Darstellung sichtbar gemacht und nicht weggerundet.
