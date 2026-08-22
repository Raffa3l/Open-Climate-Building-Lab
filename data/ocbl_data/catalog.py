"""Der Katalog: das einzige Bindeglied zwischen ETL und Frontend.

Er enthaelt fuer jedes Stationsjahr Pfad, Pruefsumme und Vollstaendigkeit.
Die Pruefsumme ist der Grund, warum es ihn gibt: das Frontend laedt eine Datei
und kann verifizieren, dass es genau die Daten hat, auf die sich ein
publizierter Berechnungs-Hash bezieht.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .pack import FORMAT_VERSION, PackReport
from .smn import ATTRIBUTION, COLLECTION, LICENSE
from .stations import Station

CATALOG_NAME = "catalog.json"


def load(build_dir: Path) -> dict:
    path = build_dir / CATALOG_NAME
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "formatVersion": FORMAT_VERSION,
        "collection": COLLECTION,
        "license": LICENSE,
        "attribution": ATTRIBUTION,
        "stations": {},
    }


def upsert(catalog: dict, station: Station, year: int, report: PackReport, build_dir: Path) -> None:
    entry = catalog["stations"].setdefault(
        station.abbr,
        {
            "name": station.name,
            "canton": station.canton,
            "altitudeM": station.altitude_m,
            "lat": station.lat,
            "lon": station.lon,
            "years": {},
        },
    )
    entry["years"][str(year)] = {
        "path": report.path.relative_to(build_dir).as_posix(),
        "sha256": report.sha256,
        "bytes": report.bytes_written,
        "variables": report.variables,
        "completeness": {k: round(v, 4) for k, v in report.completeness.items()},
        "outOfRange": report.out_of_range,
    }


def save(catalog: dict, build_dir: Path) -> Path:
    catalog["generated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for entry in catalog["stations"].values():
        entry["years"] = dict(sorted(entry["years"].items()))
    catalog["stations"] = dict(sorted(catalog["stations"].items()))

    build_dir.mkdir(parents=True, exist_ok=True)
    path = build_dir / CATALOG_NAME
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=False), encoding="utf-8")
    return path
