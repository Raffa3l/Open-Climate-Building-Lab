# Das .ocbl-Binärformat

Schreibseite: [`data/ocbl_data/pack.py`](../../data/ocbl_data/pack.py)
Leseseite: [`core/src/pack.ts`](../../core/src/pack.ts)

Beide Seiten sind zusammen zu ändern. `FORMAT_VERSION` ist der Vertrag zwischen
ihnen; eine Änderung macht alle bestehenden Prüfsummen ungültig — beabsichtigt.

## Warum kein CSV, kein Parquet

Ein Stationsjahr sind 8760 Stunden mal rund elf Variablen. Als skalierte Int16
ergibt das **rund 190 kB**. Gemessen an Zürich/Fluntern 2023: 189,4 kB für
elf Variablen.

Das ist klein genug, dass der Browser genau das Jahr lädt, das er anzeigt —
ohne Datenbank, ohne Query-Layer, ohne Serverlogik. Ein statischer
HTTP-Download, cachebar, über jedes CDN ausliefernbar.

CSV wäre rund viermal grösser und müsste geparst werden. Parquet bräuchte eine
Bibliothek im Browser, die in zehn Jahren gewartet sein will.

## Aufbau

| Offset | Länge | Inhalt |
|---|---|---|
| 0 | 4 | Magic `OCBL` |
| 4 | 1 | Formatversion (aktuell 1) |
| 5 | 3 | reserviert, Null |
| 8 | 4 | `uint32` LE: Länge des JSON-Headers in Bytes |
| 12 | n | JSON-Header, UTF-8 |
| 12+n | … | Nutzdaten |

Die Nutzdaten liegen **variablenweise**: erst alle `length` Werte der ersten
Variable, dann die der zweiten. Nicht zeilenweise. So lässt sich später eine
einzelne Variable per HTTP-Range-Request holen, ohne die übrigen zu laden.

Alle Zahlen sind Little Endian.

## Quantisierung

$$\text{physikalischer Wert} = \text{raw} \cdot \text{scale} + \text{offset}$$

`scale` und `offset` stehen je Variable im Header. Der Fehlwert ist
`-32768` — der kleinste darstellbare Int16, damit nie ein gültiger Messwert.

`data/ocbl_data/variables.py` führt für jede Variable einen Gültigkeitsbereich
und prüft beim Import, dass die Skalierung ihn wirklich trägt. Ohne diesen
Selbsttest wäre etwa eine Windrichtung mit `scale = 0.01` stillschweigend bei
327,67° abgeschnitten worden.

Werte ausserhalb des Gültigkeitsbereichs werden beim Packen **verworfen, nicht
geklemmt**. Ein geklemmter Wert sieht plausibel aus und wandert unbemerkt in
die Statistik; ein Fehlwert nicht.

## Prüfsumme

Die SHA-256 des gesamten Files steht **nicht im File** — eine Prüfsumme, die
sich selbst enthält, kann nicht stimmen. Sie steht im Katalog
`data/build/catalog.json` und wird von aussen hereingereicht.

Damit kann das Frontend beim Laden verifizieren, dass es genau die Daten hat,
auf die sich ein publizierter Berechnungs-Hash bezieht. `fetchPacked()` tut das
und wirft bei Abweichung.

`python -m ocbl_data verify` rechnet alle Katalogprüfsummen nach.
