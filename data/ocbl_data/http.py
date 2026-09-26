"""Downloads mit lokalem Cache.

Rohdaten werden nie eingecheckt, aber auch nie zweimal geladen. Der Cache ist
inhaltsgleich zur Quelle; geloescht werden kann er jederzeit gefahrlos.
"""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from pathlib import Path

# MeteoSchweiz liefert ohne User-Agent teils 403 zurueck.
USER_AGENT = "ocbl-data/0.1 (+https://github.com/Raffa3l/Open-Climate-Building-Lab) Python-urllib"

# Der Ablagedienst antwortet auf eine fehlende Datei mit 403, nicht mit 404.
MISSING_STATUS = {403, 404}
RETRIES = 4


class SourceMissing(RuntimeError):
    """Die Datei gibt es an der Quelle nicht, etwa eine Dekade vor Messbeginn."""


class SourceUnavailable(Exception):
    """Die Quelle hat nach mehreren Versuchen nicht geantwortet.

    Bewusst kein RuntimeError: Die Bauschleife ueberspringt RuntimeError als
    fehlendes Stationsjahr. Ein Netzaussetzer im Actions-Lauf haette so still
    Jahre aus dem veroeffentlichten Datenstand entfernt; er muss den Lauf
    abbrechen.
    """

DEFAULT_CACHE = Path(__file__).resolve().parents[1] / "cache"


def fetch(url: str, cache_dir: Path | None = None, refresh: bool = False) -> bytes:
    """Laedt eine URL, mit Cache auf der Platte. Gibt die Rohbytes zurueck."""
    cache_dir = cache_dir or DEFAULT_CACHE
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / url.rsplit("/", 1)[-1]

    if target.exists() and not refresh:
        return target.read_bytes()

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = response.read()
            break
        except urllib.error.HTTPError as exc:
            if exc.code in MISSING_STATUS:
                raise SourceMissing(f"HTTP {exc.code} fuer {url}") from exc
            error: Exception = exc
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            error = exc
        if attempt == RETRIES - 1:
            raise SourceUnavailable(f"{url}: {error}") from error
        time.sleep(2 ** attempt * 5)

    # Erst vollstaendig empfangen, dann ablegen: ein halber Download im Cache
    # saehe beim naechsten Lauf wie eine gueltige Datei aus.
    partial = target.with_suffix(target.suffix + ".part")
    partial.write_bytes(payload)
    partial.replace(target)
    return payload
