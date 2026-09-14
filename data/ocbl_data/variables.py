"""Welche SMN-Parameter das Lab führt — und wie sie quantisiert werden.

Jede Variable wird als skalierter Int16 abgelegt. Der Wertebereich muss mit
Sicherheitsmarge in +/-32767 passen; MISSING (-32768) ist als Fehlwert belegt
und darf nie ein gueltiger Messwert sein.

Parameterkuerzel und Einheiten stammen aus ogd-smn_meta_parameters.csv.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VariableSpec:
    code: str
    unit: str
    scale: float
    offset: float
    description: str
    #: Erwarteter physikalischer Bereich. Werte ausserhalb gelten als Messfehler
    #: und werden beim Packen zu Fehlwerten, nicht stillschweigend geklemmt.
    valid_min: float
    valid_max: float

    def quantize(self, value: float) -> int:
        return round((value - self.offset) / self.scale)

    def dequantize(self, raw: int) -> float:
        return raw * self.scale + self.offset


MISSING_I16 = -32768
I16_MAX = 32767

#: Der v0-Variablensatz: alles, was ein bauphysikalisches Modell braucht.
VARIABLES: tuple[VariableSpec, ...] = (
    VariableSpec("tre200h0", "degC", 0.01, 0.0, "Lufttemperatur 2 m, Stundenmittel", -60, 60),
    VariableSpec("ure200h0", "%", 0.01, 0.0, "Relative Luftfeuchtigkeit 2 m, Stundenmittel", 0, 100),
    VariableSpec("tde200h0", "degC", 0.01, 0.0, "Taupunkt 2 m, Stundenmittel", -60, 60),
    VariableSpec("pva200h0", "hPa", 0.01, 0.0, "Dampfdruck 2 m, Stundenmittel", 0, 100),
    VariableSpec("prestah0", "hPa", 0.01, 800.0, "Luftdruck auf Stationshoehe, Stundenmittel", 500, 1100),
    # Kurzwellige Strahlung darf negativ sein: Ein Thermosäulen-Pyranometer
    # zeigt nachts einen Nullpunktversatz, weil die Glaskuppel gegen den Himmel
    # abstrahlt. ISO 9060:2018 lässt dafür bis 30 W/m2 zu (Klasse C). Bis 2003
    # liefert MeteoSchweiz diese Werte ungeschnitten, vor allem -1 bis -4 W/m2;
    # mit 0 als Grenze fielen sie als Fehlwerte aus, und ein vollständig
    # gemessenes Jahr erschien zu 84 % vollständig. Siehe docs/methods/004.
    VariableSpec("gre000h0", "W/m2", 0.1, 0.0, "Globalstrahlung, Stundenmittel", -30, 1600),
    VariableSpec("ods000h0", "W/m2", 0.1, 0.0, "Diffuse Himmelsstrahlung, Stundenmittel", -30, 1600),
    VariableSpec("oli000h0", "W/m2", 0.1, 0.0, "Langwellige Einstrahlung, Stundenmittel", 0, 700),
    VariableSpec("olo000h0", "W/m2", 0.1, 0.0, "Langwellige Ausstrahlung, Stundenmittel", 0, 900),
    VariableSpec("fkl010h0", "m/s", 0.01, 0.0, "Windgeschwindigkeit skalar, Stundenmittel", 0, 100),
    VariableSpec("dkl010h0", "deg", 0.1, 0.0, "Windrichtung, Stundenmittel", 0, 360),
    VariableSpec("rre150h0", "mm", 0.01, 0.0, "Niederschlagssumme, Stunde", 0, 200),
    VariableSpec("sre000h0", "min", 0.01, 0.0, "Sonnenscheindauer, Stunde", 0, 60),
)

BY_CODE = {v.code: v for v in VARIABLES}


def _self_check() -> None:
    """Stellt sicher, dass jede Skalierung ihren Wertebereich wirklich traegt."""
    for v in VARIABLES:
        for bound in (v.valid_min, v.valid_max):
            raw = v.quantize(bound)
            if not (MISSING_I16 < raw <= I16_MAX):
                raise ValueError(
                    f"{v.code}: Bereichsgrenze {bound} {v.unit} ergibt Rohwert {raw}, "
                    f"passt nicht in Int16. Skalierung oder Offset anpassen."
                )


_self_check()
