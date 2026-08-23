"""Kommandozeile des ETL.

    python -m ocbl_data build --station SMA --from 2020 --to 2024
    python -m ocbl_data stations --canton ZH
    python -m ocbl_data verify
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import catalog as catalog_mod
from .pack import pack_year
from .qa import check_dew_point
from .http import fetch
from .smn import available_years, load_year
from .stations import load_stations

DATA_ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = DATA_ROOT / "build"
CACHE_DIR = DATA_ROOT / "cache"


def cmd_stations(args: argparse.Namespace) -> int:
    stations = load_stations(cache_dir=CACHE_DIR)
    rows = sorted(stations.values(), key=lambda s: s.abbr)
    if args.canton:
        rows = [s for s in rows if s.canton.upper() == args.canton.upper()]
    print(f"{'Kuerzel':8s} {'Kanton':7s} {'Hoehe':>8s}  Name")
    for s in rows:
        print(f"{s.abbr:8s} {s.canton:7s} {s.altitude_m:8.0f}  {s.name}")
    print(f"\n{len(rows)} Stationen")
    return 0


def _prefetch(targets: list[str], years_by_station: dict, cache_dir: Path, refresh: bool, jobs: int) -> None:
    """Laedt die Dekadendateien nebenlaeufig vor.

    Die Downloads sind der langsame Teil und haengen am Netz, nicht an der CPU
    — Threads reichen. Das Packen bleibt seriell und damit nachvollziehbar.
    """
    from .smn import decade_url, recent_url

    urls: set[str] = set()
    for abbr in targets:
        slug = abbr.lower()
        for year in years_by_station.get(abbr, []):
            urls.add(decade_url(slug, year))
        urls.add(recent_url(slug))

    todo = [u for u in sorted(urls) if not (cache_dir / u.rsplit("/", 1)[-1]).exists() or refresh]
    if not todo:
        return

    print(f"Lade {len(todo)} Dateien mit {jobs} parallelen Verbindungen …")
    done = 0

    def grab(url: str) -> None:
        nonlocal done
        try:
            fetch(url, cache_dir=cache_dir, refresh=refresh)
        except RuntimeError:
            pass  # nicht jede Station hat jede Dekade
        done += 1
        if done % 25 == 0 or done == len(todo):
            print(f"  {done}/{len(todo)}")

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        list(pool.map(grab, todo))


def cmd_build(args: argparse.Namespace) -> int:
    cache_dir = Path(args.cache_dir).expanduser() if args.cache_dir else CACHE_DIR
    stations = load_stations(cache_dir=cache_dir)

    targets = [s.upper() for s in args.station] if args.station else sorted(stations)
    unknown = [s for s in targets if s not in stations]
    if unknown:
        print(f"Unbekannte Station(en): {', '.join(unknown)}", file=sys.stderr)
        return 2

    cat = catalog_mod.load(BUILD_DIR)
    built = 0
    failed = 0

    years_by_station = {}
    for abbr in targets:
        years = [y for y in available_years(abbr, cache_dir=cache_dir) if args.year_from <= y <= args.year_to]
        if years:
            years_by_station[abbr] = years

    if args.jobs > 1:
        _prefetch(targets, years_by_station, cache_dir, args.refresh, args.jobs)

    for abbr in targets:
        station = stations[abbr]
        years = years_by_station.get(abbr, [])
        if not years:
            print(f"{abbr}: keine Jahre im Bereich {args.year_from}-{args.year_to}")
            continue

        if not args.quiet:
            print(f"\n{abbr} — {station.name} ({station.altitude_m:.0f} m ue. M.)")
        for year in years:
            try:
                data = load_year(abbr, year, cache_dir=cache_dir, refresh=args.refresh)
            except RuntimeError as exc:
                if not args.quiet:
                    print(f"  {year}  uebersprungen: {exc}")
                failed += 1
                continue

            out_path = BUILD_DIR / "smn" / station.slug / f"{year}.ocbl"
            try:
                report = pack_year(data, station, out_path)
            except RuntimeError as exc:
                if not args.quiet:
                    print(f"  {year}  uebersprungen: {exc}")
                failed += 1
                continue
            catalog_mod.upsert(cat, station, year, report, BUILD_DIR)
            built += 1

            temp_complete = report.completeness.get("tre200h0", 0.0)
            note = ""
            if args.qa:
                check = check_dew_point(data)
                if check:
                    note = f"  Taupunkt-Bias {check.mean_bias_k:+.3f} K"
            if not args.quiet:
                print(
                    f"  {year}  {report.bytes_written / 1024:6.1f} kB  "
                    f"{len(report.variables):2d} Var  T {temp_complete * 100:5.1f} %"
                    f"  {report.sha256[:12]}{note}"
                )

    path = catalog_mod.save(cat, BUILD_DIR)
    print(f"\n{built} Stationsjahre gebaut, {failed} uebersprungen")
    print(f"Katalog: {path}")
    return 1 if failed and not built else 0


def cmd_scenarios(args: argparse.Namespace) -> int:
    """Baut die DRY-Szenariodatensaetze."""
    from . import dry
    from . import scenario_catalog
    from .pack import pack_scenario
    from .qa import check_radiation_decomposition

    cache_dir = Path(args.cache_dir).expanduser() if args.cache_dir else CACHE_DIR
    print("Lade Archiv (33 MB, einmalig) …")
    archive = dry.open_archive(cache_dir=cache_dir, refresh=args.refresh)
    stations = dry.load_stations(archive)
    keys = dry.available(archive)

    if args.station:
        wanted = {s.upper() for s in args.station}
        keys = [k for k in keys if k.station in wanted]
    if args.kind:
        keys = [k for k in keys if k.kind == args.kind]

    cat = scenario_catalog.empty()
    built = 0
    current = None

    for key in keys:
        station = stations.get(key.station)
        if station is None:
            print(f"  {key.station}: nicht in den Metadaten, uebersprungen")
            continue

        data = dry.load(archive, key)
        out_path = BUILD_DIR / "dry" / station.slug / f"{key.slug}.ocbl"
        report = pack_scenario(data, station, out_path)
        scenario_catalog.upsert(cat, station, key, report, BUILD_DIR)
        built += 1

        if not args.quiet:
            if current != key.station:
                current = key.station
                print(f"\n{station.abbr} — {station.name} ({station.altitude_m:.0f} m ue. M.)")
            note = ""
            if args.qa:
                check = check_radiation_decomposition(data, station.lat, station.lon)
                if check:
                    note = f"  Strahlungsbilanz {check.mean_abs_error:5.2f} W/m²"
            print(
                f"  {key.slug:22s} {report.bytes_written / 1024:6.1f} kB  "
                f"{len(report.variables)} Var  {report.sha256[:12]}{note}"
            )

    path = scenario_catalog.save(cat, BUILD_DIR)
    print(f"\n{built} Szenariojahre gebaut")
    print(f"Katalog: {path}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    from . import scenario_catalog

    bad = 0
    checked = 0

    def check(label: str, meta: dict) -> None:
        nonlocal bad, checked
        path = BUILD_DIR / meta["path"]
        checked += 1
        if not path.exists():
            print(f"FEHLT   {label}  {meta['path']}")
            bad += 1
            return
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != meta["sha256"]:
            print(f"ABWEICH {label}  {actual[:12]} statt {meta['sha256'][:12]}")
            bad += 1

    cat = catalog_mod.load(BUILD_DIR)
    for abbr, entry in cat["stations"].items():
        for year, meta in entry["years"].items():
            check(f"{abbr} {year}", meta)

    scen = scenario_catalog.load(BUILD_DIR)
    for abbr, entry in scen["stations"].items():
        for slug, meta in entry["variants"].items():
            check(f"{abbr} {slug}", meta)

    print(f"{checked} Dateien geprueft, {bad} beanstandet")
    return 1 if bad else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ocbl_data", description="ETL des Open Climate Building Lab")
    sub = parser.add_subparsers(dest="command", required=True)

    p_stations = sub.add_parser("stations", help="Stationsverzeichnis anzeigen")
    p_stations.add_argument("--canton", help="auf einen Kanton filtern")
    p_stations.set_defaults(func=cmd_stations)

    p_build = sub.add_parser("build", help="Stationsjahre nach .ocbl packen")
    p_build.add_argument("--station", action="append", help="Stationskuerzel; mehrfach moeglich. Ohne Angabe: alle")
    p_build.add_argument("--from", dest="year_from", type=int, default=1990)
    p_build.add_argument("--to", dest="year_to", type=int, default=2025)
    p_build.add_argument("--refresh", action="store_true", help="Cache umgehen")
    p_build.add_argument("--qa", action="store_true", help="Taupunkt-Kreuzvergleich mitlaufen lassen")
    p_build.add_argument("--quiet", action="store_true", help="nur die Zusammenfassung ausgeben")
    p_build.add_argument("--jobs", type=int, default=8, help="parallele Downloads (Standard 8, 1 = seriell)")
    p_build.add_argument(
        "--cache-dir",
        help="Ablage der Rohdaten. Sinnvoll ausserhalb synchronisierter Ordner, "
        "wenn viele Stationen gebaut werden.",
    )
    p_build.set_defaults(func=cmd_build)

    p_scen = sub.add_parser("scenarios", help="DRY-Klimaszenarien nach .ocbl packen")
    p_scen.add_argument("--station", action="append", help="Stationskuerzel; mehrfach moeglich")
    p_scen.add_argument("--kind", choices=["DRY", "1in10-warmsummer"], help="nur einen Typ bauen")
    p_scen.add_argument("--refresh", action="store_true", help="Archiv neu laden")
    p_scen.add_argument("--qa", action="store_true", help="Strahlungsbilanz kreuzpruefen")
    p_scen.add_argument("--quiet", action="store_true", help="nur die Zusammenfassung")
    p_scen.add_argument("--cache-dir", help="Ablage des Archivs")
    p_scen.set_defaults(func=cmd_scenarios)

    p_verify = sub.add_parser("verify", help="Pruefsummen beider Kataloge nachrechnen")
    p_verify.set_defaults(func=cmd_verify)

    args = parser.parse_args(argv)
    return args.func(args)
