#!/usr/bin/env bash
# Erzeugt die browserfaehigen Artefakte fuer web/.
#
# Zwei Schritte, beide reproduzierbar, beide gitignoriert:
#   1. tsc uebersetzt core/src nach natives ESM — kein Bundler, siehe ADR 0006
#   2. die vom ETL gebauten Stationsjahre werden neben die Seite gelegt

set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Rechenkern nach ESM uebersetzen =="
(cd core && npx tsc -p tsconfig.build.json)
echo "   web/vendor/core/  $(find web/vendor/core -name '*.js' | wc -l | tr -d ' ') Module"

echo "== Daten bereitstellen =="
if [ ! -f data/build/catalog.json ]; then
  echo "   data/build/catalog.json fehlt."
  echo "   Zuerst:  cd data && python3 -m ocbl_data build --station SMA --from 2019 --to 2024"
  exit 1
fi
# Symlink statt Kopie: der Datenstand ist mit 138 MB zu gross, um ihn bei
# jedem Build zu duplizieren — erst recht in einem synchronisierten Ordner.
rm -rf web/data
ln -s ../data/build web/data
echo "   web/data -> data/build  ($(find -L web/data -name '*.ocbl' | wc -l | tr -d ' ') Stationsjahre, $(du -shL web/data | cut -f1))"

echo
echo "Fertig. Lokal ansehen:"
echo "  cd web && python3 -m http.server 8000"
echo "  http://localhost:8000"
