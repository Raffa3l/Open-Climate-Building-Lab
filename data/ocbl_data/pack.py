"""Schreibseite des .ocbl-Binaerformats.

Der Leser liegt in core/src/pack.ts. Beide Seiten muessen zusammen geaendert
werden; FORMAT_VERSION ist der Vertrag zwischen ihnen.

Aufbau:

    Offset  Laenge  Inhalt
    0       4       Magic "OCBL"
    4       1       Formatversion
    5       3       reserviert, Null
    8       4       uint32 LE: Laenge des JSON-Headers in Bytes
    12      n       JSON-Header, UTF-8
    12+n    ...     Nutzdaten: je Variable `length` Int16 LE, variablenweise
"""

from __future__ import annotations

import hashlib
import json
import struct
from dataclasses import dataclass
from pathlib import Path

from .smn import ATTRIBUTION, COLLECTION, DATASET_URL, LICENSE, TITLE
from .stations import Station
from .smn import YearData
from .variables import MISSING_I16, VariableSpec, BY_CODE

MAGIC = b"OCBL"
FORMAT_VERSION = 1

#: Stundenwerte.
STEP_MS = 3_600_000
#: Zeitstempel bezeichnet das Intervallende (MeteoSchweiz-Konvention).
INTERVAL_LABEL = "end"
#: MEZ ohne Sommerzeit, siehe core/src/series.ts.
LOCAL_OFFSET_MIN = 60


@dataclass
class PackReport:
    path: Path
    sha256: str
    bytes_written: int
    variables: list[str]
    completeness: dict[str, float]
    #: Werte, die ausserhalb des Gueltigkeitsbereichs lagen und verworfen wurden.
    out_of_range: dict[str, int]


def _quantize_column(
    spec: VariableSpec, column: list[float | None]
) -> tuple[list[int], int]:
    raw: list[int] = []
    rejected = 0
    for value in column:
        if value is None:
            raw.append(MISSING_I16)
            continue
        if not (spec.valid_min <= value <= spec.valid_max):
            # Bewusst verwerfen statt klemmen: ein geklemmter Wert sieht
            # plausibel aus und wandert unbemerkt in die Statistik.
            raw.append(MISSING_I16)
            rejected += 1
            continue
        raw.append(spec.quantize(value))
    return raw, rejected


def _quantize_all(
    values: dict[str, list[float | None]], codes: list[str]
) -> tuple[list[tuple[VariableSpec, list[int]]], dict[str, int], dict[str, float]]:
    columns: list[tuple[VariableSpec, list[int]]] = []
    out_of_range: dict[str, int] = {}
    completeness: dict[str, float] = {}

    for code in codes:
        spec = BY_CODE[code]
        raw, rejected = _quantize_column(spec, values[code])
        columns.append((spec, raw))
        if rejected:
            out_of_range[code] = rejected
        completeness[code] = sum(1 for v in raw if v != MISSING_I16) / len(raw)

    return columns, out_of_range, completeness


def _write(header: dict, columns: list[tuple[VariableSpec, list[int]]], out_path: Path) -> PackReport:
    """Gemeinsamer Rumpf fuer Mess- und Szenariodaten — ein Format, ein Schreiber."""
    header_bytes = json.dumps(header, ensure_ascii=False, sort_keys=True).encode("utf-8")

    body = bytearray()
    body += MAGIC
    body += struct.pack("<B3x", FORMAT_VERSION)
    body += struct.pack("<I", len(header_bytes))
    body += header_bytes
    for _, raw in columns:
        body += struct.pack(f"<{len(raw)}h", *raw)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(body)

    return PackReport(
        path=out_path,
        sha256=hashlib.sha256(body).hexdigest(),
        bytes_written=len(body),
        variables=[spec.code for spec, _ in columns],
        completeness={},
        out_of_range={},
    )


def _variable_block(columns: list[tuple[VariableSpec, list[int]]]) -> list[dict]:
    return [
        {"code": spec.code, "unit": spec.unit, "scale": spec.scale, "offset": spec.offset}
        for spec, _ in columns
    ]


def pack_year(data: YearData, station: Station, out_path: Path) -> PackReport:
    codes = data.present_codes()
    if not codes:
        raise RuntimeError(f"{data.station} {data.year}: keine einzige Variable enthaelt Werte")

    columns, out_of_range, completeness = _quantize_all(data.values, codes)

    header = {
        "station": data.station,
        "altitudeM": station.altitude_m,
        "startUtcMs": int(data.start.timestamp() * 1000),
        "stepMs": STEP_MS,
        "length": data.length,
        "label": INTERVAL_LABEL,
        "localOffsetMin": LOCAL_OFFSET_MIN,
        "variables": _variable_block(columns),
        "source": {
            "collection": COLLECTION,
            "station": data.station,
            "year": data.year,
            "variables": [spec.code for spec, _ in columns],
            "license": LICENSE,
            "attribution": ATTRIBUTION,
            "title": TITLE,
            "url": DATASET_URL,
        },
    }
    report = _write(header, columns, out_path)
    report.completeness = completeness
    report.out_of_range = out_of_range
    return report


def pack_scenario(data, station, out_path: Path) -> PackReport:
    """Packt ein Szenariojahr aus den Klimaszenarien-DRY-Datensaetzen.

    Unterschied zur Messreihe: andere Collection, anderer Zeitstempelbezug
    (Intervallbeginn statt -ende) und ein ausdruecklicher Stichzeitpunkt von
    +10 min. Siehe data/ocbl_data/dry.py und docs/methods/009-klimaszenarien.md.
    """
    from . import dry

    codes = data.present_codes()
    if not codes:
        raise RuntimeError(f"{data.key.station} {data.key.slug}: keine Variable enthaelt Werte")

    columns, out_of_range, completeness = _quantize_all(data.values, codes)

    header = {
        "station": data.key.station,
        "altitudeM": station.altitude_m,
        "startUtcMs": int(data.start.timestamp() * 1000),
        "stepMs": STEP_MS,
        "length": data.length,
        "label": dry.INTERVAL_LABEL,
        "localOffsetMin": dry.LOCAL_OFFSET_MIN,
        "sampleOffsetMin": dry.SAMPLE_OFFSET_MIN,
        "variables": _variable_block(columns),
        "source": {
            "collection": dry.COLLECTION,
            "station": data.key.station,
            "year": data.key.period,
            "variables": [spec.code for spec, _ in columns],
            "license": dry.LICENSE,
            "attribution": dry.ATTRIBUTION,
            "title": f"{dry.TITLE} — {data.key.label}",
            "url": dry.DATASET_URL,
        },
    }
    report = _write(header, columns, out_path)
    report.completeness = completeness
    report.out_of_range = out_of_range
    return report
