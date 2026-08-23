"""Katalog der Szenariodatensaetze — getrennt vom Messdatenkatalog.

Getrennt, weil es eine andere Collection mit anderen Nutzungsbedingungen,
anderer Zeitkonvention und einer anderen Achse ist: nicht Jahre, sondern
Kombinationen aus Periode, Szenario und Typ. Sie in catalog.json zu mischen
haette beide Strukturen verbogen.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .dry import ATTRIBUTION, COLLECTION, DATASET_URL, LICENSE, TITLE, ScenarioKey, ScenarioStation
from .pack import FORMAT_VERSION, PackReport

CATALOG_NAME = "scenarios.json"
STATION_INDEX_NAME = "index.json"


def empty() -> dict:
    return {
        "formatVersion": FORMAT_VERSION,
        "collection": COLLECTION,
        "license": LICENSE,
        "licenseLabel": "Freie Nutzung. Quellenangabe ist Pflicht.",
        "attribution": ATTRIBUTION,
        "title": TITLE,
        "url": DATASET_URL,
        "stations": {},
    }


def load(build_dir: Path) -> dict:
    path = build_dir / CATALOG_NAME
    if not path.exists():
        return empty()

    catalog = json.loads(path.read_text(encoding="utf-8"))
    missing: list[str] = []
    for abbr, entry in catalog.get("stations", {}).items():
        detail = build_dir / "dry" / abbr.lower() / STATION_INDEX_NAME
        if detail.exists():
            entry["variants"] = json.loads(detail.read_text(encoding="utf-8"))
        elif entry.get("variants"):
            missing.append(abbr)
        else:
            entry["variants"] = {}
        entry.pop("index", None)

    if missing:
        raise RuntimeError(
            f"Detaildateien fehlen fuer {len(missing)} Station(en): {', '.join(missing[:5])}. "
            f"Neu bauen statt ueberschreiben."
        )
    return catalog


def upsert(
    catalog: dict,
    station: ScenarioStation,
    key: ScenarioKey,
    report: PackReport,
    build_dir: Path,
) -> None:
    entry = catalog["stations"].setdefault(
        station.abbr,
        {
            "name": station.name,
            "canton": station.canton,
            "altitudeM": station.altitude_m,
            "lat": station.lat,
            "lon": station.lon,
            "variants": {},
        },
    )
    entry["variants"][key.slug] = {
        "period": key.period,
        "scenario": key.scenario,
        "kind": key.kind,
        "label": key.label,
        "path": report.path.relative_to(build_dir).as_posix(),
        "sha256": report.sha256,
        "bytes": report.bytes_written,
        "variables": report.variables,
        "completeness": {k: round(v, 4) for k, v in report.completeness.items()},
    }


def save(catalog: dict, build_dir: Path) -> Path:
    catalog["generated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    build_dir.mkdir(parents=True, exist_ok=True)

    index_stations: dict = {}
    for abbr, entry in sorted(catalog["stations"].items()):
        variants = dict(sorted(entry["variants"].items()))
        slug = abbr.lower()
        detail_dir = build_dir / "dry" / slug
        detail_dir.mkdir(parents=True, exist_ok=True)
        (detail_dir / STATION_INDEX_NAME).write_text(
            json.dumps(variants, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        index_stations[abbr] = {
            "name": entry["name"],
            "canton": entry["canton"],
            "altitudeM": entry["altitudeM"],
            "lat": entry["lat"],
            "lon": entry["lon"],
            "variants": list(variants),
            "index": f"dry/{slug}/{STATION_INDEX_NAME}",
        }

    index = {k: v for k, v in catalog.items() if k != "stations"}
    index["stations"] = index_stations

    path = build_dir / CATALOG_NAME
    path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
