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


def pack_year(data: YearData, station: Station, out_path: Path) -> PackReport:
    codes = data.present_codes()
    if not codes:
        raise RuntimeError(f"{data.station} {data.year}: keine einzige Variable enthaelt Werte")

    columns: list[tuple[VariableSpec, list[int]]] = []
    out_of_range: dict[str, int] = {}
    completeness: dict[str, float] = {}

    for code in codes:
        spec = BY_CODE[code]
        raw, rejected = _quantize_column(spec, data.values[code])
        columns.append((spec, raw))
        if rejected:
            out_of_range[code] = rejected
        completeness[code] = sum(1 for v in raw if v != MISSING_I16) / len(raw)

    start_ms = int(data.start.timestamp() * 1000)
    header = {
        "station": data.station,
        "altitudeM": station.altitude_m,
        "startUtcMs": start_ms,
        "stepMs": STEP_MS,
        "length": data.length,
        "label": INTERVAL_LABEL,
        "localOffsetMin": LOCAL_OFFSET_MIN,
        "variables": [
            {"code": spec.code, "unit": spec.unit, "scale": spec.scale, "offset": spec.offset}
            for spec, _ in columns
        ],
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
        completeness=completeness,
        out_of_range=out_of_range,
    )
