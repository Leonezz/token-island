#!/usr/bin/env bash
#
# Uninstall Token Island for the current user (reverses scripts/install.sh).
# No sudo required.
#
#   bash apps/island-macos/scripts/uninstall.sh [options]
#
# Options:
#   --destination <dir>     app install dir (default: ~/Applications;
#                           env TOKEN_ISLAND_APP_DIR)
#   --launch-agents <dir>   widget LaunchAgent dir (default: ~/Library/LaunchAgents;
#                           env TOKEN_ISLAND_LAUNCH_AGENTS_DIR)
#   --dry-run               print every action, change nothing
#   -h, --help              show this help
#
# Removes: the widget app, the widget LaunchAgent and the app's UserDefaults
# preferences. Collector autostart is CLI-owned and removed separately:
#
#   node bin/tokenisland.mjs uninstall      # widget + collector LaunchAgent
#
# Local usage data in ~/.token-island is intentionally kept (delete it manually
# to erase history).

set -euo pipefail

APP_NAME="TokenIsland"
BUNDLE_ID="com.token-island.app"
LABEL="$BUNDLE_ID"

ISLAND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINATION="${TOKEN_ISLAND_APP_DIR:-$HOME/Applications}"
LAUNCH_AGENTS="${TOKEN_ISLAND_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
DRY_RUN=0

usage() { sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --destination) DESTINATION="${2:?--destination needs a path}"; shift 2 ;;
        --destination=*) DESTINATION="${1#*=}"; shift ;;
        --launch-agents) LAUNCH_AGENTS="${2:?--launch-agents needs a path}"; shift 2 ;;
        --launch-agents=*) LAUNCH_AGENTS="${1#*=}"; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "error: unknown option $1" >&2; exit 2 ;;
    esac
done

TARGET_APP="$DESTINATION/$APP_NAME.app"
PLIST="$LAUNCH_AGENTS/$LABEL.plist"
IS_DEFAULT_APP_DIR=0
[[ "$DESTINATION" == "$HOME/Applications" ]] && IS_DEFAULT_APP_DIR=1
IS_DEFAULT_AGENT_DIR=0
[[ "$LAUNCH_AGENTS" == "$HOME/Library/LaunchAgents" ]] && IS_DEFAULT_AGENT_DIR=1
STAGING=0
if [[ "$IS_DEFAULT_APP_DIR" -eq 0 || "$IS_DEFAULT_AGENT_DIR" -eq 0 ]]; then
    STAGING=1
fi

say() { echo "==> $*"; }
run() {
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "    [dry-run] $*"
    else
        echo "    $*"
        eval "$@"
    fi
}

if [[ "$DRY_RUN" -eq 1 ]]; then
    say "dry run — nothing will be removed"
fi

say "stopping any running instance"
run "pkill -f '$TARGET_APP/Contents/MacOS/$APP_NAME' 2>/dev/null || true"
if [[ "$STAGING" -eq 0 ]]; then
    run "pkill -f '$APP_NAME.app/Contents/MacOS/$APP_NAME' 2>/dev/null || true"
fi

if [[ -f "$PLIST" ]]; then
    say "removing LaunchAgent $PLIST"
    if [[ "$STAGING" -eq 0 ]]; then
        run "launchctl unload -w '$PLIST' 2>/dev/null || true"
        run "launchctl bootout 'gui/$(id -u)/$LABEL' 2>/dev/null || true"
    fi
    run "rm -f '$PLIST'"
fi

if [[ -d "$TARGET_APP" ]]; then
    say "removing $TARGET_APP"
    run "rm -rf '$TARGET_APP'"
fi

if [[ "$STAGING" -eq 0 ]]; then
    say "removing app preferences (UserDefaults $BUNDLE_ID)"
    run "defaults delete '$BUNDLE_ID' 2>/dev/null || true"
fi

say "uninstalled"
echo "    kept:      local usage data (~/.token-island)"
echo "    collector: node bin/tokenisland.mjs uninstall   # collector LaunchAgent (CLI-owned)"
