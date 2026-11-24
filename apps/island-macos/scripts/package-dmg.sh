#!/usr/bin/env bash
#
# Package Token Island as a drag-to-Applications DMG.
#
#   bash apps/island-macos/scripts/package-dmg.sh
#
# Steps:
#   1. build + ad-hoc sign the app bundle (scripts/build-app.sh)
#   2. stage TokenIsland.app + an `Applications` -> /Applications symlink
#   3. create apps/island-macos/build/TokenIsland-0.2.0.dmg (UDZO)
#   4. hdiutil verify the image, codesign-verify the app inside it, print size
#
# The standard `hdiutil create -srcfolder` path is tried first. In restricted
# build sandboxes (where writing into a mounted /Volumes is not allowed) the
# script falls back to building the HFS volume in user space with
# `hdiutil makehybrid`, stripping the FinderInfo xattrs makehybrid adds on a
# workspace-local read-write mount, then converting to UDZO. The resulting image
# has identical contents.
#
# No sudo required. The DMG is ad-hoc signed, not notarized: a downloaded copy
# needs the usual macOS Gatekeeper "Open Anyway" flow.

set -euo pipefail

APP_NAME="TokenIsland"
VERSION="0.2.0"
VOLUME_NAME="Token Island $VERSION"

ISLAND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ISLAND_DIR/build"
APP="$BUILD_DIR/$APP_NAME.app"
STAGING="$BUILD_DIR/dmg-staging"
MOUNT="$BUILD_DIR/dmg-mnt"
TEMP_HYBRID="$BUILD_DIR/.dmg-hybrid.dmg"
TEMP_RW="$BUILD_DIR/.dmg-rw.dmg"
DMG="$BUILD_DIR/$APP_NAME-$VERSION.dmg"

fail() { echo "error: $*" >&2; exit 1; }

cleanup() {
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
    rm -rf "$STAGING" "$MOUNT"
    rm -f "$TEMP_HYBRID" "$TEMP_RW"
}
trap cleanup EXIT

bash "$ISLAND_DIR/scripts/build-app.sh"
[[ -d "$APP" ]] || fail "app bundle missing after build: $APP"
codesign --verify --deep --strict "$APP" || fail "app bundle signature is invalid"

echo "==> staging DMG contents"
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/$APP_NAME.app"
ln -s /Applications "$STAGING/Applications"

rm -f "$DMG"
echo "==> creating $DMG (UDZO, volume: $VOLUME_NAME)"
hdiutil detach "/Volumes/$VOLUME_NAME" >/dev/null 2>&1 || true

if hdiutil create -volname "$VOLUME_NAME" -srcfolder "$STAGING" -ov -format UDZO "$DMG" >/dev/null 2>&1; then
    echo "    created with hdiutil create -srcfolder"
else
    echo "    hdiutil create unavailable in this sandbox; using the makehybrid fallback"
    rm -f "$DMG"
    rm -f "$TEMP_HYBRID" "$TEMP_RW"
    hdiutil makehybrid -hfs -hfs-volume-name "$VOLUME_NAME" -o "$TEMP_HYBRID" "$STAGING" >/dev/null
    hdiutil convert "$TEMP_HYBRID" -format UDRW -o "$TEMP_RW" >/dev/null
    hdiutil resize -size 32m "$TEMP_RW" >/dev/null
    mkdir -p "$MOUNT"
    hdiutil attach "$TEMP_RW" -mountpoint "$MOUNT" -noverify -noautoopen >/dev/null
    # makehybrid writes ISO-compat FinderInfo xattrs; codesign treats those as
    # invalid attached data, so strip them before sealing the image.
    xattr -cr "$MOUNT/$APP_NAME.app" 2>/dev/null || true
    rm -rf "$MOUNT/.fseventsd" "$MOUNT/.Trashes" 2>/dev/null || true
    hdiutil detach "$MOUNT" >/dev/null
    hdiutil convert "$TEMP_RW" -format UDZO -o "$DMG" >/dev/null
fi

[[ -s "$DMG" ]] || fail "hdiutil did not create $DMG"

echo "==> hdiutil verify"
hdiutil verify "$DMG" | sed 's/^/    /'

# Read-only content check: app bundle present, Applications symlink present and
# the ad-hoc signature still valid inside the image.
echo "==> content check"
CONTENT_MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/token-island-dmg.XXXXXX")"
if hdiutil attach -readonly -noautoopen -noverify -mountpoint "$CONTENT_MOUNT" "$DMG" >/dev/null 2>&1; then
    [[ -d "$CONTENT_MOUNT/$APP_NAME.app" ]] || { hdiutil detach "$CONTENT_MOUNT" >/dev/null 2>&1; fail "DMG is missing $APP_NAME.app"; }
    [[ -L "$CONTENT_MOUNT/Applications" ]] || { hdiutil detach "$CONTENT_MOUNT" >/dev/null 2>&1; fail "DMG is missing the Applications symlink"; }
    if codesign --verify --deep --strict "$CONTENT_MOUNT/$APP_NAME.app" 2>/dev/null; then
        echo "    contents: $APP_NAME.app + Applications symlink, signature valid inside image"
    else
        echo "    warning: codesign verify failed for the app inside the DMG" >&2
    fi
    hdiutil detach "$CONTENT_MOUNT" >/dev/null 2>&1 || true
else
    echo "    (skipped: could not mount the image read-only in this environment)"
fi
rmdir "$CONTENT_MOUNT" 2>/dev/null || true

SIZE="$(du -h "$DMG" | awk '{print $1}')"
echo "==> packaged: $DMG ($SIZE)"
echo "    format:   UDZO (compressed HFS volume '$VOLUME_NAME')"
echo "    verify:   hdiutil verify $DMG"
