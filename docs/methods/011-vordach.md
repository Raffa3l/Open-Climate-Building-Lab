# Vordach, Balkon und Verbauung

Umsetzung: [`core/src/overhang.ts`](../../core/src/overhang.ts), eingebunden in
[`core/src/building.ts`](../../core/src/building.ts), im Referenzfall aus
[`core/src/reference-case.ts`](../../core/src/reference-case.ts)
Prüfung: [`core/test/overhang.test.ts`](../../core/test/overhang.test.ts)

## Worum es geht

Ein Vordach oder eine Balkonplatte über dem Fenster hält im Sommer die hoch
stehende Mittagssonne ab und lässt im Winter die tiefe Sonne herein. Das ist
die älteste Form des sommerlichen Wärmeschutzes und braucht weder Motor noch
Regelung. Das Raummodell bildete sie bis 19.09.2026 nicht ab
([006](006-room-model-5r1c.md#gültigkeitsbereich-und-grenzen)).

## Rechnung

Das Vordach gilt als **lang gegenüber der Fensterbreite**, wie eine
durchgehende Balkonplatte. Dann genügt ein Schnitt senkrecht zur Fassade. Die
Geometrie geht nur als Verhältnis zur Fensterhöhe H ein:

| Grösse | Bedeutung |
|---|---|
| p = P / H | Auskragung vor der Fassade |
| g = G / H | Abstand zwischen Fensteroberkante und Vordach |

### Direktstrahlung

Der Schatten der Vorderkante reicht um P · tan α_p unter das Vordach. α_p ist
der **Profilwinkel**, die Sonnenhöhe α_s im Schnitt senkrecht zur Fassade, mit γ
als Differenz von Sonnen- und Fassadenazimut
([`duffie-beckman-2013`](sources.md#duffie-beckman-2013)):

$$\tan\alpha_p = \frac{\tan\alpha_s}{\cos\gamma}, \qquad f_{Schatten} = \min\left(1,\ \max\left(0,\ p\tan\alpha_p - g\right)\right)$$

Der besonnte Anteil 1 − f_Schatten mindert die Direktstrahlung auf das Fenster.
Steht die Sonne hinter der Fassade, trifft ohnehin keine Direktstrahlung.

### Diffusstrahlung

Das Perez-Modell teilt den Himmel in drei Teile
([005](005-solar.md#anisotropes-himmelsmodell-nach-perez)). Ein langes Vordach
wirkt auf jeden anders, wie im NREL-Handbuch für beschattete Fenster
([`nrel-bluebook-1995`](sources.md#nrel-bluebook-1995)):

| Anteil | Wirkung des Vordachs |
|---|---|
| Aufhellung um die Sonne | wie Direktstrahlung, Faktor 1 − f_Schatten |
| gleichmässiger Himmel | Sichtfaktor zum Himmel gemindert |
| Horizontstreifen | unverändert |
| Bodenreflexion | unverändert |

Beim isotropen Modell ist der ganze Diffusanteil gleichmässiger Himmel.

Den **Sichtfaktor** liefert die Fadenmethode von Hottel im Schnitt
([`hottel-sarofim-1967`](sources.md#hottel-sarofim-1967)). Das Fenster der Höhe 1
sieht auf die Unterseite des Vordachs mit

$$F_{Fenster \to Vordach} = \frac{\sqrt{p^2 + g^2} + 1 - \sqrt{p^2 + (1+g)^2}}{2}$$

Dem Himmel bleibt 1/2 − F statt 1/2. Der gleichmässige Himmelsanteil wird mit
1 − 2F multipliziert.

### Sonnenschutz

Der Sonnenschutz regelt auf die Einstrahlung, die unter dem Vordach am Fenster
ankommt, wie ein Fühler am Fenster. Unter einem Vordach schliesst er deshalb
seltener.

## Verbauung

Eine lange Häuserzeile oder ein Hang gegenüber wird wie in der Schweizer
Praxis über den **Verbauungswinkel ε** beschrieben: die Höhe der Oberkante über
dem Horizont, von der Fenstermitte aus gesehen. Der Winkel gilt über die ganze
Fensterhöhe; das Gegenüber ist weit weg im Vergleich zur Fensterhöhe.

| Anteil | Wirkung der Verbauung |
|---|---|
| Direktstrahlung, Aufhellung um die Sonne | fallen weg, solange der Profilwinkel unter ε liegt |
| gleichmässiger Himmel | Sichtfaktor gemindert |
| Horizontstreifen | fällt weg |
| Bodenreflexion | unverändert |

Für den Sichtfaktor gilt im Schnitt die Regel für einen Flächenstreifen:
Zwischen den Winkeln φ₁ und φ₂ zur Flächennormalen sieht er
(sin φ₂ − sin φ₁) / 2. Die senkrechte Fassade sieht ohne Hindernis den Himmel
von 0° bis 90° über dem Horizont, also 1/2. Mit Verbauung beginnt der Himmel
erst bei ε, und unter einem Vordach endet er für einen Punkt in der Tiefe d bei
β = atan(d / p). Über die Fensterhöhe gemittelt und auf 1/2 bezogen:

$$\frac{F_{Himmel}}{1/2} = \int_{\max(g,\ p\tan\varepsilon)}^{1+g} \left(\frac{d}{\sqrt{d^2+p^2}} - \sin\varepsilon\right) \mathrm{d}d = \left[\sqrt{d^2+p^2} - d\sin\varepsilon\right]_{\max(g,\ p\tan\varepsilon)}^{1+g}$$

Ohne Verbauung ist das die Fadenformel von oben, ohne Vordach 1 − sin ε. Beide
Hindernisse lassen sich so gemeinsam rechnen.

## Referenzfall

Das Fenster ist ein Band über die ganze Fassadenbreite von 3.5 m, die
Oberkante liegt 0.2 m unter der Decke, das Vordach auf Deckenhöhe. Der Regler
stellt die Auskragung P von 0 bis 2 m. Bei 40 % Fensteranteil ist das Fenster
1.12 m hoch; ein Vordach von 1 m ergibt p = 0.892857 und g = 0.178571. Mehr
Fensteranteil heisst ein höheres Fenster, und dasselbe Vordach beschattet davon
einen kleineren Teil. Ein zweiter Regler stellt den Verbauungswinkel von 0° bis
60°.

**Ohne Vordach und Verbauung fehlen die Felder im Fenster** und damit auch im
Berechnungs-Hash. Nachgeprüft am 19.09.2026: Zürich/Fluntern 2024 mit 40 % und
70 % Fensteranteil und 2023 tragen weiter `609ae7766214`, `a83613f02679` und
`1a0020cdd933`.

## Prüfungen

**Strahlverfolgung.** Ein Test konstruiert den Schatten ohne Profilwinkel: Sonne
und Fassade als Vektoren in Ost-Nord-Hoch, von 4'000 Punkten der Fensterhöhe ein
Strahl zur Sonne, Schnitt mit der Vordachplatte. Über 324 Kombinationen aus
Sonnenhöhe, Azimut und Geometrie weicht die Formel um höchstens die Auflösung
1/4'000 ab.

**Numerische Integration.** Ein Punkt in der Tiefe d unter dem Vordach sieht den
Himmel bis zur Höhe β = atan(d / p) und damit den Sichtfaktor sin(β)/2. Über die
Fensterhöhe gemittelt trifft das die Fadenformel auf 10⁻⁶.

**NREL-Bemessung.** Das NREL-Handbuch bemisst sein Vordach so, dass es ein
Südfenster mittags nicht beschattet, solange die Sonne tiefer als 71° minus
Breite steht, und gibt dafür den 17. November bis 25. Januar an. Mit G / P =
tan(71° − φ) für Zürich rechnet der Test mittags am 19. November, 21. Dezember
und 23. Januar keinen Schatten, am 10. November und 1. Februar schon. An den
beiden Grenztagen steht die Sonne um weniger als 0.3° neben 71° − φ.

Einschränkung: Das Handbuch lag nur als Auszug vor, dessen Formeln im Text
verstümmelt sind. «71° − Breite» ist dort lesbar und passt zu den genannten
Daten, weil die Deklination am 17. November und am 25. Januar rund −19° beträgt.
Ein durchgerechnetes Zahlenbeispiel aus einem Lehrbuch fehlt noch.

**Okes Strassenschlucht.** Die Sichtfaktorregel im Schnitt ist an einem Wert aus
der Stadtklimatologie verankert: Die Mitte des Bodens einer langen,
symmetrischen Strassenschlucht sieht den Himmel mit ψ = cos β, β die Höhe der
Traufkante ([`oke-1981`](sources.md#oke-1981)). Die waagrechte Fläche sieht den
Himmel zwischen ±(90° − β) um ihre Normale; die Regel ergibt cos β auf 10⁻¹².

**Verbauung und Vordach gemeinsam.** Die geschlossene Form trifft die
numerische Integration von max(0, sin β(d) − sin ε) über die Fensterhöhe auf
10⁻⁶, in vier Kombinationen. Ohne Vordach ergibt sie 1 − sin ε, ohne Verbauung
die Fadenformel.

## Wirkung

Voreinstellung, Zürich/Fluntern 2023, 40 % Fensteranteil, mit Nachtlüftung:

| Fassade | Sonnenschutz | Vordach | ÜTS | Kh | θ_op max | Schutz geschlossen |
|---|---|---:|---:|---:|---:|---:|
| Süd | g_tot 0.15 | – | 501 | 801 | 36.3 °C | 1'727 h |
| Süd | g_tot 0.15 | 1.0 m | 385 | 539 | 35.5 °C | 634 h |
| Süd | g_tot 0.15 | 2.0 m | 328 | 456 | 35.3 °C | 210 h |
| Süd | keiner | – | 1'308 | 4'875 | 42.2 °C | |
| Süd | keiner | 0.5 m | 831 | 2'050 | 38.6 °C | |
| Süd | keiner | 1.0 m | 478 | 723 | 35.5 °C | |
| Süd | keiner | 2.0 m | 328 | 456 | 35.3 °C | |
| West | keiner | – | 1'099 | 3'659 | 41.4 °C | |
| West | keiner | 1.0 m | 695 | 1'479 | 38.5 °C | |
| West | keiner | 2.0 m | 452 | 774 | 36.8 °C | |

Auf der Südfassade ersetzt ein Vordach von gut einem Meter über einem 1.12 m
hohen Fenster fast den ganzen Sonnenschutz. Gegen die tiefe Abendsonne im
Westen wirkt es deutlich schwächer.

Die Verbauung wirkt umgekehrt, sie nimmt die tiefe Sonne. Dieselbe
Voreinstellung ohne Vordach:

| Fassade | Sonnenschutz | Verbauung | ÜTS | Kh | θ_op max | Schutz geschlossen |
|---|---|---:|---:|---:|---:|---:|
| Süd | g_tot 0.15 | – | 501 | 801 | 36.3 °C | 1'727 h |
| Süd | g_tot 0.15 | 30° | 430 | 630 | 35.9 °C | 1'247 h |
| Süd | keiner | – | 1'308 | 4'875 | 42.2 °C | |
| Süd | keiner | 30° | 1'154 | 3'772 | 41.3 °C | |
| Süd | keiner | 60° | 644 | 1'450 | 38.2 °C | |
| West | g_tot 0.15 | – | 538 | 940 | 36.7 °C | 1'076 h |
| West | g_tot 0.15 | 30° | 349 | 511 | 35.3 °C | 602 h |
| West | keiner | – | 1'099 | 3'659 | 41.4 °C | |
| West | keiner | 30° | 697 | 1'577 | 38.1 °C | |
| West | keiner | 60° | 332 | 456 | 35.4 °C | |

Ein Gegenüber unter 30° nimmt der Südfassade im Sommer wenig, weil die
Mittagssonne weit darüber steht, 12 % der Stunden ohne Sonnenschutz. Der
Westfassade nimmt es gut ein Drittel.

## Grenzen

1. **Vordach und Verbauung sind unendlich lang.** Bei einem Vordach, das kaum
   breiter ist als das Fenster, oder einem einzelnen Gebäude gegenüber scheint
   die Sonne seitlich vorbei; die Rechnung überschätzt dann die Wirkung.
2. **Keine seitlichen Laibungen oder Blenden.**
3. **Die Verbauung gilt über die ganze Fensterhöhe.** Steht das Gegenüber nah,
   sieht die Unterkante des Fensters es höher als die Oberkante.
4. **Vordach und Gegenüber reflektieren nicht.** Eine helle Balkonplatte oder
   eine besonnte Fassade gegenüber wirft Strahlung aufs Fenster; die Rechnung
   unterschätzt dann den Eintrag.
5. **Die langwellige Abstrahlung bleibt unverändert.** Das Fenster sieht unter
   dem Vordach und vor dem Gegenüber weniger Himmel und verliert nachts weniger;
   der Formfaktor des Raums zum Himmel ist aber pauschal
   ([008](008-langwellige-abstrahlung.md#grenzen)).
6. **Nur senkrechte Fenster.** Die Sichtfaktorformel gilt für die senkrechte
   Fläche; bei anderer Neigung bricht die Rechnung ab.
