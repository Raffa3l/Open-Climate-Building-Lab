# Feuchte Luft

Implementierung: [`core/src/psychro.ts`](../../core/src/psychro.ts)
Prüfung: [`core/test/psychro.test.ts`](../../core/test/psychro.test.ts)

Einheiten durchgehend: Temperatur °C, Druck hPa, relative Feuchte %,
Feuchtegehalt kg/kg trockene Luft, Enthalpie kJ/kg trockene Luft.

## Sättigungsdampfdruck

Magnus-Formel mit den Koeffizienten nach Sonntag (1990), über **Wasser**:

$$e_s(T) = 6.112 \cdot \exp\!\left(\frac{17.62\,T}{243.12 + T}\right)\ \text{[hPa]}$$

Gültig von −45 °C bis +60 °C.

**Auch unter 0 °C wird über Wasser gerechnet.** Das ist kein Versehen:
MeteoSchweiz referenziert die publizierte relative Feuchte auf Wasser. Ein
Wechsel auf die Eis-Koeffizienten ergäbe im Winter systematisch zu tiefe
Taupunkte. Wer die Konvention ändert, muss `METHOD_SATURATION.version` erhöhen.

## Taupunkt

Analytische Umkehrung mit $\ln = \ln(e/6.112)$:

$$T_d = \frac{243.12 \cdot \ln}{17.62 - \ln}$$

### Kreuzvergleich gegen die Messreihe

Die SMN-Stundendateien führen den Taupunkt als `tde200h0` mit. Damit lässt sich
die Implementierung gegen eine unabhängige Quelle prüfen. `data/ocbl_data/qa.py`
enthält dafür eine **zweite, getrennt getippte** Fassung der Formeln — bei einem
Tippfehler in einer der beiden fällt der Vergleich auf.

Ergebnis für Zürich/Fluntern 2023, 8760 verglichene Stunden:

| Grösse | Wert |
|---|---|
| mittlere Abweichung | +0.002 K |
| maximale Abweichung | 0.434 K |
| innerhalb 0.5 K | 100.00 % |

Die verbleibende Streuung erklärt sich aus der Rundung: `tde200h0` ist auf
0.1 °C publiziert, die relative Feuchte auf 0.1 %.

## Feuchtegehalt und Enthalpie

$$x = 0.62198 \cdot \frac{e}{p - e}\ \text{[kg/kg]}$$

$$h = 1.006\,T + x\,(2501 + 1.86\,T)\ \text{[kJ/kg]}$$

Bezugszustand: trockene Luft und flüssiges Wasser bei 0 °C. Daraus folgt
$h(0\,°\text{C}, x=0) = 0$ — im Test verankert.

Der Druck $p$ ist der **Stationsdruck** `prestah0`, nicht der auf Meereshöhe
reduzierte. Auf 604 m ü. M. beträgt der Unterschied rund 70 hPa und wirkt sich
direkt auf $x$ aus. Fehlt `prestah0` — in den älteren Jahrgängen kommt das vor —
greift `pressureFromAltitude()` als dokumentierte Rückfallebene.

## Feuchtkugeltemperatur

Aus der Psychrometergleichung, numerisch gelöst:

$$e = e_s(T_w) - A \cdot p \cdot (T - T_w), \qquad A = 6.53 \cdot 10^{-4}\ \text{K}^{-1}$$

$A$ gilt für ventilierte Messung über Wasser (WMO-No. 8). Über Eis wäre
$5.75 \cdot 10^{-4}$ zu verwenden; das ist bewusst **nicht** implementiert,
weil der Gültigkeitsbereich sonst unklar würde.

### Warum Bisektion und nicht Newton

$T_w$ liegt garantiert zwischen Taupunkt und Trockentemperatur. Damit ist das
Suchintervall von vornherein eingeschlossen, und Bisektion kann nicht
divergieren — Newton kann das bei sehr tiefer Feuchte sehr wohl. 60
Halbierungsschritte liegen weit unter jeder physikalisch sinnvollen Auflösung.

Für 8760 Stunden ist das im Browser eine Sache von Millisekunden.
Nachvollziehbarkeit schlägt hier Geschwindigkeit.

### Verankerte Stützstellen

| Zustand | $T_w$ berechnet | h,x-Diagramm |
|---|---|---|
| 20 °C / 50 % | 13.7 °C | ≈ 13.7 °C |
| 30 °C / 40 % | 20.0 °C | ≈ 20.0 °C |
| 25 °C / 100 % | 25.0 °C | 25.0 °C |

Zusätzlich prüft der Test über den gesamten Bereich die Ordnung
$T_d \le T_w \le T$.
