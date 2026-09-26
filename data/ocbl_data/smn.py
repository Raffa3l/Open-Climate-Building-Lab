"""Einlesen der SwissMetNet-Stundendateien.

Zeitkonvention — der wichtigste Punkt dieser Datei:

    `reference_timestamp` ist **UTC** und bezeichnet das **Ende** des
    Stundenintervalls. "01.01.2020 01:00" ist das Mittel ueber 00:00-01:00 UTC.

Ein Jahresfile enthaelt die Stempel von "01.01.YYYY 00:00" bis
"31.12.YYYY 23:00". Der Wert fuer das Intervall 31.12. 23:00-24:00 traegt den
Stempel des Folgejahres und liegt deshalb dort. Diese Schnittregel ist
willkuerlich, aber konsistent — und dokumentiert, was mehr wert ist.
"""

from __future__ import annotations

import csv
import io
from calendar import isleap
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .http import SourceMissing, fetch
from .variables import VARIABLES

BASE_URL = "https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn"
COLLECTION = "ch.meteoschweiz.ogd-smn"
LICENSE = "CC-BY-4.0"
ATTRIBUTION = "Bundesamt für Meteorologie und Klimatologie MeteoSchweiz"
#: CC BY 4.0 und die opendata.swiss-Stufe terms_by verlangen Autor, Titel und
#: Link — ein blosser Name genuegt beiden nicht.
TITLE = "Automatische Wetterstationen - Messwerte (SwissMetNet)"
DATASET_URL = "https://opendata.swiss/de/dataset/automatische-wetterstationen-messwerte"

SOURCE_ENCODING = "cp1252"
TIMESTAMP_FORMAT = "%d.%m.%Y %H:%M"


def hours_in_year(year: int) -> int:
    return 8784 if isleap(year) else 8760


def year_start(year: int) -> datetime:
    return datetime(year, 1, 1, 0, 0, tzinfo=timezone.utc)


def decade_url(slug: str, year: int) -> str:
    start = (year // 10) * 10
    return f"{BASE_URL}/{slug}/ogd-smn_{slug}_h_historical_{start}-{start + 9}.csv"


def recent_url(slug: str) -> str:
    return f"{BASE_URL}/{slug}/ogd-smn_{slug}_h_recent.csv"


class YearData:
    """Ein Stationsjahr: je Variable ein Vektor der Laenge 8760 bzw. 8784."""

    def __init__(self, station: str, year: int) -> None:
        self.station = station
        self.year = year
        self.length = hours_in_year(year)
        self.start = year_start(year)
        self.values: dict[str, list[float | None]] = {
            spec.code: [None] * self.length for spec in VARIABLES
        }
        #: URLs, aus denen dieses Jahr zusammengesetzt wurde.
        self.sources: list[str] = []

    def completeness(self, code: str) -> float:
        column = self.values[code]
        return sum(1 for v in column if v is not None) / len(column)

    def present_codes(self) -> list[str]:
        """Variablen, die im Jahr ueberhaupt Werte haben."""
        return [code for code in self.values if self.completeness(code) > 0.0]


def _parse_into(raw: bytes, data: YearData) -> int:
    text = raw.decode(SOURCE_ENCODING)
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    if reader.fieldnames is None:
        return 0

    wanted = [spec.code for spec in VARIABLES if spec.code in reader.fieldnames]
    written = 0

    for row in reader:
        stamp_text = (row.get("reference_timestamp") or "").strip()
        if not stamp_text:
            continue
        try:
            stamp = datetime.strptime(stamp_text, TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
        except ValueError:
            continue

        index = int((stamp - data.start).total_seconds() // 3600)
        if index < 0 or index >= data.length:
            continue

        for code in wanted:
            cell = (row.get(code) or "").strip()
            if not cell:
                continue
            try:
                value = float(cell)
            except ValueError:
                continue
            # Spaeteres File gewinnt: `recent` korrigiert `historical`.
            data.values[code][index] = value
            written += 1

    return written


def load_year(
    station_abbr: str,
    year: int,
    cache_dir: Path | None = None,
    refresh: bool = False,
) -> YearData:
    """Laedt ein Stationsjahr und setzt es aus Dekaden- und `recent`-File zusammen."""
    slug = station_abbr.lower()
    data = YearData(station_abbr.upper(), year)

    candidates = [decade_url(slug, year)]
    # Das laufende und das vorige Jahr koennen teilweise nur in `recent` stehen.
    if year >= datetime.now(timezone.utc).year - 1:
        candidates.append(recent_url(slug))

    for url in candidates:
        try:
            raw = fetch(url, cache_dir=cache_dir, refresh=refresh)
        except SourceMissing:
            # Nicht jede Station hat jede Dekade; das ist kein Fehler.
            continue
        if _parse_into(raw, data) > 0:
            data.sources.append(url)

    if not data.sources:
        raise RuntimeError(f"Keine Stundendaten fuer {station_abbr} {year} gefunden")

    return data


def available_years(station_abbr: str, cache_dir: Path | None = None) -> list[int]:
    """Jahre, fuer die ein Dekadenfile existiert. Fragt die STAC-Item-Assets ab."""
    import json
    import urllib.request

    from .http import USER_AGENT

    slug = station_abbr.lower()
    url = f"https://data.geo.admin.ch/api/stac/v1/collections/{COLLECTION}/items/{slug}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        item = json.load(response)

    years: list[int] = []
    for name in item.get("assets", {}):
        marker = "_h_historical_"
        if marker not in name:
            continue
        span = name.split(marker)[1].removesuffix(".csv")
        start, end = (int(part) for part in span.split("-"))
        years.extend(range(start, end + 1))
    return sorted(y for y in years if y <= datetime.now(timezone.utc).year)
