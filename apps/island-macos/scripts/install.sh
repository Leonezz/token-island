#!/usr/bin/env bash
#
# Install Token Island for the current user and start it at login. No sudo.
#
#   bash apps/island-macos/scripts/install.sh [options]
#
# Options:
#   --destination <dir>     where to install TokenIsland.app
#                           (default: ~/Applications; env TOKEN_ISLAND_APP_DIR)
#   --launch-agents <dir>   where to write the widget LaunchAgent
#                           (default: ~/Library/LaunchAgents;
#                            env TOKEN_ISLAND_LAUNCH_AGENTS_DIR)
#   --dry-run               print every action, write nothing
#   --no-build              never invoke scripts/build-app.sh
#   -h, --help              show this help
#
# Actions:
#   1. builds the app bundle if needed (scripts/build-app.sh)
#   2. copies it to <destination>/TokenIsland.app
#   3. writes <launch-agents>/com.token-island.app.plist
#      (RunAtLoad true, KeepAlive false, LimitLoadToSessionType Aqua)
#   4. stops a running instance, then launchctl load -w
#
# Collector autostart is owned by the repo CLI so the launchd logic lives in one
# place — this script deliberately does not duplicate it:
#
#   node bin/tokenisland.mjs install          # widget + collector LaunchAgent
#   node bin/tokenisland.mjs install --dry-run
#
# The collector agent is com.token-island.collector; `tokenisland uninstall`
# removes it. Data in ~/.token-island is never deleted by any script.
#
# Staging: when --destination / --launch-agents point somewhere other than the
# real user locations (e.g. <repo>/.runtime/install-staging), launchctl is
# skipped and the plist is written for inspection only. This is how the
# packaging can be verified without writing to ~/Applications or ~/Library.

set -euo pipefail

APP_NAME="TokenIsland"
BUNDLE_ID="com.token-island.app"
LABEL="$BUNDLE_ID"

ISLAND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ISLAND_DIR/../.." && pwd)"
SOURCE_APP="$ISLAND_DIR/build/$APP_NAME.app"

DESTINATION="${TOKEN_ISLAND_APP_DIR:-$HOME/Applications}"
LAUNCH_AGENTS="${TOKEN_ISLAND_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
DRY_RUN=0
NO_BUILD=0

usage() { sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --destination) DESTINATION="${2:?--destination needs a path}"; shift 2 ;;
        --destination=*) DESTINATION="${1#*=}"; shift ;;
        --launch-agents) LAUNCH_AGENTS="${2:?--launch-agents needs a path}"; shift 2 ;;
        --launch-agents=*) LAUNCH_AGENTS="${1#*=}"; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        --no-build) NO_BUILD=1; shift ;;
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
    say "dry run — nothing will be written, loaded or stopped"
fi

if [[ ! -d "$SOURCE_APP" ]]; then
    if [[ "$NO_BUILD" -eq 1 ]]; then
        echo "error: app bundle missing: $SOURCE_APP (run without --no-build)" >&2
        exit 1
    fi
    say "app bundle missing, building first"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "    [dry-run] bash $ISLAND_DIR/scripts/build-app.sh"
    else
        bash "$ISLAND_DIR/scripts/build-app.sh"
    fi
fi

say "installing $APP_NAME.app -> $TARGET_APP"
if [[ -d "$TARGET_APP" ]]; then
    run "pkill -f '$TARGET_APP/Contents/MacOS/$APP_NAME' 2>/dev/null || true"
    run "rm -rf '$TARGET_APP'"
fi
run "mkdir -p '$DESTINATION'"
run "cp -R '$SOURCE_APP' '$TARGET_APP'"
run "xattr -dr com.apple.quarantine '$TARGET_APP' 2>/dev/null || true"

# Log path: real installs log under ~/Library/Logs, staged installs next to the agent.
LOG_PATH="$HOME/Library/Logs/TokenIsland.log"
if [[ "$IS_DEFAULT_AGENT_DIR" -eq 0 ]]; then
    LOG_PATH="$LAUNCH_AGENTS/TokenIsland.log"
fi

say "writing LaunchAgent $PLIST"
run "mkdir -p '$LAUNCH_AGENTS'"
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "    [dry-run] cat > $PLIST <<PLIST (RunAtLoad, Aqua, ProgramArguments=$TARGET_APP/Contents/MacOS/$APP_NAME)"
else
    mkdir -p "$LAUNCH_AGENTS"
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
    <string>$LOG_PATH</string>
    <key>StandardErrorPath</key>
    <string>$LOG_PATH</string>
</dict>
</plist>
PLIST_EOF
    plutil -lint "$PLIST" >/dev/null
    echo "    plist OK: $PLIST"
fi

if [[ "$STAGING" -eq 1 ]]; then
    say "staging target detected — launchctl skipped (plist written for inspection)"
elif [[ "$DRY_RUN" -eq 1 ]]; then
    echo "    [dry-run] launchctl unload -w '$PLIST' 2>/dev/null || true; launchctl load -w '$PLIST'"
else
    say "loading LaunchAgent"
    launchctl unload -w "$PLIST" 2>/dev/null || true
    launchctl load -w "$PLIST"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
    say "dry run complete — nothing was installed"
else
    say "installed"
fi
echo "    app:       $TARGET_APP"
echo "    agent:     $PLIST"
echo "    log:       $LOG_PATH"
echo "    collector: node $REPO_ROOT/bin/tokenisland.mjs install   # collector autostart (CLI-owned)"
echo "    uninstall: bash $ISLAND_DIR/scripts/uninstall.sh"
