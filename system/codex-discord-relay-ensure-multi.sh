#!/usr/bin/env bash
set -euo pipefail

# Ensure multiple Codex Discord Relay instances are running.
#
# Instances are defined by env files:
# - default: /root/.codex-discord-relay.env (state: /root/.codex-discord-relay)
# - extra:   /root/.codex-discord-relay/instances.d/<name>.env (state: /root/.codex-discord-relay/instances/<name>)
#
# Usage:
#   codex-discord-relay-ensure-multi.sh           # ensure all instances
#   codex-discord-relay-ensure-multi.sh alpha     # ensure only instance "alpha"
#   codex-discord-relay-ensure-multi.sh default   # ensure only default instance

APP_DIR="${CODEX_RELAY_APP_DIR:-/root/codex-discord-relay}"
DEFAULT_ENV_FILE="${CODEX_RELAY_ENV_FILE:-/root/.codex-discord-relay.env}"
PROXY_ENV_FILE="${CODEX_RELAY_PROXY_ENV_FILE:-/root/.openclaw/proxy.env}"

DEFAULT_STATE_DIR="${CODEX_RELAY_STATE_DIR:-/root/.codex-discord-relay}"
INSTANCES_ENV_DIR="${CODEX_RELAY_INSTANCES_ENV_DIR:-$DEFAULT_STATE_DIR/instances.d}"
INSTANCES_STATE_ROOT="${CODEX_RELAY_INSTANCES_STATE_ROOT:-$DEFAULT_STATE_DIR/instances}"

LOCK_FILE="${CODEX_RELAY_MULTI_LOCK_FILE:-/tmp/codex-discord-relay-multi.lock}"

mkdir -p "$(dirname "$LOCK_FILE")" 2>/dev/null || true
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

timestamp() {
  date --iso-8601=seconds
}

pick_node_bin() {
  local node_bin="${NODE_BIN:-}"
  if [[ -n "$node_bin" && -x "$node_bin" ]]; then
    printf '%s' "$node_bin"
    return 0
  fi
  node_bin="$(
    compgen -G '/root/.nvm/versions/node/v*/bin/node' | sort -V | tail -n 1 || true
  )"
  if [[ -n "$node_bin" && -x "$node_bin" ]]; then
    printf '%s' "$node_bin"
    return 0
  fi
  return 1
}

NODE_BIN="$(pick_node_bin || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "codex-discord-relay-ensure-multi: node binary not found (set NODE_BIN or install node via nvm)" >&2
  exit 1
fi
node_dir="$(dirname "$NODE_BIN")"
export PATH="$node_dir:$PATH"

# Load shared proxy env (GFW).
if [[ -f "$PROXY_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROXY_ENV_FILE"
  set +a
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "codex-discord-relay-ensure-multi: missing app dir: $APP_DIR" >&2
  exit 1
fi

# Install deps once if needed.
if [[ ! -d "$APP_DIR/node_modules" ]]; then
  mkdir -p "$DEFAULT_STATE_DIR"
  touch "$DEFAULT_STATE_DIR/relay.log"
  printf '[%s] ensure-multi: node_modules missing, running npm install\n' "$(timestamp)" >>"$DEFAULT_STATE_DIR/relay.log"
  (
    cd "$APP_DIR"
    npm install --omit=dev
  ) >>"$DEFAULT_STATE_DIR/relay.log" 2>&1 || true
fi

want_only=()
if [[ $# -gt 0 ]]; then
  want_only=("$@")
fi

want_instance() {
  local name="$1"
  if [[ ${#want_only[@]} -eq 0 ]]; then
    return 0
  fi
  local w
  for w in "${want_only[@]}"; do
    if [[ "$w" == "$name" ]]; then
      return 0
    fi
  done
  return 1
}

ensure_instance() {
  local name="$1"
  local env_file="$2"
  local state_dir="$3"

  (
    set -euo pipefail
    umask 077

    mkdir -p "$state_dir"
    chmod 700 "$state_dir" 2>/dev/null || true

    local pid_file="$state_dir/relay.pid"
    local log_file="$state_dir/relay.log"
    touch "$log_file"
    chmod 600 "$log_file" 2>/dev/null || true

    log() {
      printf '[%s] [%s] %s\n' "$(timestamp)" "$name" "$*" >>"$log_file"
    }

    if [[ ! -f "$env_file" ]]; then
      log "missing env file: $env_file (skipping)"
      exit 0
    fi

    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a

    if [[ -z "${DISCORD_BOT_TOKEN:-}" ]]; then
      log "DISCORD_BOT_TOKEN is empty (skipping)"
      exit 0
    fi

    # Force per-instance state isolation so multiple bots don't share sessions.json.
    export RELAY_STATE_DIR="$state_dir"
    export RELAY_STATE_FILE="$state_dir/sessions.json"

    if [[ -f "$pid_file" ]]; then
      local pid
      pid="$(cat "$pid_file" 2>/dev/null || true)"
      if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
        exit 0
      fi
      rm -f "$pid_file" 2>/dev/null || true
    fi

    log "starting relay"
    (
      cd "$APP_DIR"
      # Close lock fd 9 for the child so the watchdog lock is released when this script exits.
      nohup "$NODE_BIN" "$APP_DIR/relay.js" --instance "$name" >>"$log_file" 2>&1 < /dev/null 9>&- &
      echo $! >"$pid_file"
    )

    sleep 1
    local new_pid
    new_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$new_pid" =~ ^[0-9]+$ ]] && kill -0 "$new_pid" 2>/dev/null; then
      log "relay running pid=$new_pid"
      exit 0
    fi

    log "failed to start relay"
    exit 1
  )
}

fail=0

# Default instance (backwards compatible).
if want_instance "default"; then
  if [[ -f "$DEFAULT_ENV_FILE" ]]; then
    if ! ensure_instance "default" "$DEFAULT_ENV_FILE" "$DEFAULT_STATE_DIR"; then
      fail=1
    fi
  fi
fi

# Extra instances.
if [[ -d "$INSTANCES_ENV_DIR" ]]; then
  shopt -s nullglob
  for env_file in "$INSTANCES_ENV_DIR"/*.env; do
    name="$(basename "$env_file")"
    name="${name%.env}"
    if ! want_instance "$name"; then
      continue
    fi
    state_dir="$INSTANCES_STATE_ROOT/$name"
    if ! ensure_instance "$name" "$env_file" "$state_dir"; then
      fail=1
    fi
  done
  shopt -u nullglob
fi

exit "$fail"
