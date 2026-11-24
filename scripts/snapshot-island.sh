#!/usr/bin/env bash
#
# scripts/snapshot-island.sh — render the README screenshots of the pixel
# macOS Dynamic Island app (V2).
#
# 1. Regenerates fixtures/summary.example.json (`pnpm fixtures`) unless
#    --no-fixtures is passed (fixtures are committed; CI may not want to touch them).
# 2. If the app is built, renders the pixel snapshots at 2x into docs/images/:
#      island-collapsed.png             224x44 collapsed pill over pixel wallpaper
#      island-expanded.png              448x400 expanded panel over pixel wallpaper
#      island-offline.png               amber OFFLINE chrome over pixel wallpaper
#      island-expanded-transparent.png  expanded panel with alpha
#    using the snapshot CLI from docs/CONTRACT-V2.md §1.4 / docs/CONTRACT.md §7.5.
# 3. Copies a 512px app icon to docs/images/app-icon.png.
# 4. With --real <summary.json>, also renders island-expanded-real.png from the
#    given live Summary document (e.g. curl the collector API to a file first).
# 5. If the app is not built, prints SKIP and exits 0.
#
# Usage:
#   bash scripts/snapshot-island.sh
#   bash scripts/snapshot-island.sh --no-fixtures --real .runtime/real-summary.json

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP="$ROOT/apps/island-macos/build/TokenIsland.app/Contents/MacOS/TokenIsland"
OUT_DIR="$ROOT/docs/images"
FIXTURE="$ROOT/fixtures/summary.example.json"
APP_ICON="$ROOT/assets/appicon/icon-1024.png"
REAL_FIXTURE=""

REGEN_FIXTURES=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-fixtures)
      REGEN_FIXTURES=0
      shift
      ;;
    --real)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "ERROR: --real requires a Summary JSON path" >&2
        exit 2
      fi
      REAL_FIXTURE="$2"
      shift 2
      ;;
    --help|-h)
      sed -n '2,25p' "$0"
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$REGEN_FIXTURES" -eq 1 ]]; then
  echo "==> regenerating fixtures (fixtures/summary.example.json)"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm fixtures
  else
    node --import tsx scripts/gen-fixtures.ts
  fi
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
  local out="$1" state="$2" background="$3" fixture="$4"
  echo "==> rendering docs/images/$out (state=$state, background=$background, scale=2)"
  "$APP" \
    --snapshot "$OUT_DIR/$out" \
    --state "$state" \
    --background "$background" \
    --scale 2 \
    --fixture "$fixture"
}

render island-collapsed.png            collapsed wallpaper "$FIXTURE"
render island-expanded.png             expanded  wallpaper "$FIXTURE"
render island-offline.png              offline   wallpaper "$FIXTURE"
render island-expanded-transparent.png expanded  transparent "$FIXTURE"

if [[ -n "$REAL_FIXTURE" ]]; then
  if [[ ! -f "$REAL_FIXTURE" ]]; then
    echo "ERROR: real Summary fixture missing: $REAL_FIXTURE" >&2
    exit 1
  fi
  render island-expanded-real.png expanded wallpaper "$REAL_FIXTURE"
fi

if [[ -f "$APP_ICON" ]] && command -v sips >/dev/null 2>&1; then
  echo "==> writing docs/images/app-icon.png (512px)"
  sips -Z 512 "$APP_ICON" --out "$OUT_DIR/app-icon.png" >/dev/null
fi

echo
echo "==> wrote:"
ls -lh "$OUT_DIR"/island-*.png "$OUT_DIR"/app-icon.png
