#!/usr/bin/env bash
# Builds the GitHub Pages index.html correctly, in one command.
#
# Building with plain `marp ... -o index.html presentation.md` is NOT
# enough and produces a page with no working maps: presentation.md only
# ever contains inert <div class="map-slot"> placeholders (Marp escapes a
# literal <iframe>/<script> tag in markdown, even with html: true), so
# scripts/inject_maps.py MUST run afterwards to turn those into real
# iframes. This wrapper does both steps so that can't be forgotten.
#
# Usage (from the repo root):
#   ./scripts/build_pages.sh
set -euo pipefail
cd "$(dirname "$0")/.."

marp --html --allow-local-files --theme-set theme/ecee2026.css -o index.html presentation.md
python3 scripts/inject_maps.py index.html

echo ""
echo "index.html is ready. Commit it along with maps/, figures/, assets/, logos/, theme/."
