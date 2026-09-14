# Langwellige Abstrahlung gegen den Himmel

Implementierung: [`core/src/sky.ts`](../../core/src/sky.ts), eingebunden in
[`core/src/building.ts`](../../core/src/building.ts)
Prüfung: [`core/test/sky.test.ts`](../../core/test/sky.test.ts)
Wirkungsanalyse: [`core/scripts/sky-effect.ts`](../../core/scripts/sky-effect.ts)

## Worum es geht

Die Atmosphäre strahlt schwächer als ein schwarzer Körper auf Lufttemperatur.
Eine Fläche mit Himmelssicht verliert dadurch Wärme über das hinaus, was der
U-Wert abbildet — unter klarem Nachthimmel deutlich, unter Wolken kaum.

## Himmelstemperatur

Aus der gemessenen abwärts gerichteten langwelligen Strahlung `oli000h0`:

$$T_{sky} = \left(\frac{E_{sky}}{\sigma}\right)^{1/4}, \qquad \sigma = 5.670374419 \cdot 10^{-8}\ \text{W/(m²K⁴)}$$

### Warum die Messung dem Normwert überlegen ist

EN ISO 13790 §11.4.6 setzt für gemässigte Zonen pauschal
$\Delta\theta_{sky} = 11\ \text{K}$ an. An Zürich/Fluntern gemessen, 2023,
8760 vollständige Stunden:

| | Δθ_sky |
|---|---|
| Mittel | 9.78 K |
| Median | 9.29 K |
| 5-%-Quantil | 1.38 K |
| 95-%-Quantil | 19.80 K |
| Maximum | 25.25 K |

Der Pauschalwert trifft das Jahresmittel gut. Er kann aber eine **bedeckte
Nacht (1.4 K) nicht von einer klaren (25 K) unterscheiden** — und genau diese
Unterscheidung entscheidet darüber, ob Nachtauskühlung funktioniert.

Wo `oli000h0` vorliegt, wird deshalb gemessen gerechnet; sonst greift der
Normwert. Welcher Weg verwendet wurde, steht in `longwaveSource` und damit im
Nachweis.

## Wärmestrom

EN ISO 13790 §11.3.5, je Bauteil:

$$\Phi_r = R_{se} \cdot U_c \cdot A_c \cdot h_r \cdot \Delta\theta_{sky}$$

| Grösse | Wert | Bedeutung |
|---|---|---|
| R_se | 0.04 m²K/W | Wärmeübergangswiderstand aussen, ISO 6946 |
| h_r | 4.5 W/(m²K) | äusserer Strahlungsübergang, $5\varepsilon$ mit $\varepsilon \approx 0.9$ |
| F_r | 0.5 senkrecht / 1.0 horizontal | Formfaktor zum Himmel |

Vom solaren Eintrag abgezogen wird $F_r \cdot \Phi_r$. Nachts wird der
Solarterm dadurch **negativ** — physikalisch richtig, kein Fehler.

### Der Faktor, den man leicht übersieht

$R_{se} \cdot U_c$ ist der Anteil des Temperaturgefälles, der an der
Aussenoberfläche liegt:

| Bauteil | U-Wert | $R_{se} \cdot U_c$ |
|---|---|---|
| gedämmte Wand | 0.2 | 0.8 % |
| Fenster modern | 1.0 | 4 % |
| ungedämmte Wand | 1.4 | 5.6 % |
| Einfachverglasung | 2.8 | 11 % |

**Die Himmelsabstrahlung trifft vor allem schlecht gedämmte Bauteile.** Bei
einem Neubau ist der Effekt klein, weil die Dämmung ihn ohnehin abschirmt.

## Gemessene Wirkung

Südbüro, Zürich/Fluntern 2023, Sonnenschutz und Nachtlüftung aktiv, bewertet
nach EN 16798-1 Kat. II:

| Fall | ÜTS | Kh | θ_op max | Ø F_r·Φ_r |
|---|---|---|---|---|
| **Neubau** U 0.2 / 1.0 — ohne Abstrahlung | 527 | 845 | 36.30 | 0.0 W |
| Neubau — pauschal 11 K | 492 | 777 | 36.16 | 5.0 W |
| Neubau — gemessen | 480 | 765 | 36.15 | 4.5 W |
| **Altbau** U 1.4 / 2.8 — ohne Abstrahlung | 188 | 275 | 34.82 | 0.0 W |
| Altbau — pauschal 11 K | 145 | 216 | 34.44 | 19.0 W |
| Altbau — gemessen | 140 | 211 | 34.36 | 16.9 W |

### Was daraus folgt

1. **Der Effekt ist real, aber beim Neubau moderat:** −9 % Übertemperatur­stunden,
   Spitzentemperatur −0.15 K. Ich hatte ihn zuvor als grösste bekannte
   Ungenauigkeit des Modells bezeichnet — das war überzogen. Für gut gedämmte
   Hüllen ist er es nicht.
2. **Beim Altbau ist er erheblich:** −26 % Übertemperaturstunden. Für
   Sanierungsfragen ist er unverzichtbar.
3. **Messung gegen Pauschalwert** macht 2 bis 3 % aus — weniger als der Schritt
   von „gar nicht" zu „pauschal". Der Pauschalwert der Norm ist besser als sein
   Ruf.
4. **Der Altbau hat weniger Übertemperaturstunden als der Neubau.** Das ist
   kein Rechenfehler, sondern ein bekanntes und kontraintuitives Ergebnis: Eine
   schlecht gedämmte Hülle lässt die hohen internen Lasten schneller entweichen.
   Gute Dämmung hilft im Winter und verschärft im Sommer die Überhitzung, wenn
   interne Lasten und Sonnenschutz nicht dazu passen.

## Versionierung

`building.simulate5R1C` ist von **1.0.0 auf 1.1.0** gestiegen. Ergebnisse
ändern sich für gleiche Eingaben; publizierte Werte bleiben über die Version
zuordenbar. Wer die alte Fassung reproduzieren will, setzt
`skyViewFactor: 0` — dann ist der Term abgeschaltet, aber die Version bleibt
1.1.0 und der Berechnungs-Hash unterscheidet sich sichtbar.

## Grenzen

- **Ein Formfaktor für die ganze Hülle.** Fenster und opake Fläche werden mit
  demselben F_r gewichtet. Bei stark unterschiedlicher Verschattung ist das zu
  grob.
- **Keine Umgebungsverschattung.** Ein Innenhof oder eine Strassenschlucht
  reduziert die Himmelssicht erheblich; F_r wäre dann kleiner als 0.5.
- **Emissionsgrad pauschal 0.9.** Für Metallfassaden deutlich zu hoch.
