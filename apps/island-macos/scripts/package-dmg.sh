#!/usr/bin/env bash
#
# Package Token Island as a drag-to-Applications DMG.
#
#   bash apps/island-macos/scripts/package-dmg.sh [--universal] [--no-build] [--output <path>]
#
# Environment overrides:
#   VERSION         release version (default: root package.json)
#   SIGN_IDENTITY   optional Developer ID Application identity to sign app + DMG

set -euo pipefail

APP_NAME="TokenIsland"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
UNIVERSAL=0
NO_BUILD=0
CUSTOM_DMG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --universal) UNIVERSAL=1; shift ;;
        --no-build) NO_BUILD=1; shift ;;
        --output) CUSTOM_DMG="${2:?--output requires a path}"; shift 2 ;;
        --output=*) CUSTOM_DMG="${1#*=}"; shift ;;
        *) echo "error: unknown option $1" >&2; exit 2 ;;
    esac
done

ISLAND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ISLAND_DIR/../.." && pwd)"
BUILD_DIR="$ISLAND_DIR/build"
APP="$BUILD_DIR/$APP_NAME.app"

if [[ -z "${VERSION:-}" ]]; then
    if command -v node >/dev/null 2>&1 && [[ -f "$REPO_ROOT/package.json" ]]; then
        VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$REPO_ROOT/package.json','utf8')).version || '0.4.0'")"
    else
        VERSION="0.4.0"
    fi
fi

VOLUME_NAME="Token Island $VERSION"
STAGING="$BUILD_DIR/dmg-staging"
MOUNT="$BUILD_DIR/dmg-mnt"
TEMP_HYBRID="$BUILD_DIR/.dmg-hybrid.dmg"
TEMP_RW="$BUILD_DIR/.dmg-rw.dmg"

if [[ -n "$CUSTOM_DMG" ]]; then
    DMG="$CUSTOM_DMG"
elif [[ "$UNIVERSAL" -eq 1 ]]; then
    DMG="$BUILD_DIR/$APP_NAME-$VERSION-universal.dmg"
else
    DMG="$BUILD_DIR/$APP_NAME-$VERSION.dmg"
fi

fail() { echo "error: $*" >&2; exit 1; }

cleanup() {
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
    rm -rf "$STAGING" "$MOUNT"
    rm -f "$TEMP_HYBRID" "$TEMP_RW"
}
trap cleanup EXIT

if [[ "$NO_BUILD" -eq 0 ]]; then
    BUILD_ARGS=()
    [[ "$UNIVERSAL" -eq 1 ]] && BUILD_ARGS+=(--universal)
    SIGN_IDENTITY="$SIGN_IDENTITY" VERSION="$VERSION" bash "$ISLAND_DIR/scripts/build-app.sh" "${BUILD_ARGS[@]}"
fi

[[ -d "$APP" ]] || fail "app bundle missing: $APP"
codesign --verify --deep --strict "$APP" || fail "app bundle signature is invalid"

echo "==> staging DMG contents"
rm -rf "$STAGING"
mkdir -p "$STAGING" "$(dirname "$DMG")"
cp -R "$APP" "$STAGING/$APP_NAME.app"
ln -s /Applications "$STAGING/Applications"

rm -f "$DMG"
echo "==> creating $DMG (UDZO, volume: $VOLUME_NAME)"
hdiutil detach "/Volumes/$VOLUME_NAME" >/dev/null 2>&1 || true

if hdiutil create -volname "$VOLUME_NAME" -srcfolder "$STAGING" -ov -format UDZO "$DMG" >/dev/null 2>&1; then
    echo "    created with hdiutil create -srcfolder"
else
    echo "    hdiutil create unavailable in this sandbox; using the makehybrid fallback"
    rm -f "$DMG" "$TEMP_HYBRID" "$TEMP_RW"
    hdiutil makehybrid -hfs -hfs-volume-name "$VOLUME_NAME" -o "$TEMP_HYBRID" "$STAGING" >/dev/null
    hdiutil convert "$TEMP_HYBRID" -format UDRW -o "$TEMP_RW" >/dev/null
    hdiutil resize -size 48m "$TEMP_RW" >/dev/null
    mkdir -p "$MOUNT"
    hdiutil attach "$TEMP_RW" -mountpoint "$MOUNT" -noverify -noautoopen >/dev/null
    xattr -cr "$MOUNT/$APP_NAME.app" 2>/dev/null || true
    rm -rf "$MOUNT/.fseventsd" "$MOUNT/.Trashes" 2>/dev/null || true
    hdiutil detach "$MOUNT" >/dev/null
    hdiutil convert "$TEMP_RW" -format UDZO -o "$DMG" >/dev/null
fi

[[ -s "$DMG" ]] || fail "hdiutil did not create $DMG"

if [[ "$SIGN_IDENTITY" != "-" && -n "$SIGN_IDENTITY" ]]; then
    echo "==> signing DMG ($SIGN_IDENTITY)"
    codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG"
fi

echo "==> hdiutil verify"
hdiutil verify "$DMG" | sed 's/^/    /'

SIZE="$(du -h "$DMG" | awk '{print $1}')"
echo "==> packaged: $DMG ($SIZE)"
