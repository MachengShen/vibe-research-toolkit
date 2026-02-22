#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${CODEX_RELAY_APP_DIR:-/root/codex-discord-relay}"
ENV_FILE="${CODEX_RELAY_ENV_FILE:-/root/.codex-discord-relay.env}"
PROXY_ENV_FILE="${OPENCLAW_PROXY_ENV_FILE:-/root/.openclaw/proxy.env}"
STATE_DIR="${CODEX_RELAY_STATE_DIR:-/root/.codex-discord-relay}"
PID_FILE="$STATE_DIR/relay.pid"
LOG_FILE="$STATE_DIR/relay.log"

mkdir -p "$STATE_DIR"
touch "$LOG_FILE"

log() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*" >> "$LOG_FILE"
}

# Cron often runs with a minimal PATH and an old system Node.
# Prefer a modern Node (>=20). Cron may default to an old system Node.
NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]]; then
  major="$("$NODE_BIN" -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\\1/' || true)"
else
  major=""
fi
if [[ -z "$major" || "$major" -lt 20 ]]; then
  nvm_node="$(
    compgen -G '/root/.nvm/versions/node/v*/bin/node' | sort -V | tail -n 1 || true
  )"
  if [[ -n "$nvm_node" && -x "$nvm_node" ]]; then
    NODE_BIN="$nvm_node"
  fi
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  log "ensure: node binary not found (set NODE_BIN or install node>=20)"
  exit 1
fi
node_dir="$(dirname "$NODE_BIN")"
export PATH="$node_dir:$PATH"

if [[ ! -f "$ENV_FILE" ]]; then
  log "ensure: missing env file: $ENV_FILE"
  exit 1
fi

# Load shared proxy config if present (useful behind the Great Firewall).
if [[ -f "$PROXY_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROXY_ENV_FILE"
  set +a
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${DISCORD_BOT_TOKEN:-}" ]]; then
  log "ensure: DISCORD_BOT_TOKEN is empty"
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    exit 0
  fi
fi

existing_pid="$(ps -eo pid=,args= | awk -v p="$APP_DIR/relay.js" 'index($0,p)>0 {print $1; exit}')"
if [[ -n "$existing_pid" ]]; then
  echo "$existing_pid" > "$PID_FILE"
  exit 0
fi

if [[ ! -d "$APP_DIR/node_modules" ]]; then
  log "ensure: node_modules missing, running npm install"
  (
    cd "$APP_DIR"
    npm install --omit=dev
  ) >> "$LOG_FILE" 2>&1
fi

log "ensure: starting relay"
(
  cd "$APP_DIR"
  nohup "$NODE_BIN" "$APP_DIR/relay.js" >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
)

sleep 1
new_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ "$new_pid" =~ ^[0-9]+$ ]] && kill -0 "$new_pid" 2>/dev/null; then
  log "ensure: relay running pid=$new_pid"
  exit 0
fi

log "ensure: failed to start relay"
exit 1
