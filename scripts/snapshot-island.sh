#!/usr/bin/env bash
#
# scripts/snapshot-island.sh — render the README screenshots of the macOS
# Dynamic Island widget.
#
# 1. Regenerates fixtures/summary.example.json (`pnpm fixtures`).
# 2. If the widget has been built, renders four PNGs at 2x into docs/images/:
#      island-collapsed.png             collapsed pill over wallpaper
#      island-expanded.png              expanded panel over wallpaper
#      island-offline.png               offline state over wallpaper
#      island-expanded-transparent.png  expanded panel with alpha
#    using the snapshot CLI from docs/CONTRACT.md §7.5.
# 3. If the widget is not built, prints SKIP and exits 0.
#
# Usage: bash scripts/snapshot-island.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP="$ROOT/apps/island-macos/build/TokenIsland.app/Contents/MacOS/TokenIsland"
OUT_DIR="$ROOT/docs/images"
FIXTURE="$ROOT/fixtures/summary.example.json"

echo "==> regenerating fixtures (fixtures/summary.example.json)"
if command -v pnpm >/dev/null 2>&1; then
  pnpm fixtures
else
  node --import tsx scripts/gen-fixtures.ts
fi

if [[ ! -x "$APP" ]]; then
  echo "SKIP: the macOS widget is not built yet."
  echo "      expected: apps/island-macos/build/TokenIsland.app/Contents/MacOS/TokenIsland"
  echo "      build it first: pnpm island:build"
  exit 0
fi

if [[ ! -f "$FIXTURE" ]]; then
  echo "ERROR: fixture missing: $FIXTURE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

render() {
  local out="$1" state="$2" background="$3"
  echo "==> rendering docs/images/$out (state=$state, background=$background, scale=2)"
  "$APP" \
    --snapshot "$OUT_DIR/$out" \
    --state "$state" \
    --background "$background" \
    --scale 2 \
    --fixture "$FIXTURE"
}

render island-collapsed.png            collapsed wallpaper
render island-expanded.png             expanded  wallpaper
render island-offline.png              offline   wallpaper
render island-expanded-transparent.png expanded  transparent

echo
echo "==> wrote:"
ls -lh "$OUT_DIR"/island-*.png
