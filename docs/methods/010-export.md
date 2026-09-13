# Export

Umsetzung: [`core/src/export.ts`](../../core/src/export.ts), Tests in
[`core/test/export.test.ts`](../../core/test/export.test.ts)

Der Download ist die letzte Stufe der Kette **Daten → Modell → Visualisierung
→ Erklärung → Quellen → Download**. Er liefert nicht nur die Zahlen, sondern
alles, was nötig ist, um sie ohne dieses Projekt nachzuprüfen.

Der Serialisierer liegt im Rechenkern, nicht im Frontend. Ein Aufruf aus der
Kommandozeile erzeugt damit dieselben Bytes wie der Browser; ein eigenes Skript
dafür gibt es noch nicht. Zwei Serialisierer würden auseinanderdriften, und eine
Datei, deren Prüfsumme vom Werkzeug abhängt, ist keine prüfbare Datei.

## Was heruntergeladen wird

Je Klimastand zwei Dateien:

| Datei | Inhalt |
|---|---|
| `ocbl_<station>_<klimastand>_<hash>.csv` | Stundenreihe, eine Zeile je Stunde |
| `ocbl_<station>_<klimastand>_<hash>.json` | Manifest: Nachweis, Spaltenbeschreibung, Quellen |

`<hash>` ist die Kurzform des Hashes der **Übertemperaturstunden**. Über seine
Vorgänger umfasst er Simulation, Komfortband und Datensatz, siehe
[Verkettete Hashes](#verkettete-hashes).

## CSV

| Spalte | Einheit | Bedeutung |
|---|---|---|
| `zeitstempel_utc` | ISO 8601 | Zeitstempel der Quelle in UTC, unverändert |
| `lokal_tag` | JJJJ-MM-TT | Lokaler Kalendertag des Stichzeitpunkts |
| `lokal_stunde` | 0–23 | Lokale Stunde des Stichzeitpunkts |
| `einschwingphase` | 0/1 | Stunde liegt in der verworfenen Einschwingphase |
| `theta_e_C` | °C | Aussenlufttemperatur |
| `theta_op_C` | °C | Operative Raumtemperatur, auch in der Einschwingphase |
| `theta_air_C` | °C | Raumlufttemperatur |
| `theta_m_C` | °C | Temperatur des Massenknotens |
| `phi_sol_W` | W | Solare Wärmeeinträge nach Abzug der Himmelsabstrahlung |
| `phi_r_W` | W | Wirksamer Verlust durch Abstrahlung gegen den Himmel |
| `grenze_C` | °C | Adaptive Obergrenze des lokalen Tages |
| `bewertet` | 0/1 | Stunde geht in die Übertemperaturstunden ein |
| `ueber_grenze_K` | K | Überschreitung; 0 ohne Überschreitung, leer wenn nicht bewertet |

**`phi_sol_W` enthält den Abstrahlungsverlust `phi_r_W` bereits.** Nachts ist
die Spalte deshalb negativ, in Zürich/Fluntern um −7 W. Wer beide Spalten
verrechnet, zieht den Verlust doppelt ab. `phi_r_W` steht nur da, damit sein
Anteil sichtbar ist.

### Schreibweise

- **Semikolon als Trenner, Punkt als Dezimalzeichen.** Ein Schweizer Excel
  öffnet die Datei damit per Doppelklick richtig, und
  `pandas.read_csv(pfad, sep=";")` liest sie ohne weitere Angaben.
- **Fehlwerte sind leere Zellen.** Nicht `NaN`: Excel liest das als Text und
  rechnet nicht damit. pandas liest die leere Zelle ohnehin als `NaN`.
- **Keine negative Null.** `-0.00` wird zu `0.00`, sonst unterschieden sich zwei
  inhaltlich gleiche Dateien in der Prüfsumme.
- **Spaltenköpfe in ASCII.** Excel öffnet eine CSV ohne BOM als Windows-1252; ein
  `θ` im Kopf käme als Zeichensalat an. Die Bedeutung steht im Manifest.
- **Keine Kommentarzeilen**, damit jedes Werkzeug die erste Zeile als Kopf
  erkennt. Zeilenende CRLF nach RFC 4180.
- **Feste Nachkommastellen:** Temperaturen 2, Leistungen 1, Überschreitung 3.

### Zeitspalten

`zeitstempel_utc` ist der Stempel der Quelle, und **seine Bedeutung hängt von
der Quelle ab**. Bei SwissMetNet bezeichnet er das Intervallende, bei den
Klimaszenarien den Intervallbeginn mit Stichzeitpunkt `hh:10`. Welche
Konvention gilt, steht im Manifest unter `timeAxis.label` und
`timeAxis.sampleOffsetMin`. Siehe [000](000-time-conventions.md) und
[009](009-klimaszenarien.md).

`lokal_tag` und `lokal_stunde` sind deshalb schon aufgelöst: aus dem
Stichzeitpunkt, mit festem Offset von +60 Minuten und ohne Sommerzeit. Sie
kommen aus denselben Funktionen wie in `exceedanceHours()`.

**Ein Szenario trägt nicht die Jahreszahl seiner Periode.** Die Reihe für 2060
beginnt mit `2061-01-01`, weil der Datensatz keinen 29. Februar kennt und 2060
ein Schaltjahr ist ([009](009-klimaszenarien.md#das-schaltjahrproblem)). Die
Periode steht im Manifest unter `subject.climate`.

> **Wer aus `zeitstempel_utc` selbst eine Lokalzeit bildet, macht bei den
> Szenarien genau den Fehler, den das Frontend bis 13.09.2026 hatte.** Das
> Belegungsfenster liegt dann eine Stunde zu früh, siehe
> [003](003-adaptive-comfort.md#tageswerte).

## Manifest

| Feld | Inhalt |
|---|---|
| `format`, `formatVersion` | `ocbl-export`, Version des Exportformats |
| `file` | Dateiname, SHA-256 der CSV, Schreibweise, Spaltenbeschreibung |
| `subject` | Station, Klimastand und Einstellungen in lesbarer Form |
| `timeAxis` | Die vollständige Zeitachse, inklusive Konvention |
| `warmupHours` | Länge der verworfenen Einschwingphase |
| `computations` | Je Berechnung: Rolle, Hash, kanonische Form, Verfahren, Parameter, Eingangsdaten |
| `citations` | Vollständige Quellenangaben: Autor, Titel, Link, Lizenz |

Das Manifest hat **keinen Erstellungszeitpunkt**. Zwei Exporte desselben
Sachverhalts ergeben dieselbe Datei. Ein Zeitstempel machte jede Datei
einzigartig und damit den Vergleich zweier Downloads wertlos.

`formatVersion` wird erhöht, sobald sich Spalten, Einheiten oder Schreibweise
ändern.

## Nachprüfen

Drei Prüfungen, alle ohne dieses Projekt und nur mit der Python-Standardbibliothek:

```python
import csv, hashlib, json

m = json.load(open("ocbl_SMA_y2024_1239df88adda.json", encoding="utf-8"))
raw = open(m["file"]["name"], "rb").read()

# 1. Die CSV ist die, auf die sich das Manifest bezieht
assert hashlib.sha256(raw).hexdigest() == m["file"]["sha256"]

# 2. Jeder Hash ist der SHA-256 seiner kanonischen Form
for c in m["computations"]:
    assert hashlib.sha256(c["canonicalForm"].encode("utf-8")).hexdigest() == c["hash"]

# 3. Die Zeilen summieren auf die Kennzahl
rows = list(csv.DictReader(raw.decode("ascii").splitlines(), delimiter=";"))
exceedance = next(c for c in m["computations"] if c["role"] == "exceedance")
over = sum(1 for r in rows if r["ueber_grenze_K"] and float(r["ueber_grenze_K"]) > 0)
assert over == exceedance["value"]["hours"]
```

Prüfung 3 ist auch als Test im Kern verankert, für beide Zeitkonventionen.

## Verkettete Hashes

Die Übertemperaturstunden bauen auf der Simulation und dem Komfortband auf, das
Komfortband auf dem gleitenden Mittel. Jede abgeleitete Berechnung führt ihre
Vorgänger mit, und deren kanonische Form steht verschachtelt in der eigenen
([ADR 0007](../adr/0007-verkettete-berechnungs-hashes.md)). Die Prüfung ist
trotzdem dieselbe wie oben: SHA-256 über `canonicalForm` ergibt `hash`.

Bis 13.09.2026 war das nicht so. Die Raumparameter standen nur im Hash der
Simulation, und zwei verschiedene Ergebnisse trugen denselben ÜTS-Hash.
Gemessen an Zürich/Fluntern 2024:

| Fensteranteil | Übertemperaturstunden | ÜTS-Hash vorher | ÜTS-Hash jetzt |
|---|---:|---|---|
| 40 % | 403 | `5e2124ea304d` | `1239df88adda` |
| 70 % | 662 | `5e2124ea304d` | `81f396dc6568` |

Berechnungen ohne Vorgänger behielten ihren Hash, etwa die Simulation
(`a2fc5ec2f2ac`) und das gleitende Mittel (`5911973a7211`).
