"""Downloads mit lokalem Cache.

Rohdaten werden nie eingecheckt, aber auch nie zweimal geladen. Der Cache ist
inhaltsgleich zur Quelle; geloescht werden kann er jederzeit gefahrlos.
"""

from __future__ import annotations

import urllib.error
import urllib.request
from pathlib import Path

# MeteoSchweiz liefert ohne User-Agent teils 403 zurueck.
USER_AGENT = "ocbl-data/0.1 (+https://github.com/) Python-urllib"

DEFAULT_CACHE = Path(__file__).resolve().parents[1] / "cache"


def fetch(url: str, cache_dir: Path | None = None, refresh: bool = False) -> bytes:
    """Laedt eine URL, mit Cache auf der Platte. Gibt die Rohbytes zurueck."""
    cache_dir = cache_dir or DEFAULT_CACHE
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / url.rsplit("/", 1)[-1]

    if target.exists() and not refresh:
        return target.read_bytes()

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} fuer {url}") from exc

    target.write_bytes(payload)
    return payload
