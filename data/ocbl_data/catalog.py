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
#: Detailangaben je Station, neben den Stationsjahren abgelegt.
STATION_INDEX_NAME = "index.json"


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


#: Was eine Station koennen muss, damit eine Auswertung ueberhaupt Sinn ergibt.
CAPABILITY_REQUIREMENTS = {
    # Klimakennwerte: Tropennaechte, Hitzetage, Kuehlgradstunden
    "climate": {"tre200h0"},
    # Feuchtegroessen: Enthalpie, Feuchtkugel, Taupunkt
    "moisture": {"tre200h0", "ure200h0"},
    # Raummodell 5R1C: braucht zusaetzlich die Globalstrahlung
    "roomModel": {"tre200h0", "gre000h0"},
    # gemessene Diffusstrahlung statt Erbs-Korrelation
    "measuredDiffuse": {"ods000h0"},
    # gemessene Himmelstemperatur statt Pauschalwert der Norm
    "measuredSky": {"oli000h0"},
}


def _capabilities(entry: dict) -> dict:
    """Leitet aus den vorhandenen Variablen ab, was an dieser Station geht.

    Von 158 SwissMetNet-Stationen taugen nicht alle fuer alles: neun sind
    reine Wind- oder Strahlungsmessstellen. Das Frontend soll das anzeigen
    koennen, statt leere Diagramme zu zeigen.
    """
    available = {v for meta in entry["years"].values() for v in meta["variables"]}
    return {name: required <= available for name, required in CAPABILITY_REQUIREMENTS.items()}


def save(catalog: dict, build_dir: Path) -> Path:
    """Schreibt den leichten Index und je Station eine Detaildatei.

    Die Trennung ist eine Skalierungsfrage: Mit Pruefsummen und
    Vollstaendigkeit je Stationsjahr waechst der Katalog linear mit der
    Historie — 157 Stationen ueber 35 Jahre ergaeben mehrere Megabyte, nur um
    ein Auswahlfeld zu fuellen. Der Index bleibt so bei einigen zehn Kilobyte;
    die Details holt das Frontend erst, wenn eine Station gewaehlt wird.
    """
    catalog["generated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    build_dir.mkdir(parents=True, exist_ok=True)

    index_stations: dict = {}
    for abbr, entry in sorted(catalog["stations"].items()):
        entry["years"] = dict(sorted(entry["years"].items()))
        entry["capabilities"] = _capabilities(entry)

        slug = abbr.lower()
        detail_dir = build_dir / "smn" / slug
        detail_dir.mkdir(parents=True, exist_ok=True)
        (detail_dir / STATION_INDEX_NAME).write_text(
            json.dumps(entry["years"], ensure_ascii=False, indent=1, sort_keys=False),
            encoding="utf-8",
        )

        index_stations[abbr] = {
            "name": entry["name"],
            "canton": entry["canton"],
            "altitudeM": entry["altitudeM"],
            "lat": entry["lat"],
            "lon": entry["lon"],
            "capabilities": entry["capabilities"],
            "years": [int(y) for y in entry["years"]],
            "index": f"smn/{slug}/{STATION_INDEX_NAME}",
        }

    index = {k: v for k, v in catalog.items() if k != "stations"}
    index["stations"] = index_stations

    path = build_dir / CATALOG_NAME
    path.write_text(json.dumps(index, ensure_ascii=False, indent=2, sort_keys=False), encoding="utf-8")
    return path


def load(build_dir: Path) -> dict:
    """Liest den Index und zieht die Detaildateien wieder zusammen.

    Der Build braucht den vollstaendigen Stand, um einzelne Stationsjahre zu
    ergaenzen, ohne die uebrigen zu verlieren.

    **Fehlende Detaildateien sind ein Fehler, kein leerer Stand.** Genau das
    ging beim Einfuehren der Index/Detail-Trennung einmal schief: Die alte
    Katalogfassung hatte die Jahre noch inline, die Detaildateien existierten
    noch nicht, und ein stilles Zuruecksetzen auf {} hat den gesamten Index
    ueberschrieben. Ein lauter Abbruch haette den Datenverlust verhindert.
    """
    path = build_dir / CATALOG_NAME
    if not path.exists():
        return {
            "formatVersion": FORMAT_VERSION,
            "collection": COLLECTION,
            "license": LICENSE,
            "attribution": ATTRIBUTION,
            "stations": {},
        }

    catalog = json.loads(path.read_text(encoding="utf-8"))
    # Beschreibende Angaben kommen immer aus dem Code, nie aus dem alten Stand.
    # Sonst blieb eine korrigierte Quellenangabe im Kopf des Katalogs haengen,
    # waehrend alle Datensaetze sie schon trugen: So stand bis 14.09.2026
    # "Bundesamt fuer Meteorologie" in der Fusszeile. formatVersion bleibt
    # unberuehrt, sie beschreibt den vorhandenen Stand.
    catalog.update({"collection": COLLECTION, "license": LICENSE, "attribution": ATTRIBUTION})
    missing: list[str] = []

    for abbr, entry in catalog.get("stations", {}).items():
        entry.pop("capabilities", None)
        # Altes Format: die Jahre stehen bereits inline.
        if isinstance(entry.get("years"), dict) and entry["years"]:
            entry.pop("index", None)
            continue

        detail = build_dir / "smn" / abbr.lower() / STATION_INDEX_NAME
        if detail.exists():
            entry["years"] = json.loads(detail.read_text(encoding="utf-8"))
        elif entry.get("years"):
            # Der Index nennt Jahre, die Detaildatei fehlt — Datenstand kaputt.
            missing.append(abbr)
        else:
            entry["years"] = {}
        entry.pop("index", None)

    if missing:
        raise RuntimeError(
            f"Detaildateien fehlen fuer {len(missing)} Station(en): {', '.join(missing[:5])}"
            f"{' …' if len(missing) > 5 else ''}. Der Katalog ist unvollstaendig; "
            f"neu bauen statt ueberschreiben."
        )

    return catalog
