#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE="${OPENCLAW_GATEWAY_ENSURE_LOCK:-/tmp/openclaw-gateway-ensure.lock}"
OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/root/.openclaw}"
OPENCLAW_BIN="${OPENCLAW_BIN:-}"
START_LOG="${OPENCLAW_START_LOG:-$OPENCLAW_STATE_DIR/log/gateway-autostart.log}"
RUNTIME_LOG="${OPENCLAW_RUNTIME_LOG:-$OPENCLAW_STATE_DIR/log/manual-gateway.log}"
PROXY_ENV_FILE="${OPENCLAW_PROXY_ENV_FILE:-$OPENCLAW_STATE_DIR/proxy.env}"
DISCORD_GATEWAY_PROXY_DEFAULT="${DISCORD_GATEWAY_PROXY_DEFAULT:-http://127.0.0.1:7897}"
OPENCLAW_NODE_OPTIONS="${OPENCLAW_NODE_OPTIONS:-}"

PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
NVM_BIN="$(ls -d1 /root/.nvm/versions/node/v*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$NVM_BIN" ] && [ -d "$NVM_BIN" ]; then
  PATH="$NVM_BIN:$PATH"
fi
export PATH

mkdir -p "$OPENCLAW_STATE_DIR/log"

if [ -z "$OPENCLAW_BIN" ]; then
  OPENCLAW_BIN="$(command -v openclaw 2>/dev/null || true)"
fi
if [ -z "$OPENCLAW_BIN" ]; then
  OPENCLAW_BIN="$(ls -1 /root/.nvm/versions/node/v*/bin/openclaw 2>/dev/null | sort -V | tail -n 1 || true)"
fi
if [ -z "$OPENCLAW_BIN" ] || [ ! -x "$OPENCLAW_BIN" ]; then
  echo "openclaw-gateway-ensure: openclaw not found (set OPENCLAW_BIN or install openclaw)" >>"$START_LOG"
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

timestamp() {
  date -Is
}

# Load persistent proxy settings when present.
if [ -f "$PROXY_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$PROXY_ENV_FILE"
  set +a
fi

PROXY_URL="${OPENCLAW_PROXY_URL:-${HTTPS_PROXY:-${HTTP_PROXY:-$DISCORD_GATEWAY_PROXY_DEFAULT}}}"
if [ -n "$PROXY_URL" ]; then
  export HTTP_PROXY="${HTTP_PROXY:-$PROXY_URL}"
  export HTTPS_PROXY="${HTTPS_PROXY:-$PROXY_URL}"
  export ALL_PROXY="${ALL_PROXY:-$PROXY_URL}"
fi
export NO_PROXY="${NO_PROXY:-127.0.0.1,localhost,::1}"

if pgrep -f '^openclaw-gateway' >/dev/null 2>&1; then
  exit 0
fi

if "$OPENCLAW_BIN" gateway health >/dev/null 2>&1; then
  exit 0
fi

DISCORD_GATEWAY_PROXY="${DISCORD_GATEWAY_PROXY:-${HTTP_PROXY:-$DISCORD_GATEWAY_PROXY_DEFAULT}}"

NODE_OPTIONS_ARGS=()
if [ -n "$OPENCLAW_NODE_OPTIONS" ]; then
  NODE_OPTIONS_ARGS=(NODE_OPTIONS="$OPENCLAW_NODE_OPTIONS")
fi

echo "[$(timestamp)] gateway down; starting with persistent proxy env (http: ${HTTP_PROXY:-none}, discord: $DISCORD_GATEWAY_PROXY)" >>"$START_LOG"
setsid -f env \
  HTTP_PROXY="${HTTP_PROXY:-}" \
  HTTPS_PROXY="${HTTPS_PROXY:-}" \
  ALL_PROXY="${ALL_PROXY:-}" \
  NO_PROXY="${NO_PROXY:-}" \
  DISCORD_GATEWAY_PROXY="$DISCORD_GATEWAY_PROXY" \
  "${NODE_OPTIONS_ARGS[@]}" \
  "$OPENCLAW_BIN" gateway run --force --verbose >>"$RUNTIME_LOG" 2>&1

sleep 3
if "$OPENCLAW_BIN" gateway health >/dev/null 2>&1; then
  echo "[$(timestamp)] gateway start verified" >>"$START_LOG"
else
  echo "[$(timestamp)] gateway start attempted but health still failing" >>"$START_LOG"
fi
