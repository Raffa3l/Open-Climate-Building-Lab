# Visualisierung

Umsetzung: [`web/chart.js`](../../web/chart.js), [`web/style.css`](../../web/style.css)

Eine Grafik ist Teil der Aussage, nicht ihre Dekoration. Die Regeln hier sind
deshalb genauso verbindlich wie die Gleichungen in den übrigen Methodenseiten.

## Form

Die Leitfrage ist eine Veränderung über die Zeit gegen eine Schwelle. Das ergibt
eine **Linie** über den Jahresverlauf, keine Balken:

- **Operative Raumtemperatur, Tagesmaximum** — die eigentliche Serie
- **Komfortgrenze EN 16798-1** — eine Referenz, keine gleichrangige Serie, und
  deshalb gestrichelt in gedämpfter Tinte statt in einer Serienfarbe
- **Überschreitung** — die Fläche zwischen beiden, wo die Temperatur über der
  Grenze liegt. Sie zeigt die Kelvinstunden unmittelbar als Fläche.

**Eine Achse.** Temperatur in °C, nichts sonst. Keine zweite Skala.

## Zwei Klimastände nebeneinander

Der Vergleichsmodus legt einen zweiten Klimastand über denselben Verlauf:
gemessenes Jahr gegen Szenario oder Szenario gegen Szenario. Dabei gilt:

- **Die Vergleichsreihe ist eine gleichrangige Serie**, also Serie 2, nicht
  eine gedämpfte Variante von Serie 1.
- **Jede Reihe bringt ihre eigene Komfortgrenze mit.** Das adaptive Band folgt
  dem gleitenden Mittel der Aussentemperatur und liegt im wärmeren Klimastand
  höher. Nur eine Grenze zu zeichnen läse die Überschreitung des zweiten
  Klimastands an der falschen Schwelle ab. Die zweite Grenze ist deshalb
  gepunktet in der Serienfarbe, nicht gestrichelt in gedämpfter Tinte. Sonst
  wären die beiden Referenzen nicht auseinanderzuhalten.
- **Die Überschreitungsfläche bleibt der Basisreihe vorbehalten.** Zwei
  überlagerte Flächen ergeben eine dritte Farbe, die nichts bedeutet. Die
  Vergleichsreihe wird **vor** der Fläche gezeichnet, nicht danach: Eine Linie
  quer durch die Fläche zerschneidet sie in Fetzen und nimmt ihr die Aussage.
- **Die Differenz steht als Zahl**, unter jeder Kennzahl, mit Vorzeichen. Die
  Fläche zeigt das Ausmass, die Kachel den Unterschied.
- **Die Tagesachse wird über (Monat, Tag) abgeglichen**, nicht über den
  Laufindex: Ein DRY hat 365 Tage, ein Messjahr möglicherweise 366. Ein 29.
  Februar ohne Gegenstück bleibt undefiniert (`alignDailyToCalendarYear` in
  [`core/src/series.ts`](../../core/src/series.ts)).

Beim Vergleich eines Messjahres mit einem Szenario steht ein Hinweis über dem
Diagramm: Die Differenz ist dort **kein Klimasignal**, siehe
[009](009-klimaszenarien.md).

## Farbrollen

| Rolle | Hell | Dunkel |
|---|---|---|
| Serie 1 — Raumtemperatur | `#2a78d6` | `#3987e5` |
| Serie 2: zweiter Klimastand | `#008300` | `#008300` |
| Status „serious" — Überschreitung | `#ec835a` | `#ec835a` |
| Referenzlinie, Achsenbeschriftung | `#898781` | `#898781` |
| Raster | `#e1e0d9` | `#2c2c2a` |
| Oberfläche | `#fcfcfb` | `#1a1a19` |

Überschreitung ist ein **Zustand**, keine weitere Serie — deshalb eine
Statusfarbe. Sie wird nie für eine Datenreihe wiederverwendet.

Serie 2 ist **nicht** der zweite Slot der kategorialen Ordnung. Der wäre
Orange und läge damit auf der Statusfarbe der Überschreitung; unter Protanopie
sind beide nicht mehr zu trennen. Aus demselben Grund durchgefallen sind Aqua
(ΔE 2.9 gegen Orange im Dunkelmodus), Gelb, Rot und Magenta. Violett scheitert
zusätzlich an Serie 1 (ΔE 9.8 bei normalem Sehen im Dunkelmodus). Grün ist
der erste Slot, der in **beiden** Modi jede harte Prüfung besteht.

Damit ist `--status-good` (`#0ca30c`) im Diagramm **gesperrt**, weil es zu
nah an Serie 2 liegt. Es bleibt für Zustandsanzeigen ausserhalb der Grafik.

### Validierung

Geprüft mit dem Validator der Visualisierungsrichtlinie:

| Prüfung | Hell | Dunkel |
|---|---|---|
| CVD-Trennung Serie 1 ↔ Überschreitung | ΔE 23.3 | ΔE 22.5 |
| Normalsicht Serie 1 ↔ Überschreitung | ΔE 32.3 | ΔE 30.4 |
| CVD-Trennung, schlechtestes Paar aus Serie 1, Serie 2, Überschreitung | ΔE 10.1 | ΔE 10.1 |
| Normalsicht, schlechtestes Paar derselben drei | ΔE 29.0 | ΔE 29.9 |
| Kontrast zur Oberfläche | `#ec835a` 2.57 ⚠ | alle ≥ 3:1 |

Geprüft wurden alle Paare, nicht nur benachbarte: Die drei Marken liegen
gleichzeitig im Bild und können einander überall begegnen.

Der Warnwert im Hellmodus löst die **Relief-Regel** aus: Die Statusfarbe darf
die Aussage nicht allein tragen. Erfüllt durch beides zugleich — die
Kennzahlen stehen als Zahl über dem Diagramm, und die Tabelle listet jeden
überschrittenen Tag mit Datum, Temperatur, Grenze und Stundenzahl.

Der Lightness-Band-Fehlschlag von `#ec835a` im Dunkelmodus ist erwartet: Der
Prüfbereich gilt für kategoriale Paletten, nicht für Statusfarben. Die sind
über beide Modi fix und liegen auf der dunklen Oberfläche bei 6.60 Kontrast.

## Hell und Dunkel

Beide Fassungen sind **gewählt**, nicht automatisch umgekehrt. Die Dunkelstufen
stammen aus derselben Skala, sind aber für die dunkle Oberfläche eigens
gesetzt.

Die Rollen sind CSS-Custom-Properties und dreifach deklariert:

1. `:root` — die helle Grundfassung
2. `@media (prefers-color-scheme: dark)` mit `:root:not([data-theme="light"])` —
   die Systemeinstellung
3. `:root[data-theme="dark"]` — der ausdrückliche Umschalter, der in beide
   Richtungen gewinnt

`chart.js` liest die Farben über `getComputedStyle` aus diesen Rollen. Damit
folgt das Diagramm dem Umschalter ohne eigene Logik und ohne doppelte
Farbtabelle.

## Marken und Anatomie

- Linien **2 px**, Marker 5 px mit 2 px Ring in Oberflächenfarbe, damit sie
  sich vom Verlauf lösen
- Raster und Achsen zurückhaltend, ein Haarstrich
- Die Sollhöhe des Canvas steht in `data-height`. Nicht im `height`-Attribut:
  Dort schreibt `drawChart()` die Pixelhöhe `cssHeight · dpr` hinein, und von
  dort wieder gelesen verdoppelte sich das Diagramm bei jedem Neuzeichnen
- Legende immer vorhanden, sobald mehr als eine Marke im Bild ist; im
  Vergleich trägt sie die Bezeichnung des jeweiligen Klimastands, damit die
  Zuordnung nicht allein an der Farbe hängt
- Keine Zahl an jedem Punkt — die Werte stehen im Tooltip und in der Tabelle

## Interaktion

Fadenkreuz und Tooltip beim Zeigen sind **Grundausstattung**, nicht Zugabe: Ein
Diagramm im Browser ist interaktiv, sonst wäre ein Bild ausreichend. Der
Tooltip nennt Datum, Tagesmaximum, Grenze und — bei Überschreitung — die
Differenz in Kelvin und die Zahl der Stunden. Im Vergleich stehen beide
Klimastände untereinander, benannt, mit der Differenz der Tagesmaxima.

Die Filter stehen in einer Zeile über den Reglern, die Regler über dem
Diagramm.

## Übertemperaturstunden je Messjahr

Ein Wert je Jahr ist eine Grösse, kein Verlauf innerhalb des Jahres: deshalb
**Säulen**, ab null, höchstens 24 px breit, oben 4 px gerundet. Ohne Nullpunkt
übertriebe die Säulenlänge die Unterschiede.

- **Eine Serie**, in der Rolle Serie 1 wie die Raumtemperatur oben.
- **Der Trend ist eine Referenz**, keine zweite Serie: eine durchgezogene Linie
  in sekundärer Tinte. Gestrichelt in gedämpfter Tinte bleibt der Komfortgrenze
  vorbehalten.
- **Eine Legende**, obwohl es nur eine Serie gibt: Säule und Linie müssen
  unterscheidbar sein, ohne die Farbe zu deuten.
- **Fehlende Jahre bleiben eine Lücke.** Die Achse läuft über jedes Jahr; wo
  eines ausgelassen ist, steht keine Säule, und die Zusammenfassung nennt den
  Grund.
- **Das Jahr unter dem Zeiger** hebt ein Band in Rasterfarbe hervor, kein Rahmen
  um die Säule. Der Tooltip nennt Stunden, Kelvinstunden, bewertete Stunden und
  den Trendwert; die Tabelle darunter trägt dieselben Zahlen für alle Jahre.

Die Zusammenfassung unter der Grafik nennt Trend, r² und Hash in Worten. Sie
sagt ausdrücklich, dass die Gerade eine mittlere Verschiebung ist und keine
Vorhersage ([012](012-mehrjahresverlauf.md#lesart-und-grenzen)).

## Keine Diagrammbibliothek

Eine Linie, eine Referenzkurve und eine Fläche dazwischen sind rund 150 Zeilen
Canvas. Eine Diagrammbibliothek wäre die grösste Einzelabhängigkeit des
Projekts und müsste zehn Jahre gepflegt sein — bei einem Projekt, dessen ETL
mit der Standardbibliothek auskommt, wäre das die falsche Stelle für einen
Kompromiss.
