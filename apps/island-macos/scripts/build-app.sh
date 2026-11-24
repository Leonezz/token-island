#!/usr/bin/env bash
#
# Build the Token Island macOS app bundle (V3 selective dot-matrix app).
#
#   bash apps/island-macos/scripts/build-app.sh
#
# Steps:
#   1. swift build -c release (no external dependencies)
#   2. assemble build/TokenIsland.app: binary, Info.plist, AppIcon.icns,
#      Silkscreen fonts + OFL licenses, demo fixture
#   3. ad-hoc codesign the bundle (`codesign --force --deep --sign -`)
#   4. verify with `codesign --verify --deep --strict`
#
# Output: apps/island-macos/build/TokenIsland.app
# LSUIElement menu-bar app: run with `open` or execute Contents/MacOS/TokenIsland.
# Fails loudly when the app icon or the bundled fonts are missing.

set -euo pipefail

APP_NAME="TokenIsland"
BUNDLE_ID="com.token-island.app"
VERSION="0.4.0"
BUILD_VERSION="1"

ISLAND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ISLAND_DIR/../.." && pwd)"
BUILD_DIR="$ISLAND_DIR/build"
APP="$BUILD_DIR/$APP_NAME.app"
CONFIG="release"

ICON_SRC="$REPO_ROOT/assets/appicon/AppIcon.icns"
FONT_DIR="$REPO_ROOT/assets/fonts"
FONT_REGULAR="$FONT_DIR/Silkscreen-Regular.ttf"
FONT_BOLD="$FONT_DIR/Silkscreen-Bold.ttf"
OFL_SILKSCREEN="$FONT_DIR/OFL-ofl-silkscreen.txt"
OFL_VT323="$FONT_DIR/OFL-ofl-vt323.txt"
PIXEL_GLYPHS="$FONT_DIR/pixel-glyphs.json"
FIXTURE="$REPO_ROOT/fixtures/summary.example.json"

fail() { echo "error: $*" >&2; exit 1; }

echo "==> checking required resources"
for path in "$ICON_SRC" "$FONT_REGULAR" "$FONT_BOLD" "$OFL_SILKSCREEN" "$OFL_VT323" "$PIXEL_GLYPHS"; do
    [[ -f "$path" ]] || fail "missing required resource: $path"
done
[[ -s "$ICON_SRC" ]] || fail "app icon is empty: $ICON_SRC"

echo "==> swift build -c $CONFIG"
# --disable-sandbox: SwiftPM's manifest/plugin sandbox uses sandbox-exec, which is
# unavailable in some restricted/CI environments. Not needed for this package.
swift build -c "$CONFIG" --package-path "$ISLAND_DIR" --disable-sandbox
BIN_DIR="$(swift build -c "$CONFIG" --package-path "$ISLAND_DIR" --disable-sandbox --show-bin-path)"
BIN="$BIN_DIR/$APP_NAME"
[[ -x "$BIN" ]] || fail "expected binary at $BIN"

echo "==> assembling $APP"
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

# App icon (contract §1.4).
cp "$ICON_SRC" "$APP/Contents/Resources/AppIcon.icns"
[[ -s "$APP/Contents/Resources/AppIcon.icns" ]] || fail "AppIcon.icns was not copied"

# Silkscreen TTFs + the two OFL license files (contract §1.4).
cp "$FONT_REGULAR" "$APP/Contents/Resources/fonts/Silkscreen-Regular.ttf"
cp "$FONT_BOLD" "$APP/Contents/Resources/fonts/Silkscreen-Bold.ttf"
cp "$OFL_SILKSCREEN" "$APP/Contents/Resources/fonts/OFL-ofl-silkscreen.txt"
cp "$OFL_VT323" "$APP/Contents/Resources/fonts/OFL-ofl-vt323.txt"
for font in Silkscreen-Regular.ttf Silkscreen-Bold.ttf OFL-ofl-silkscreen.txt OFL-ofl-vt323.txt; do
    [[ -s "$APP/Contents/Resources/fonts/$font" ]] || fail "font resource missing: $font"
done

# V3 dot-matrix glyphs (hero figure): loaded once at launch from Resources/.
cp "$PIXEL_GLYPHS" "$APP/Contents/Resources/pixel-glyphs.json"
[[ -s "$APP/Contents/Resources/pixel-glyphs.json" ]] || fail "pixel-glyphs.json was not copied"

# Demo fixture used by `--demo` and the snapshot renderer (repo-owned).
if [[ -f "$FIXTURE" ]]; then
    cp "$FIXTURE" "$APP/Contents/Resources/summary.example.json"
    echo "    resources: AppIcon.icns, fonts/ (2 ttf + 2 OFL), pixel-glyphs.json, summary.example.json"
else
    fail "missing fixture: $FIXTURE"
fi

# Quarantine attributes can make Gatekeeper complain locally.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# Validate the plist so a broken bundle never ships silently.
plutil -lint "$APP/Contents/Info.plist" >/dev/null || fail "invalid Info.plist"

echo "==> ad-hoc codesign"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/    /'
echo "==> codesign verify: OK"

echo "==> built: $APP"
echo "    identifier: $BUNDLE_ID  version: $VERSION ($BUILD_VERSION)  icon: AppIcon.icns"
echo "    run:   $APP/Contents/MacOS/$APP_NAME --demo"
echo "    snap:  $APP/Contents/MacOS/$APP_NAME --snapshot-all <dir> --scale 2"
echo "    next:  bash apps/island-macos/scripts/package-dmg.sh"
