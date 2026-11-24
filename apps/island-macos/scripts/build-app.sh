#!/usr/bin/env bash
#
# Build the Token Island macOS app bundle.
#
#   bash apps/island-macos/scripts/build-app.sh [--universal]
#
# Environment overrides:
#   VERSION         app version (default: read from root package.json)
#   BUILD_VERSION   CFBundleVersion build number (default: 1)
#   SIGN_IDENTITY   codesign identity; "-" (default) uses ad-hoc signing,
#                   or pass "Developer ID Application: Hanzhen Hong (7Z39KUX3QC)"
#                   for Hardened Runtime + timestamped release signing.
#
# Output: apps/island-macos/build/TokenIsland.app

set -euo pipefail

APP_NAME="TokenIsland"
BUNDLE_ID="com.token-island.app"
BUILD_VERSION="${BUILD_VERSION:-1}"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
UNIVERSAL=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --universal) UNIVERSAL=1; shift ;;
        *) echo "error: unknown option $1" >&2; exit 2 ;;
    esac
done

ISLAND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ISLAND_DIR/../.." && pwd)"
BUILD_DIR="$ISLAND_DIR/build"
APP="$BUILD_DIR/$APP_NAME.app"
CONFIG="release"

if [[ -z "${VERSION:-}" ]]; then
    if command -v node >/dev/null 2>&1 && [[ -f "$REPO_ROOT/package.json" ]]; then
        VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$REPO_ROOT/package.json','utf8')).version || '0.4.0'")"
    else
        VERSION="0.4.0"
    fi
fi

ICON_SRC="$REPO_ROOT/assets/appicon/AppIcon.icns"
FONT_DIR="$REPO_ROOT/assets/fonts"
FONT_REGULAR="$FONT_DIR/Silkscreen-Regular.ttf"
FONT_BOLD="$FONT_DIR/Silkscreen-Bold.ttf"
OFL_SILKSCREEN="$FONT_DIR/OFL-ofl-silkscreen.txt"
OFL_VT323="$FONT_DIR/OFL-ofl-vt323.txt"
PIXEL_GLYPHS="$FONT_DIR/pixel-glyphs.json"
FIXTURE="$REPO_ROOT/fixtures/summary.example.json"
COLLECTOR_BUNDLE="$ISLAND_DIR/Resources/collector.mjs"
ENTITLEMENTS="$ISLAND_DIR/Resources/TokenIsland.entitlements"

fail() { echo "error: $*" >&2; exit 1; }

# Refresh the standalone collector bundle whenever node_modules is available.
if command -v node >/dev/null 2>&1 && [[ -d "$REPO_ROOT/node_modules" ]] && [[ -f "$REPO_ROOT/scripts/bundle-collector.mjs" ]]; then
    echo "==> bundling standalone collector.mjs"
    node "$REPO_ROOT/scripts/bundle-collector.mjs" --outfile "$COLLECTOR_BUNDLE"
fi

echo "==> checking required resources"
for path in "$ICON_SRC" "$FONT_REGULAR" "$FONT_BOLD" "$OFL_SILKSCREEN" "$OFL_VT323" "$PIXEL_GLYPHS" "$COLLECTOR_BUNDLE"; do
    [[ -f "$path" ]] || fail "missing required resource: $path"
done
[[ -s "$ICON_SRC" ]] || fail "app icon is empty: $ICON_SRC"
[[ -s "$COLLECTOR_BUNDLE" ]] || fail "collector.mjs bundle is empty: $COLLECTOR_BUNDLE"

ARCH_FLAGS=()
if [[ "$UNIVERSAL" -eq 1 ]]; then
    ARCH_FLAGS=(--arch arm64 --arch x86_64)
    echo "==> swift build -c $CONFIG (universal: arm64 + x86_64)"
else
    echo "==> swift build -c $CONFIG"
fi

swift build -c "$CONFIG" "${ARCH_FLAGS[@]}" --package-path "$ISLAND_DIR" --disable-sandbox
BIN_DIR="$(swift build -c "$CONFIG" "${ARCH_FLAGS[@]}" --package-path "$ISLAND_DIR" --disable-sandbox --show-bin-path)"
BIN="$BIN_DIR/$APP_NAME"
[[ -x "$BIN" ]] || fail "expected binary at $BIN"

echo "==> assembling $APP (v$VERSION)"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/fonts"
cp "$BIN" "$APP/Contents/MacOS/$APP_NAME"
chmod +x "$APP/Contents/MacOS/$APP_NAME"

# Info.plist + version keys.
cp "$ISLAND_DIR/Resources/Info.plist" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP/Contents/Info.plist" >/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist" >/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_VERSION" "$APP/Contents/Info.plist" >/dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile AppIcon" "$APP/Contents/Info.plist" >/dev/null
/usr/libexec/PlistBuddy -c "Set :LSApplicationCategoryType public.app-category.developer-tools" "$APP/Contents/Info.plist" >/dev/null

# App icon.
cp "$ICON_SRC" "$APP/Contents/Resources/AppIcon.icns"
[[ -s "$APP/Contents/Resources/AppIcon.icns" ]] || fail "AppIcon.icns was not copied"

# Fonts + OFL licenses.
cp "$FONT_REGULAR" "$APP/Contents/Resources/fonts/Silkscreen-Regular.ttf"
cp "$FONT_BOLD" "$APP/Contents/Resources/fonts/Silkscreen-Bold.ttf"
cp "$OFL_SILKSCREEN" "$APP/Contents/Resources/fonts/OFL-ofl-silkscreen.txt"
cp "$OFL_VT323" "$APP/Contents/Resources/fonts/OFL-ofl-vt323.txt"
for font in Silkscreen-Regular.ttf Silkscreen-Bold.ttf OFL-ofl-silkscreen.txt OFL-ofl-vt323.txt; do
    [[ -s "$APP/Contents/Resources/fonts/$font" ]] || fail "font resource missing: $font"
done

# Sprite/glyph table + standalone collector daemon + demo fixture.
cp "$PIXEL_GLYPHS" "$APP/Contents/Resources/pixel-glyphs.json"
cp "$COLLECTOR_BUNDLE" "$APP/Contents/Resources/collector.mjs"
chmod +x "$APP/Contents/Resources/collector.mjs"

if [[ -f "$FIXTURE" ]]; then
    cp "$FIXTURE" "$APP/Contents/Resources/summary.example.json"
    echo "    resources: AppIcon.icns, collector.mjs, fonts/, pixel-glyphs.json, summary.example.json"
else
    fail "missing fixture: $FIXTURE"
fi

xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
plutil -lint "$APP/Contents/Info.plist" >/dev/null || fail "invalid Info.plist"

if [[ "$SIGN_IDENTITY" != "-" && -n "$SIGN_IDENTITY" ]]; then
    echo "==> Developer ID codesign ($SIGN_IDENTITY, hardened runtime)"
    codesign --force --deep --options runtime --timestamp \
        --entitlements "$ENTITLEMENTS" \
        --sign "$SIGN_IDENTITY" "$APP"
else
    echo "==> ad-hoc codesign"
    codesign --force --deep --sign - "$APP"
fi

codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/    /'
echo "==> codesign verify: OK"

echo "==> built: $APP"
echo "    identifier: $BUNDLE_ID  version: $VERSION ($BUILD_VERSION)"
