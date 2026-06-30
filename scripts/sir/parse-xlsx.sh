#!/usr/bin/env bash
# Convert a "Karnataka_SIR_PART_WISE" .xlsx into a normalized daily snapshot JSON.
#
# Usage:
#   scripts/sir/parse-xlsx.sh <path-to.xlsx> <YYYY-MM-DD> > public/data/sir/<YYYY-MM-DD>.json
#
# No Node required — an .xlsx is a zip of XML; we unzip and read
# xl/sharedStrings.xml + xl/worksheets/sheet1.xml with perl (parse_sir.pl).
#
# After running, remember to add the date to public/data/sir/index.json.
set -euo pipefail

XLSX="${1:?usage: parse-xlsx.sh <file.xlsx> <YYYY-MM-DD>}"
DATE="${2:?usage: parse-xlsx.sh <file.xlsx> <YYYY-MM-DD>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

unzip -o -q "$XLSX" -d "$TMP"
perl "$HERE/parse_sir.pl" "$TMP" "$DATE"
