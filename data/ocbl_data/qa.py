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


# ---------------------------------------------------------------------------
# Kreuzpruefung der Szenariodaten
# ---------------------------------------------------------------------------


def solar_altitude(utc_ms: float, latitude: float, longitude: float) -> float:
    """Sonnenhoehe in Grad — zweite, unabhaengig getippte Fassung.

    Dieselbe Rolle wie die Psychrometrie oben: Sie prueft core/src/solar.ts
    gegen eine getrennt geschriebene Umsetzung desselben Verfahrens
    (Michalsky 1988). Nur die Hoehe, kein Azimut — mehr braucht die
    Kreuzpruefung nicht.
    """
    n = utc_ms / 86_400_000 + 2440587.5 - 2451545.0

    mean_longitude = math.radians((280.460 + 0.9856474 * n) % 360)
    mean_anomaly = math.radians((357.528 + 0.9856003 * n) % 360)
    ecliptic = mean_longitude + math.radians(
        1.915 * math.sin(mean_anomaly) + 0.020 * math.sin(2 * mean_anomaly)
    )
    obliquity = math.radians(23.439 - 0.0000004 * n)

    declination = math.asin(math.sin(obliquity) * math.sin(ecliptic))
    right_ascension = math.atan2(math.cos(obliquity) * math.sin(ecliptic), math.cos(ecliptic))

    gmst = (18.697374558 + 24.06570982441908 * n) % 24
    local_sidereal = math.radians(((gmst + longitude / 15) % 24) * 15)
    hour_angle = local_sidereal - right_ascension

    lat = math.radians(latitude)
    sin_alt = math.sin(lat) * math.sin(declination) + math.cos(lat) * math.cos(declination) * math.cos(hour_angle)
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_alt))))


@dataclass
class RadiationCheck:
    compared: int
    mean_abs_error: float
    max_abs_error: float
    within_20: float


def check_radiation_decomposition(data, latitude: float, longitude: float) -> RadiationCheck | None:
    """Prueft ``gls = str.diffus + str.direkt * sin(h)`` in den DRY-Dateien.

    Der Datensatz fuehrt die Direktnormalstrahlung mit, das Projekt speichert
    sie nicht. Damit laesst sich die angenommene Zeitkonvention pruefen: Stimmt
    der Stichzeitpunkt nicht, waechst der Fehler sichtbar an — bei einer
    Stunde Versatz um ein Vielfaches.
    """
    from .dry import SAMPLE_OFFSET_MIN

    start_ms = data.start.timestamp() * 1000
    errors: list[float] = []

    for i in range(data.length):
        global_h = data.values["gre000h0"][i]
        diffuse = data.values["ods000h0"][i]
        direct = data.direct_normal[i]
        if global_h is None or diffuse is None or direct is None:
            continue
        if global_h < 100 or direct < 50:
            continue

        utc_ms = start_ms + i * 3_600_000 + SAMPLE_OFFSET_MIN * 60_000
        sin_alt = math.sin(math.radians(solar_altitude(utc_ms, latitude, longitude)))
        if sin_alt < 0.2:
            continue
        errors.append(abs(global_h - (diffuse + direct * sin_alt)))

    if not errors:
        return None

    return RadiationCheck(
        compared=len(errors),
        mean_abs_error=sum(errors) / len(errors),
        max_abs_error=max(errors),
        within_20=sum(1 for e in errors if e <= 20) / len(errors),
    )
