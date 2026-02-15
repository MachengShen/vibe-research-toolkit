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
rsync -a --delete "$ROOT_DIR/codex-discord-relay/" "$APP_DIR/"

if [[ ! -f "$ENV_FILE" ]]; then
  log "creating env file template at $ENV_FILE"
  cat > "$ENV_FILE" <<EOF2
DISCORD_BOT_TOKEN=${CODEX_DISCORD_BOT_TOKEN:-}
CODEX_BIN=${CODEX_BIN:-codex}
CODEX_WORKDIR=${CODEX_WORKDIR:-/root}
CODEX_ALLOWED_WORKDIR_ROOTS=${CODEX_ALLOWED_WORKDIR_ROOTS:-/root}
CODEX_MODEL=${CODEX_MODEL:-}
CODEX_SANDBOX=${CODEX_SANDBOX:-workspace-write}
CODEX_APPROVAL_POLICY=${CODEX_APPROVAL_POLICY:-never}
CODEX_ENABLE_SEARCH=${CODEX_ENABLE_SEARCH:-true}
CODEX_SKIP_GIT_REPO_CHECK=${CODEX_SKIP_GIT_REPO_CHECK:-true}
CODEX_CONFIG_OVERRIDES=
RELAY_STATE_DIR=$STATE_DIR
RELAY_STATE_FILE=$STATE_DIR/sessions.json
RELAY_MAX_REPLY_CHARS=1800
DISCORD_ALLOWED_GUILDS=${CODEX_ALLOWED_GUILDS:-}
DISCORD_ALLOWED_CHANNELS=${CODEX_ALLOWED_CHANNELS:-}
EOF2
  chmod 600 "$ENV_FILE"
fi

install -m 755 "$ROOT_DIR/system/codex-discord-relay-ensure.sh" /usr/local/bin/codex-discord-relay-ensure.sh
install -m 755 "$ROOT_DIR/system/codex-discord-relayctl" /usr/local/bin/codex-discord-relayctl

log "installed /usr/local/bin/codex-discord-relay-ensure.sh and codex-discord-relayctl"
