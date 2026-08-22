"""Plausibilitaetspruefungen auf den Rohdaten.

Der Taupunktvergleich ist der wertvollste Test der Pipeline: MeteoSchweiz
liefert `tde200h0` gemessen mit, und derselbe Wert laesst sich aus Temperatur
und relativer Feuchte berechnen. Weichen die beiden systematisch ab, stimmt
etwas an der Formel, der Spaltenzuordnung oder der Einheit nicht.

Die Referenzimplementierung steht in core/src/psychro.ts; hier liegt bewusst
eine zweite, unabhaengig getippte Fassung. Bei einem Tippfehler in einer der
beiden faellt der Vergleich auf.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .smn import YearData


def saturation_vapour_pressure(t_celsius: float) -> float:
    """Magnus/Sonntag ueber Wasser, hPa."""
    return 6.112 * math.exp((17.62 * t_celsius) / (243.12 + t_celsius))


def dew_point(t_celsius: float, relative_humidity: float) -> float:
    e = (relative_humidity / 100.0) * saturation_vapour_pressure(t_celsius)
    if e <= 0:
        return float("nan")
    ln = math.log(e / 6.112)
    return (243.12 * ln) / (17.62 - ln)


@dataclass
class DewPointCheck:
    compared: int
    mean_bias_k: float
    max_abs_deviation_k: float
    within_0_5k: float


def check_dew_point(data: YearData) -> DewPointCheck | None:
    """Vergleicht gerechneten mit gemessenem Taupunkt."""
    t = data.values["tre200h0"]
    rh = data.values["ure200h0"]
    td = data.values["tde200h0"]

    deviations: list[float] = []
    for i in range(data.length):
        if t[i] is None or rh[i] is None or td[i] is None or rh[i] <= 0:
            continue
        deviations.append(dew_point(t[i], rh[i]) - td[i])

    if not deviations:
        return None

    return DewPointCheck(
        compared=len(deviations),
        mean_bias_k=sum(deviations) / len(deviations),
        max_abs_deviation_k=max(abs(d) for d in deviations),
        within_0_5k=sum(1 for d in deviations if abs(d) <= 0.5) / len(deviations),
    )
