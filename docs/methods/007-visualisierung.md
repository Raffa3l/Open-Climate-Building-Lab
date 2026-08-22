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

## Farbrollen

| Rolle | Hell | Dunkel |
|---|---|---|
| Serie 1 — Raumtemperatur | `#2a78d6` | `#3987e5` |
| Status „serious" — Überschreitung | `#ec835a` | `#ec835a` |
| Referenzlinie, Achsenbeschriftung | `#898781` | `#898781` |
| Raster | `#e1e0d9` | `#2c2c2a` |
| Oberfläche | `#fcfcfb` | `#1a1a19` |

Überschreitung ist ein **Zustand**, keine weitere Serie — deshalb eine
Statusfarbe. Sie wird nie für eine Datenreihe wiederverwendet.

### Validierung

Geprüft mit dem Validator der Visualisierungsrichtlinie:

| Prüfung | Hell | Dunkel |
|---|---|---|
| CVD-Trennung Serie ↔ Überschreitung | ΔE 23,3 | ΔE 22,5 |
| Normalsicht | ΔE 32,3 | ΔE 30,4 |
| Kontrast zur Oberfläche | `#ec835a` 2,57 ⚠ | alle ≥ 3:1 |

Der Warnwert im Hellmodus löst die **Relief-Regel** aus: Die Statusfarbe darf
die Aussage nicht allein tragen. Erfüllt durch beides zugleich — die
Kennzahlen stehen als Zahl über dem Diagramm, und die Tabelle listet jeden
überschrittenen Tag mit Datum, Temperatur, Grenze und Stundenzahl.

Der Lightness-Band-Fehlschlag von `#ec835a` im Dunkelmodus ist erwartet: Der
Prüfbereich gilt für kategoriale Paletten, nicht für Statusfarben. Die sind
über beide Modi fix und liegen auf der dunklen Oberfläche bei 6,60 Kontrast.

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
- Legende immer vorhanden, sobald mehr als eine Marke im Bild ist
- Keine Zahl an jedem Punkt — die Werte stehen im Tooltip und in der Tabelle

## Interaktion

Fadenkreuz und Tooltip beim Zeigen sind **Grundausstattung**, nicht Zugabe: Ein
Diagramm im Browser ist interaktiv, sonst wäre ein Bild ausreichend. Der
Tooltip nennt Datum, Tagesmaximum, Grenze und — bei Überschreitung — die
Differenz in Kelvin und die Zahl der Stunden.

Die Filter stehen in einer Zeile über den Reglern, die Regler über dem
Diagramm.

## Keine Diagrammbibliothek

Eine Linie, eine Referenzkurve und eine Fläche dazwischen sind rund 150 Zeilen
Canvas. Eine Diagrammbibliothek wäre die grösste Einzelabhängigkeit des
Projekts und müsste zehn Jahre gepflegt sein — bei einem Projekt, dessen ETL
mit der Standardbibliothek auskommt, wäre das die falsche Stelle für einen
Kompromiss.
