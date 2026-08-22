# Methoden

Jedes Verfahren im Rechenkern hat hier eine Seite. Der `doc`-Eintrag in
`MethodRef` zeigt darauf, und der Knopf «Berechnung anzeigen» im Frontend führt
später genau hierher.

| Dokument | Inhalt |
|---|---|
| [000 Zeitkonventionen](000-time-conventions.md) | UTC, Intervallende, Lokalzeit, Jahresgrenzen |
| [001 Feuchte Luft](001-psychrometrics.md) | Sättigungsdampfdruck, Taupunkt, Enthalpie, Feuchtkugel |
| [002 Hitzekennwerte](002-heat-indicators.md) | Tropennächte, Hitzetage, Kühlgradstunden, Nachtlüftung |
| [003 Adaptiver Komfort](003-adaptive-comfort.md) | EN 16798-1, gleitendes Mittel, Übertemperaturstunden |
| [004 Binärformat](004-binary-format.md) | .ocbl, Quantisierung, Prüfsummen |
| [Quellen](sources.md) | Zitierschlüssel, Datenlizenzen, offene Fragen |

## Regeln

1. **Kein Zahlenwert ohne Verfahren.** Wer eine Funktion hinzufügt, die einen
   publizierbaren Wert liefert, schreibt hier die Herleitung dazu.
2. **Version erhöhen, wenn sich Ergebnisse ändern** — auch bei einer
   Fehlerkorrektur. Publizierte Werte müssen zuordenbar bleiben.
3. **Gültigkeitsbereiche stehen explizit da**, und ausserhalb liefert der Code
   `NaN` statt einer Extrapolation.
4. **Annahmen sind Parameter.** Was man diskutieren kann, gehört in `params`
   und damit in den Berechnungs-Hash.
