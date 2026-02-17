#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

require_root

APP_DIR="${CODEX_RELAY_APP_DIR:-/root/codex-discord-relay}"
STATE_DIR="${CODEX_RELAY_STATE_DIR:-/root/.codex-discord-relay}"
ENV_FILE="${CODEX_RELAY_ENV_FILE:-/root/.codex-discord-relay.env}"

mkdir -p "$APP_DIR" "$STATE_DIR"

log "installing relay app into $APP_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$ROOT_DIR/codex-discord-relay/" "$APP_DIR/"
else
  log "rsync not found; using cp fallback (preserves $APP_DIR/node_modules)"
  find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  cp -a "$ROOT_DIR/codex-discord-relay/." "$APP_DIR/"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  log "creating env file template at $ENV_FILE"
  cat > "$ENV_FILE" <<EOF2
DISCORD_BOT_TOKEN=${CODEX_DISCORD_BOT_TOKEN:-}
RELAY_AGENT_PROVIDER=${RELAY_AGENT_PROVIDER:-codex}
CODEX_BIN=${CODEX_BIN:-codex}
CLAUDE_BIN=${CLAUDE_BIN:-claude}
CODEX_WORKDIR=${CODEX_WORKDIR:-/root}
CODEX_ALLOWED_WORKDIR_ROOTS=${CODEX_ALLOWED_WORKDIR_ROOTS:-/root}
CODEX_MODEL=${CODEX_MODEL:-}
CLAUDE_MODEL=${CLAUDE_MODEL:-}
CLAUDE_PERMISSION_MODE=${CLAUDE_PERMISSION_MODE:-}
RELAY_AGENT_TIMEOUT_MS=${RELAY_AGENT_TIMEOUT_MS:-600000}
CODEX_SANDBOX=${CODEX_SANDBOX:-workspace-write}
CODEX_APPROVAL_POLICY=${CODEX_APPROVAL_POLICY:-never}
CODEX_APPROVAL=${CODEX_APPROVAL:-${CODEX_APPROVAL_POLICY:-never}}
CODEX_ENABLE_SEARCH=${CODEX_ENABLE_SEARCH:-true}
CODEX_SKIP_GIT_REPO_CHECK=${CODEX_SKIP_GIT_REPO_CHECK:-true}
CODEX_CONFIG_OVERRIDES=
RELAY_STATE_DIR=$STATE_DIR
RELAY_STATE_FILE=$STATE_DIR/sessions.json
RELAY_MAX_REPLY_CHARS=1800
DISCORD_ALLOWED_GUILDS=${CODEX_ALLOWED_GUILDS:-}
DISCORD_ALLOWED_CHANNELS=${CODEX_ALLOWED_CHANNELS:-}
RELAY_THREAD_AUTO_RESPOND=${RELAY_THREAD_AUTO_RESPOND:-true}
RELAY_PROGRESS=${RELAY_PROGRESS:-true}
RELAY_PROGRESS_MIN_EDIT_MS=${RELAY_PROGRESS_MIN_EDIT_MS:-5000}
RELAY_PROGRESS_HEARTBEAT_MS=${RELAY_PROGRESS_HEARTBEAT_MS:-20000}
RELAY_PROGRESS_MAX_LINES=${RELAY_PROGRESS_MAX_LINES:-6}
RELAY_PROGRESS_SHOW_COMMANDS=${RELAY_PROGRESS_SHOW_COMMANDS:-false}
RELAY_UPLOAD_ENABLED=${RELAY_UPLOAD_ENABLED:-true}
RELAY_UPLOAD_ALLOW_OUTSIDE_CONVERSATION=${RELAY_UPLOAD_ALLOW_OUTSIDE_CONVERSATION:-true}
RELAY_UPLOAD_ALLOWED_ROOTS=${RELAY_UPLOAD_ALLOWED_ROOTS:-/root,/tmp}
RELAY_UPLOAD_MAX_FILES=${RELAY_UPLOAD_MAX_FILES:-3}
RELAY_UPLOAD_MAX_BYTES=${RELAY_UPLOAD_MAX_BYTES:-8388608}
EOF2
  chmod 600 "$ENV_FILE"
fi

install -m 755 "$ROOT_DIR/system/codex-discord-relay-ensure.sh" /usr/local/bin/codex-discord-relay-ensure.sh
install -m 755 "$ROOT_DIR/system/codex-discord-relayctl" /usr/local/bin/codex-discord-relayctl
install -m 755 "$ROOT_DIR/system/codex-discord-relay-ensure-multi.sh" /usr/local/bin/codex-discord-relay-ensure-multi.sh
install -m 755 "$ROOT_DIR/system/codex-discord-relay-multictl" /usr/local/bin/codex-discord-relay-multictl

log "installed relay scripts: codex-discord-relay-ensure.sh, codex-discord-relayctl, codex-discord-relay-ensure-multi.sh, codex-discord-relay-multictl"
