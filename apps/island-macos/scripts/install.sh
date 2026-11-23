#!/usr/bin/env bash
#
# Install Token Island for the current user and start it at login.
# No sudo required.
#
#   bash apps/island-macos/scripts/install.sh
#
# Actions:
#   1. builds the app bundle if needed (scripts/build-app.sh)
#   2. copies it to ~/Applications/TokenIsland.app
#   3. writes ~/Library/LaunchAgents/com.token-island.app.plist
#      (RunAtLoad true, KeepAlive false, LimitLoadToSessionType Aqua)
#   4. kills a running instance, then launchctl load -w
#
# Uninstall with scripts/uninstall.sh.

set -euo pipefail

APP_NAME="TokenIsland"
BUNDLE_ID="com.token-island.app"
LABEL="$BUNDLE_ID"

ISLAND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_APP="$ISLAND_DIR/build/$APP_NAME.app"
TARGET_APP="$HOME/Applications/$APP_NAME.app"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST="$LAUNCH_AGENTS/$LABEL.plist"

if [[ ! -d "$SOURCE_APP" ]]; then
    echo "==> app bundle missing, building first"
    bash "$ISLAND_DIR/scripts/build-app.sh"
fi

echo "==> stopping any running instance"
pkill -f "$TARGET_APP/Contents/MacOS/$APP_NAME" 2>/dev/null || true
pkill -f "$SOURCE_APP/Contents/MacOS/$APP_NAME" 2>/dev/null || true
# Give the app a moment to exit gracefully.
sleep 0.3

echo "==> installing to $TARGET_APP"
mkdir -p "$HOME/Applications"
rm -rf "$TARGET_APP"
cp -R "$SOURCE_APP" "$TARGET_APP"
xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true

echo "==> writing LaunchAgent $PLIST"
mkdir -p "$LAUNCH_AGENTS"

# Unload a previously installed agent so launchd picks up the new plist.
launchctl unload -w "$PLIST" 2>/dev/null || true

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$TARGET_APP/Contents/MacOS/$APP_NAME</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>LimitLoadToSessionType</key>
    <string>Aqua</string>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>/tmp/token-island.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/token-island.err.log</string>
</dict>
</plist>
PLIST_EOF

plutil -lint "$PLIST" >/dev/null

echo "==> loading LaunchAgent"
launchctl load -w "$PLIST"

echo "==> installed: $TARGET_APP"
echo "    log:       /tmp/token-island.log"
echo "    uninstall: bash $ISLAND_DIR/scripts/uninstall.sh"
