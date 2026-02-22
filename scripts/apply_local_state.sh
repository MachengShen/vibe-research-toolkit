#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

INPUT_DIR="${OPENCLAW_STATE_SYNC_INPUT_DIR:-$ROOT_DIR/machine-state}"
WITH_SECRETS="${OPENCLAW_STATE_SYNC_INCLUDE_SECRETS:-false}"
BACKUP_DIR="${OPENCLAW_STATE_SYNC_BACKUP_DIR:-/root/.openclaw-kit-backups/state-$(date +%Y%m%d-%H%M%S)}"
DRY_RUN="false"

OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/root/.openclaw}"
CODEX_HOME_DIR="${CODEX_HOME:-/root/.codex}"
RELAY_ENV_FILE="${CODEX_RELAY_ENV_FILE:-/root/.codex-discord-relay.env}"

usage() {
  cat <<'USAGE'
Usage: apply_local_state.sh [options]

Apply a previously exported machine-state snapshot.

Options:
  --input-dir DIR          snapshot dir (default: <repo>/machine-state)
  --backup-dir DIR         where existing files are backed up before overwrite
  --with-secrets           expect full secret-bearing snapshot
  --no-secrets             allow redacted snapshot (default)
  --dry-run                print actions without writing
  -h, --help               show help
USAGE
}

bool_normalize() {
  local raw="${1:-}"
  case "$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) echo "true" ;;
    0|false|no|off) echo "false" ;;
    *) die "invalid boolean: $raw" ;;
  esac
}

backup_file() {
  local path="$1"
  [[ -f "$path" ]] || return 0

  local rel
  rel="${path#/}"
  local out="$BACKUP_DIR/$rel"
  log "backup file: $path -> $out"
  [[ "$DRY_RUN" == "true" ]] && return 0

  mkdir -p "$(dirname "$out")"
  cp -a "$path" "$out"
}

install_file() {
  local src="$1"
  local dst="$2"
  local mode="$3"

  if [[ ! -f "$src" ]]; then
    log "skip missing snapshot file: $src"
    return
  fi

  if [[ "$WITH_SECRETS" != "true" ]] && rg -n "REDACTED" "$src" >/dev/null 2>&1; then
    log "warning: redacted values detected in $src"
  fi

  backup_file "$dst"
  log "apply file: $src -> $dst"
  [[ "$DRY_RUN" == "true" ]] && return

  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst"
  chmod "$mode" "$dst" 2>/dev/null || true
}

copy_tree() {
  local src="$1"
  local dst="$2"

  [[ -d "$src" ]] || return 0

  log "apply dir: $src -> $dst"
  [[ "$DRY_RUN" == "true" ]] && return 0

  mkdir -p "$dst"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "$src/" "$dst/"
  else
    cp -a "$src/." "$dst/"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input-dir) INPUT_DIR="${2:-}"; shift 2 ;;
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --with-secrets) WITH_SECRETS="true"; shift 1 ;;
    --no-secrets) WITH_SECRETS="false"; shift 1 ;;
    --dry-run) DRY_RUN="true"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

WITH_SECRETS="$(bool_normalize "$WITH_SECRETS")"
[[ -d "$INPUT_DIR" ]] || die "missing snapshot dir: $INPUT_DIR"

require_root

log "apply local state from $INPUT_DIR (with_secrets=$WITH_SECRETS dry_run=$DRY_RUN)"
log "backup dir: $BACKUP_DIR"

if [[ "$DRY_RUN" != "true" ]]; then
  mkdir -p "$BACKUP_DIR"
fi

install_file "$INPUT_DIR/config/openclaw.json" "$OPENCLAW_STATE_DIR/openclaw.json" 600
install_file "$INPUT_DIR/config/codex.config.toml" "$CODEX_HOME_DIR/config.toml" 600
install_file "$INPUT_DIR/config/codex-discord-relay.env" "$RELAY_ENV_FILE" 600
install_file "$INPUT_DIR/config/openclaw.proxy.env" "$OPENCLAW_STATE_DIR/proxy.env" 600

copy_tree "$INPUT_DIR/skills/openclaw" "$OPENCLAW_STATE_DIR/workspace/skills"
copy_tree "$INPUT_DIR/skills/codex" "$CODEX_HOME_DIR/skills"

log "apply complete"
