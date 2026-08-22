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

Genauigkeit rund 0,01° — für Gebäudesimulation um Grössenordnungen mehr als
nötig, aber der Rechenaufwand ist derselbe wie bei einer gröberen Näherung.

**Der übergebene Zeitpunkt muss die Intervallmitte sein**, nicht der
Rohdaten-Zeitstempel. Siehe [Zeitkonventionen](000-time-conventions.md);
`intervalMidpointUtcMs()` liefert ihn.

### Verankerte Stützstellen für Zürich/Fluntern (47,381° N, 8,567° O)

Die Mittagshöhe ist 90° − Breite + Deklination, also astronomisch nachprüfbar:

| Datum | Mittagshöhe | Tageslänge |
|---|---|---|
| 21. Juni | 66,06° | 15,9 h |
| 21. Dezember | 19,18° | 8,5 h |
| Äquinoktium | 42,62° | 12 h |

Zusätzlich geprüft: Deklination erreicht an den Wendepunkten ±23,44°, der
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
1{,}0 - 0{,}09\,k_t & k_t \le 0{,}22 \\
0{,}9511 - 0{,}1604\,k_t + 4{,}388\,k_t^2 - 16{,}638\,k_t^3 + 12{,}336\,k_t^4 & 0{,}22 < k_t \le 0{,}80 \\
0{,}165 & k_t > 0{,}80
\end{cases}
$$

$$G_0 = 1367 \cdot \left(1 + 0{,}033\cos\frac{2\pi\,n}{365}\right) \cdot \sin(h_s)$$

**Wo die Diffusstrahlung gemessen vorliegt, ist der Messwert vorzuziehen.** Das
Raummodell nimmt sie entgegen und greift nur ersatzweise auf Erbs zurück; der
Report weist aus, welcher Weg verwendet wurde.

Geprüft ist die Monotonie über den gesamten Bereich: mit zunehmender Klarheit
fällt der Diffusanteil streng.

## Einstrahlung auf geneigte Flächen

Isotropes Himmelsmodell nach Liu & Jordan (1963):

$$I_\beta = I_b \cdot R_b + I_d \cdot \frac{1 + \cos\beta}{2} + G \cdot \rho \cdot \frac{1 - \cos\beta}{2}$$

mit dem Einfallswinkel

$$\cos\theta = \cos h_s \sin\beta \cos(\gamma_s - \gamma_f) + \sin h_s \cos\beta$$

und $R_b = \cos\theta / \sin h_s$, auf null begrenzt, wenn die Sonne hinter der
Fläche steht. Bodenreflexionsgrad $\rho$ standardmässig 0,2.

### Bewusste Grenze

Das isotrope Modell ist das einfachste defensible Verfahren. Es **unterschätzt
die Einstrahlung auf sonnenzugewandte Fassaden bei klarem Himmel**, weil es
weder die Aufhellung um die Sonne noch den Horizontbereich abbildet. Für
Überhitzungsfragen liegt es damit auf der optimistischen Seite.

Perez wäre genauer und ist nachrüstbar — dann als **eigenes Verfahren mit
eigener `MethodRef`**, nicht als neue Version dieses. So bleiben publizierte
Werte beider Verfahren nebeneinander zuordenbar.

### Numerische Absicherung

Unter etwa 0,6° Sonnenhöhe wird $R_b$ beliebig gross, weil $\sin h_s$ gegen
null geht. Der Direktanteil wird deshalb unterhalb $\sin h_s = 0{,}01$ zu null
gesetzt. Ohne diese Schranke entstehen in Dämmerungsstunden Einstrahlungswerte
von mehreren tausend W/m².
