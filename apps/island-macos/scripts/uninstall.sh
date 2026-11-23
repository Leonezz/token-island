#!/usr/bin/env bash
#
# Uninstall Token Island for the current user (reverses scripts/install.sh).
# No sudo required.
#
#   bash apps/island-macos/scripts/uninstall.sh

set -euo pipefail

APP_NAME="TokenIsland"
BUNDLE_ID="com.token-island.app"
LABEL="$BUNDLE_ID"

TARGET_APP="$HOME/Applications/$APP_NAME.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "==> stopping any running instance"
pkill -f "$TARGET_APP/Contents/MacOS/$APP_NAME" 2>/dev/null || true
pkill -f "TokenIsland.app/Contents/MacOS/$APP_NAME" 2>/dev/null || true
sleep 0.2

if [[ -f "$PLIST" ]]; then
    echo "==> unloading LaunchAgent"
    launchctl unload -w "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
fi

# Older launchctl bootout syntax, just in case the agent is still registered.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

if [[ -d "$TARGET_APP" ]]; then
    echo "==> removing $TARGET_APP"
    rm -rf "$TARGET_APP"
fi

echo "==> uninstalled Token Island"
