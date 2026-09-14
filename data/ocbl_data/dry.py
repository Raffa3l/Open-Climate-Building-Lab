"""Klimaszenarien fürs zukünftige Innenraumklima (DRY-Datensaetze).

Collection ``ch.meteoschweiz.klimaszenarien-raumklima``: 45 Stationen,
stuendlich, auf CH2018 beruhend. Je Station sechs Kombinationen aus Periode
(2035, 2060), Szenario (RCP26, RCP85) und Typ (DRY, 1in10-warmsummer).

Nutzungsbedingung "Freie Nutzung. Quellenangabe ist Pflicht.", kommerzielle
Nutzung eingeschlossen — siehe docs/methods/sources.md.

**Zwei Konventionen musste ich empirisch bestimmen**, weil sie in keiner
Metadatendatei stehen; Herleitung in docs/methods/009-klimaszenarien.md:

1. Der Zeitstempel ist UTC und bezeichnet den Intervall*beginn* — anders als
   bei den SMN-Messreihen, wo er das Intervall*ende* meint. Der fuer die
   Sonnengeometrie repraesentative Zeitpunkt liegt bei **+10 min**.
2. ``str.direkt`` ist die Direkt*normal*strahlung, nicht die horizontale.
   Es gilt ``gls = str.diffus + str.direkt * sin(h)``.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from calendar import isleap
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .http import fetch

ARCHIVE_URL = (
    "https://data.geo.admin.ch/ch.meteoschweiz.klimaszenarien-raumklima/"
    "klimaszenarien-raumklima/klimaszenarien-raumklima_2056.csv.zip"
)
COLLECTION = "ch.meteoschweiz.klimaszenarien-raumklima"
LICENSE = "terms_by"
ATTRIBUTION = "MeteoSchweiz, Baudirektion Kanton Zürich, BAFU, SIA, HSLU"
TITLE = "Klimaszenarien fürs zukünftige Innenraumklima (SIA 2028)"
DATASET_URL = "https://opendata.swiss/de/dataset/klimaszenarien-furs-zukunftige-innenraumklima-sia-2028"

SOURCE_ENCODING = "cp1252"
METADATA_NAME = "Klimaszenarien-Raumklima_Metadata.csv"
FILE_PATTERN = re.compile(r"^([A-Z0-9]+)_(\d{4})_(RCP\d+)_(DRY|1in10-warmsummer)\.csv$")

#: Empirisch bestimmt: der Stempel bezeichnet den Intervallbeginn, der
#: repraesentative Zeitpunkt liegt 10 Minuten spaeter. An sechs Dateien ueber
#: verschiedene Stationen, Perioden und Szenarien uebereinstimmend.
SAMPLE_OFFSET_MIN = 10
INTERVAL_LABEL = "start"
LOCAL_OFFSET_MIN = 60

#: Spalte im DRY-File -> Variablencode des Projekts.
COLUMN_MAP = {
    "tre200h0": "tre200h0",
    "ure200h0": "ure200h0",
    "fkl010h0": "fkl010h0",
    "dkl010h0": "dkl010h0",
    "gls": "gre000h0",
    "str.diffus": "ods000h0",
}


@dataclass(frozen=True)
class ScenarioStation:
    abbr: str
    name: str
    canton: str
    altitude_m: float
    lat: float
    lon: float

    @property
    def slug(self) -> str:
        return self.abbr.lower()


@dataclass(frozen=True)
class ScenarioKey:
    station: str
    period: int
    scenario: str
    kind: str

    @property
    def slug(self) -> str:
        return f"{self.period}_{self.scenario}_{'dry' if self.kind == 'DRY' else 'warmsummer'}"

    @property
    def label(self) -> str:
        kind = "Referenzjahr" if self.kind == "DRY" else "warmer Sommer (1 in 10)"
        return f"{self.period} · {self.scenario} · {kind}"


def open_archive(cache_dir: Path | None = None, refresh: bool = False) -> zipfile.ZipFile:
    """Laedt das Archiv (33 MB) und oeffnet es aus dem Cache."""
    payload = fetch(ARCHIVE_URL, cache_dir=cache_dir, refresh=refresh)
    return zipfile.ZipFile(io.BytesIO(payload))


def _to_float(value: str) -> float | None:
    value = value.strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def load_stations(archive: zipfile.ZipFile) -> dict[str, ScenarioStation]:
    text = archive.read(METADATA_NAME).decode(SOURCE_ENCODING)
    reader = csv.DictReader(io.StringIO(text), delimiter=";")

    out: dict[str, ScenarioStation] = {}
    for row in reader:
        abbr = (row.get("Abk.") or "").strip().upper()
        lat = _to_float(row.get("Breitengrad", ""))
        lon = _to_float(row.get("Längengrad", ""))
        alt = _to_float(row.get("Stationshöhe m. ü. M.", ""))
        if not abbr or lat is None or lon is None or alt is None:
            continue
        out[abbr] = ScenarioStation(
            abbr=abbr,
            name=(row.get("Station") or abbr).strip(),
            canton=(row.get("Kanton") or "").strip(),
            altitude_m=alt,
            lat=lat,
            lon=lon,
        )
    return out


def available(archive: zipfile.ZipFile) -> list[ScenarioKey]:
    keys: list[ScenarioKey] = []
    for name in archive.namelist():
        m = FILE_PATTERN.match(name)
        if m:
            keys.append(ScenarioKey(m.group(1), int(m.group(2)), m.group(3), m.group(4)))
    return sorted(keys, key=lambda k: (k.station, k.period, k.scenario, k.kind))


def reference_year(period: int) -> int:
    """Kalenderjahr, auf das die 8760 Stunden gelegt werden.

    Die DRY-Dateien haben 365 Tage und kennen keinen 29. Februar — 2060 ist
    aber ein Schaltjahr. Wuerde man die Reihe auf den 1.1.2060 legen, verschoeben
    sich alle Datumsangaben ab dem 1. Maerz um einen Tag, und mit ihnen der
    Sonnenstand. Gelegt wird deshalb auf das naechste **Nicht**-Schaltjahr.

    Der Unterschied in der Sonnendeklination zwischen benachbarten Jahren liegt
    bei wenigen Zehntelgrad und ist gegenueber der Aussage eines synthetischen
    Referenzjahres bedeutungslos.
    """
    year = period
    while isleap(year):
        year += 1
    return year


class ScenarioData:
    """Ein Szenariojahr: je Variable ein Vektor der Laenge 8760."""

    def __init__(self, key: ScenarioKey) -> None:
        self.key = key
        self.length = 8760
        self.year = reference_year(key.period)
        self.start = datetime(self.year, 1, 1, 0, 0, tzinfo=timezone.utc)
        self.values: dict[str, list[float | None]] = {
            code: [None] * self.length for code in COLUMN_MAP.values()
        }
        #: Direktnormalstrahlung — nicht gepackt, nur fuer die Kreuzpruefung.
        self.direct_normal: list[float | None] = [None] * self.length

    def completeness(self, code: str) -> float:
        column = self.values[code]
        return sum(1 for v in column if v is not None) / len(column)

    def present_codes(self) -> list[str]:
        return [c for c in self.values if self.completeness(c) > 0.0]


def load(archive: zipfile.ZipFile, key: ScenarioKey) -> ScenarioData:
    name = f"{key.station}_{key.period}_{key.scenario}_{key.kind}.csv"
    text = archive.read(name).decode(SOURCE_ENCODING)
    reader = csv.DictReader(io.StringIO(text))

    data = ScenarioData(key)
    for index, row in enumerate(reader):
        if index >= data.length:
            break
        for column, code in COLUMN_MAP.items():
            value = _to_float(row.get(column, ""))
            if value is not None:
                data.values[code][index] = value
        data.direct_normal[index] = _to_float(row.get("str.direkt", ""))

    return data
