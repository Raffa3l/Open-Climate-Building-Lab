#!/usr/bin/env bash
# Prueft die Vertraege zwischen Code und Dokumentation:
#   - jeder MethodRef.doc zeigt auf eine existierende Datei und Ueberschrift
#   - jeder sources-Schluessel ist in docs/methods/sources.md aufgeloest
#
# Ohne diese Pruefung verrotten die Verweise still, und der Knopf
# "Berechnung anzeigen" fuehrt ins Leere.
#
# Hinweis: die Schleifen lesen ueber Prozesssubstitution, nicht ueber eine
# Pipe. Eine Pipe wuerde den Schleifenrumpf in eine Subshell legen, in der
# `status=1` folgenlos bliebe — der Exit-Code waere dann immer 0.

set -uo pipefail
cd "$(dirname "$0")/.."

status=0

slugify() {
  # GitHub-Anker: Kleinschreibung, Satzzeichen weg, Leerzeichen zu Bindestrich.
  # Kleinschreibung mit Perl statt tr: GNU tr arbeitet bytweise und liess auf
  # Linux «Ü» stehen, das der sed-Filter danach verwarf. Auf macOS lief es.
  printf '%s' "$1" | perl -CSD -pe '$_ = lc' \
    | sed -E 's/[^a-z0-9äöüàéèç ._-]//g; s/ /-/g'
}

echo "== MethodRef.doc =="
while IFS= read -r ref; do
  file="${ref%%#*}"
  anchor="${ref#*#}"

  if [ ! -f "$file" ]; then
    echo "  FEHLT   $ref  (Datei nicht vorhanden)"
    status=1
    continue
  fi
  if [ "$anchor" = "$ref" ]; then
    echo "  OK      $ref"
    continue
  fi

  found=0
  while IFS= read -r heading; do
    if [ "$(slugify "$heading")" = "$anchor" ]; then
      found=1
      break
    fi
  done < <(grep -E '^#{1,6} ' "$file" | sed -E 's/^#{1,6} //')

  if [ "$found" = 1 ]; then
    echo "  OK      $ref"
  else
    echo "  ANKER   $ref  (Ueberschrift nicht gefunden)"
    status=1
  fi
done < <(grep -rhoE 'doc: "docs/methods/[^"]+"' core/src/ | sed 's/doc: "//; s/"$//' | sort -u)

echo "== sources-Schluessel =="
while IFS= read -r key; do
  if grep -qE "^### \`$key\`" docs/methods/sources.md; then
    echo "  OK      $key"
  else
    echo "  FEHLT   $key  (nicht in docs/methods/sources.md)"
    status=1
  fi
done < <(grep -rhoE 'sources: \[[^]]*\]' core/src/ | grep -oE '"[a-z0-9-]+"' | tr -d '"' | sort -u)

if [ "$status" -ne 0 ]; then
  echo
  echo "Verweise sind gebrochen. Entweder den MethodRef.doc korrigieren oder"
  echo "die Ueberschrift in docs/methods/ anpassen."
  echo "Hinweis: MethodRef.doc geht nicht in den Berechnungs-Hash ein — eine"
  echo "Korrektur bricht keine publizierten Permalinks."
fi

exit $status
