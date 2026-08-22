# Zeitkonventionen

Die stillen Fehler in Klimapipelines sitzen fast nie in der Physik. Sie sitzen
hier. Deshalb steht die Konvention als explizites Feld in `TimeAxis` und nicht
als stillschweigende Annahme im Code.

## Zeitstempel der Rohdaten

MeteoSchweiz liefert in den SMN-Stundendateien die Spalte
`reference_timestamp` im Format `TT.MM.JJJJ HH:MM`.

- Die Zeit ist **UTC**, nicht Lokalzeit.
- Der Stempel bezeichnet das **Ende** des Aggregationsintervalls.

`01.01.2023 01:00` ist damit das Mittel über 00:00–01:00 UTC.

### Warum das zählt

Für Strahlungsgrössen ist der repräsentative Zeitpunkt die **Mitte** des
Intervalls, also 00:30 UTC. Wer den Stempel direkt als Zeitpunkt in eine
Sonnenstandsberechnung gibt, verschiebt den Sonnenstand um eine halbe Stunde.
Am Morgen und am Abend führt das zu sichtbar falschen Einstrahlungswinkeln auf
geneigte Flächen.

`intervalMidpointUtcMs()` in `core/src/series.ts` liefert deshalb die
Intervallmitte, und alle sonnenstandsabhängigen Rechnungen verwenden sie.

> **Zu verifizieren.** Die Konvention ist aus den Collection-Metadaten und dem
> Datenverhalten abgeleitet. Vor der ersten Publikation gehört sie durch einen
> Vergleich gegen die berechnete Sonnenhöhe bestätigt: die Globalstrahlung muss
> symmetrisch um den wahren lokalen Mittag liegen.

## Lokalzeit für tages- und nachtbezogene Kennwerte

Tropennächte, Nachtlüftungsfenster und Belegungszeiten brauchen Lokalzeit.
Verwendet wird ein **fester Offset von +60 Minuten** — Mitteleuropäische Zeit
**ohne Sommerzeit**.

Das ist eine bewusste Entscheidung, keine Vereinfachung: Bei
Sommerzeitumstellung entstünden sonst eine 23-stündige und eine 25-stündige
Nacht. Beide erzeugen Artefakte in Zählkennwerten, und beide sind physikalisch
bedeutungslos — die Atmosphäre kennt keine Zeitumstellung.

`localOffsetMin` ist Teil der Zeitachse und damit Teil der Provenance. Wer mit
einer anderen Konvention rechnet, erhält einen anderen Berechnungs-Hash.

## Jahresgrenzen

Ein Jahresfile enthält die Stempel von `01.01.JJJJ 00:00` bis
`31.12.JJJJ 23:00`. Das sind 8760 Werte, im Schaltjahr 8784.

Der Wert für das Intervall 31.12. 23:00–24:00 UTC trägt den Stempel
`01.01.(JJJJ+1) 00:00` und liegt deshalb im **Folgejahr**.

Diese Schnittregel ist willkürlich. Sie ist aber konsistent, dokumentiert und
maschinell prüfbar — und das ist mehr wert als eine „natürlichere" Regel, die
niemand aufschreibt.
