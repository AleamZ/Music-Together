#!/bin/sh
# Builds the offscreen gallery page and renders its sheets: run.sh <out-dir> [tag] [sheet-filter]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DIST=${TMPDIR:-/tmp}/chibi-gallery-dist
VITE=$(ls -d "$ROOT"/node_modules/.pnpm/vite@*/node_modules/vite/bin/vite.js 2>/dev/null | head -1)
[ -n "$VITE" ] || VITE="$ROOT/node_modules/vite/bin/vite.js"
VITE_TAG=${2:-after} OUT="$DIST" node "$VITE" build --config "$HERE/vite.config.mjs"
node "$HERE/render.mjs" "$DIST" "$1" "${3:-}"
