#!/usr/bin/env bash
set -euo pipefail

log() { printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*"; }

die() { log "ERROR: $*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    die "run as root (or with sudo)"
  fi
}

# Load key=value env file without echoing values.
load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || die "missing env file: $env_file (copy from config/setup.env.example)"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

# Prefer newest NVM node if present, else whatever is on PATH.
resolve_node_bin() {
  local node_bin="${NODE_BIN:-}"
  if [[ -n "$node_bin" && -x "$node_bin" ]]; then
    echo "$node_bin"
    return
  fi
  local nvm_candidate
  nvm_candidate="$(
    compgen -G '/root/.nvm/versions/node/v*/bin/node' | sort -V | tail -n 1 || true
  )"
  if [[ -n "$nvm_candidate" && -x "$nvm_candidate" ]]; then
    echo "$nvm_candidate"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  die "node not found (install node>=20, or set NODE_BIN)"
}

resolve_openclaw_bin() {
  if [[ -n "${OPENCLAW_BIN:-}" && -x "${OPENCLAW_BIN:-}" ]]; then
    echo "$OPENCLAW_BIN"
    return
  fi
  if command -v openclaw >/dev/null 2>&1; then
    command -v openclaw
    return
  fi
  local nvm_candidate
  nvm_candidate="$(
    compgen -G '/root/.nvm/versions/node/v*/bin/openclaw' | sort -V | tail -n 1 || true
  )"
  if [[ -n "$nvm_candidate" && -x "$nvm_candidate" ]]; then
    echo "$nvm_candidate"
    return
  fi
  die "openclaw not found (install it or set OPENCLAW_BIN)"
}
