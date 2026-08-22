# Mitarbeit

Das Projekt ist offen, damit Ergebnisse prüfbar sind — nicht, weil es ein
Produktteam hat. Bitte die Erwartungen entsprechend einordnen.

## Was besonders willkommen ist

**Fehler in der Physik.** Wenn eine Gleichung, ein Koeffizient oder ein
Gültigkeitsbereich falsch ist, ist das die wertvollste Meldung überhaupt.
Am besten mit Fundstelle in der Norm oder Primärliteratur.

**Fehler in den Konventionen.** Zeitzonen, Intervallgrenzen, Schwellenwerte,
inklusiv oder exklusiv. Genau dort sitzen die stillen Fehler.

**Zusätzliche Validierungen.** Vergleiche gegen unabhängige Quellen — andere
Werkzeuge, publizierte Kennwerte, Messreihen.

## Ablauf

- **Issues:** jederzeit, gern auch nur eine Frage.
- **Pull Requests:** bitte vorher ein Issue eröffnen. Ein PR ohne vorherige
  Absprache bleibt möglicherweise lange liegen.
- **Keine Support-Garantie.** Es gibt keine Reaktionszeit, die zugesagt wäre.

## Regeln für Code

1. **Kein publizierbarer Zahlenwert ohne `Computation<T>`.** Nackte `number`
   sind für Zwischenschritte da.
2. **Kein Verfahren ohne Seite in `docs/methods/`.** Der `doc`-Eintrag im
   `MethodRef` muss auf eine existierende Überschrift zeigen.
3. **`MethodRef.version` erhöhen, sobald sich Ergebnisse für gleiche Eingaben
   ändern** — auch bei einer Fehlerkorrektur.
4. **Annahmen gehören in `params`**, nicht in eine Konstante im Funktionsrumpf.
5. **Fehlwerte sind `NaN`**, nicht `-999`, nicht `null`, nicht `0`.
6. **Ausserhalb des Gültigkeitsbereichs kommt `NaN`**, keine Extrapolation.
7. **Neue Variablen im ETL brauchen einen Gültigkeitsbereich** in
   `variables.py`. Der Selbsttest prüft, dass die Int16-Skalierung ihn trägt.

Tests: `node --test "core/test/*.test.ts"`. Neue Verfahren brauchen mindestens eine
verankerte Stützstelle aus einer unabhängigen Quelle — Tabellenwert,
h,x-Diagramm, Normbeispiel.

## Kommentare und Sprache

Dokumentation und Kommentare auf Deutsch, Bezeichner im Code auf Englisch.
Kommentare erklären **warum**, nicht **was** — das steht schon im Code.
