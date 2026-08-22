# Raummodell 5R1C

Implementierung: [`core/src/building.ts`](../../core/src/building.ts)
Prüfung: [`core/test/building.test.ts`](../../core/test/building.test.ts)

## Zur Normenlage

Das 5R1C-Modell stammt aus **EN ISO 13790:2008**, Simple Hourly Method,
Anhang C. **ISO 52016-1 hat EN ISO 13790 abgelöst** und verwendet ein anderes,
knotenbasiertes Stundenverfahren mit Bilanzierung je Bauteilschicht.

Implementiert ist hier bewusst 13790: Es ist breit dokumentiert, in vielen
Werkzeugen umgesetzt und damit vergleichbar, und es kommt mit den Kennwerten
aus, die in einer frühen Planungsphase vorliegen.

Ein Wechsel auf ISO 52016-1 wäre ein **eigenes Verfahren mit eigener
`MethodRef`**, nicht eine neue Version dieses. Beide könnten dann nebeneinander
ausgewiesen werden; die Differenz ist selbst eine Aussage.

## Knotenbild

Fünf Widerstände, ein Kondensator:

```
        H_ve
θ_sup ──/\/\/── θ_air
                  │
                  │ H_tr,is
                  │
θ_e ──/\/\/────── θ_s ──/\/\/── θ_m ──/\/\/── θ_e
        H_tr,w              H_tr,ms       H_tr,em
                                │
                              ═╪═ C_m
```

| Knoten | Bedeutung |
|---|---|
| θ_air | Raumluft |
| θ_s | gewichtete Oberflächentemperatur (Sternknoten) |
| θ_m | Speichermasse, trägt die Kapazität C_m |
| θ_sup | Zuluft, bei freier Lüftung gleich θ_e |
| θ_e | Aussenluft |

Fenster koppeln direkt auf den Oberflächenknoten — sie haben keine
nennenswerte Speichermasse.

## Normkonstanten

| Grösse | Wert | Fundstelle |
|---|---|---|
| h_is | 3,45 W/(m²K) | §7.2.2.2 |
| h_ms | 9,1 W/(m²K) | §12.2.2 |
| Λ_at | 4,5 | §7.2.2.2 |
| F_w | 0,9 | §11.4.2 |
| ρ·c_Luft | 1200 J/(m³K) | — |

Bauart nach Tabelle 12:

| Klasse | A_m | C_m je m² Grundfläche |
|---|---|---|
| sehr leicht | 2,5 · A_f | 80 kJ/(m²K) |
| leicht | 2,5 · A_f | 110 kJ/(m²K) |
| mittel | 2,5 · A_f | 165 kJ/(m²K) |
| schwer | 3,0 · A_f | 260 kJ/(m²K) |
| sehr schwer | 3,5 · A_f | 370 kJ/(m²K) |

## Aufteilung der Wärmeeinträge

$$\Phi_{ia} = 0{,}5\,\Phi_{int}$$
$$\Phi_{st} = \left(1 - \frac{A_m}{A_t} - \frac{H_{tr,w}}{9{,}1\,A_t}\right)(0{,}5\,\Phi_{int} + \Phi_{sol})$$
$$\Phi_{m} = \frac{A_m}{A_t}\,(0{,}5\,\Phi_{int} + \Phi_{sol})$$

Solare Einträge je Fenster:

$$\Phi_{sol} = \sum F_{sh} \cdot F_w \cdot g \cdot A_w (1 - F_F) \cdot I_\beta$$

## Stundenschritt

$$H_{tr,1} = \left(\tfrac{1}{H_{ve}} + \tfrac{1}{H_{tr,is}}\right)^{-1}, \quad
H_{tr,2} = H_{tr,1} + H_{tr,w}, \quad
H_{tr,3} = \left(\tfrac{1}{H_{tr,2}} + \tfrac{1}{H_{tr,ms}}\right)^{-1}$$

$$\theta_{m,t} = \frac{\theta_{m,t-1}\left(\tfrac{C_m}{3600} - \tfrac{H_{tr,3}+H_{tr,em}}{2}\right) + \Phi_{m,tot}}{\tfrac{C_m}{3600} + \tfrac{H_{tr,3}+H_{tr,em}}{2}}$$

Der Massenknoten wird als Mittel über den Zeitschritt ausgewertet,
$\theta_m = (\theta_{m,t} + \theta_{m,t-1})/2$. Daraus folgen
Oberflächen- und Lufttemperatur und schliesslich

$$\theta_{op} = 0{,}3\,\theta_{air} + 0{,}7\,\theta_{s}$$

Simuliert wird **frei laufend**, $\Phi_{HC} = 0$ — der sommerliche Wärmeschutz
fragt ja gerade, wie warm es *ohne* Kühlung wird.

## Prüfungen

**Beharrungszustand ohne Gewinne.** Bei konstanter Aussentemperatur und ohne
Lasten laufen alle drei Knoten exakt auf die Aussentemperatur.

**Geschlossene Energiebilanz.** Im Beharrungszustand gilt auf besser als
10⁻⁶ W:

$$\Phi_{int} + \Phi_{sol} = H_{ve}(\theta_{air}-\theta_e) + H_{tr,w}(\theta_s-\theta_e) + H_{tr,em}(\theta_m-\theta_e)$$

Das ist die schärfste verfügbare Prüfung der Implementierung — sie fällt bei
jedem Vorzeichen- oder Zuordnungsfehler sofort auf.

**Qualitative Ordnungen**, jeweils im Test verankert: schwere Bauart dämpft den
Tagesgang stärker als leichte; Südfenster bringen im Sommer mehr Ertrag als
Nord; grösserer Fensteranteil erhöht die Spitzentemperatur; Sonnenschutz und
Nachtlüftung senken sie.

## Einschwingphase

Der Massenknoten startet auf der Aussentemperatur der ersten Stunde. Wie lange
diese Anfangsbedingung nachwirkt, hängt an der Zeitkonstante
$\tau = C_m / H_{tr}$.

`warmupHours()` verwirft das Fünffache von τ, aufgerundet auf ganze Tage — für
den Referenzraum mittlerer Bauart sind das 840 Stunden. Wer diese Stunden
mitbewertet, misst die Startbedingung mit.

## Gültigkeitsbereich und Grenzen

**Die Reihenschaltung H_tr,em setzt H_tr,op < H_tr,ms voraus.** Bei sehr
schlecht gedämmter, sehr leichter Bauart ist das verletzt; `deriveRoom()` wirft
dann, statt eine negative Leitfähigkeit zu erzeugen.

Bekannte Vereinfachungen, in dieser Reihenfolge relevant:

1. **Ein Raum, eine Zone.** Kein Wärmeaustausch mit Nachbarräumen.
2. **Sonnenschutz schaltet hart** an einer Bestrahlungsschwelle, ohne
   Hysterese und ohne Nutzerverhalten.
3. **Keine Verschattung durch Umgebung**, Horizont oder Auskragungen. Das
   betrifft auch den Formfaktor zum Himmel, siehe
   [008](008-langwellige-abstrahlung.md#grenzen).
4. **Isotroper Himmel** bei der kurzwelligen Einstrahlung, siehe
   [005](005-solar.md).

Seit Version 1.1.0 ist die **langwellige Abstrahlung gegen den Himmel**
enthalten — siehe [008](008-langwellige-abstrahlung.md).

Das Belegungsprofil war zunächst nicht vorgesehen und wurde nachgezogen: ohne
es laufen interne Lasten rund um die Uhr, was die Übertemperaturstunden
deutlich nach oben treibt. Ein Büro ist nachts und am Wochenende leer.
