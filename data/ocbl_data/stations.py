"""Stationsverzeichnis aus ogd-smn_meta_stations.csv.

Achtung, zwei Fallen in dieser Datei: sie ist **cp1252**-kodiert, nicht UTF-8
(sonst wird aus Oberaegeri ein Bytefehler), und sie hat CRLF-Zeilenenden.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from pathlib import Path

from .http import fetch

META_URL = "https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/ogd-smn_meta_stations.csv"

#: MeteoSchweiz publiziert diese Dateien in cp1252, nicht in UTF-8.
SOURCE_ENCODING = "cp1252"


@dataclass(frozen=True)
class Station:
    abbr: str
    name: str
    canton: str
    altitude_m: float
    #: Hoehe des Barometers; kann von der Stationshoehe abweichen.
    barometer_altitude_m: float | None
    lat: float
    lon: float
    data_since: str

    @property
    def slug(self) -> str:
        return self.abbr.lower()


def _to_float(value: str) -> float | None:
    value = value.strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def load_stations(cache_dir: Path | None = None, refresh: bool = False) -> dict[str, Station]:
    raw = fetch(META_URL, cache_dir=cache_dir, refresh=refresh).decode(SOURCE_ENCODING)
    reader = csv.DictReader(io.StringIO(raw), delimiter=";")

    stations: dict[str, Station] = {}
    for row in reader:
        altitude = _to_float(row["station_height_masl"])
        lat = _to_float(row["station_coordinates_wgs84_lat"])
        lon = _to_float(row["station_coordinates_wgs84_lon"])
        if altitude is None or lat is None or lon is None:
            continue
        abbr = row["station_abbr"].strip().upper()
        stations[abbr] = Station(
            abbr=abbr,
            name=row["station_name"].strip(),
            canton=row["station_canton"].strip(),
            altitude_m=altitude,
            barometer_altitude_m=_to_float(row["station_height_barometer_masl"]),
            lat=lat,
            lon=lon,
            data_since=row["station_data_since"].strip(),
        )
    return stations
