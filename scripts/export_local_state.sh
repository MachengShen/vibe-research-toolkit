#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

OUTPUT_DIR="${OPENCLAW_STATE_SYNC_OUTPUT_DIR:-$ROOT_DIR/machine-state}"
WITH_SECRETS="${OPENCLAW_STATE_SYNC_INCLUDE_SECRETS:-false}"
OPENCLAW_SKILLS="${OPENCLAW_STATE_SYNC_OPENCLAW_SKILLS:-tavily-search,delegate-coding-tasks}"
CODEX_SKILLS="${OPENCLAW_STATE_SYNC_CODEX_SKILLS:-}"
DRY_RUN="false"

OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/root/.openclaw}"
CODEX_HOME_DIR="${CODEX_HOME:-/root/.codex}"
RELAY_ENV_FILE="${CODEX_RELAY_ENV_FILE:-/root/.codex-discord-relay.env}"

usage() {
  cat <<'USAGE'
Usage: export_local_state.sh [options]

Snapshot local machine settings into this repo.

Options:
  --output-dir DIR         output snapshot dir (default: <repo>/machine-state)
  --with-secrets           keep secret values in exported files
  --no-secrets             redact secret-looking values (default)
  --openclaw-skills CSV    copy skills from /root/.openclaw/workspace/skills
  --codex-skills CSV       copy skills from /root/.codex/skills
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

trim() {
  local s="$1"
  printf '%s' "$s" | xargs
}

redact_copy() {
  local src="$1"
  local dst="$2"
  sed -E \
    -e 's/^([A-Za-z_][A-Za-z0-9_]*(TOKEN|API_KEY|SECRET|PASSWORD|KEY)[A-Za-z0-9_]*=).*/\1REDACTED/Ig' \
    -e 's/("([^"[:cntrl:]]*(token|api[_-]?key|secret|password)[^"[:cntrl:]]*)"[[:space:]]*:[[:space:]]*")[^"]*"/\1REDACTED"/Ig' \
    -e 's/((token|api[_-]?key|secret|password)[[:space:]]*[:=][[:space:]]*)[^,[:space:]]+/\1REDACTED/Ig' \
    "$src" > "$dst"
}

copy_file() {
  local src="$1"
  local dst="$2"

  if [[ ! -f "$src" ]]; then
    log "skip missing file: $src"
    return
  fi

  log "export file: $src -> $dst"
  [[ "$DRY_RUN" == "true" ]] && return

  mkdir -p "$(dirname "$dst")"
  if [[ "$WITH_SECRETS" == "true" ]]; then
    cp -a "$src" "$dst"
  else
    redact_copy "$src" "$dst"
  fi
}

copy_dir() {
  local src="$1"
  local dst="$2"

  if [[ ! -d "$src" ]]; then
    log "skip missing dir: $src"
    return
  fi

  log "export dir: $src -> $dst"
  [[ "$DRY_RUN" == "true" ]] && return

  mkdir -p "$dst"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$src/" "$dst/"
  else
    rm -rf "$dst"
    cp -a "$src" "$dst"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --with-secrets) WITH_SECRETS="true"; shift 1 ;;
    --no-secrets) WITH_SECRETS="false"; shift 1 ;;
    --openclaw-skills) OPENCLAW_SKILLS="${2:-}"; shift 2 ;;
    --codex-skills) CODEX_SKILLS="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN="true"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

WITH_SECRETS="$(bool_normalize "$WITH_SECRETS")"

log "export local state to $OUTPUT_DIR (with_secrets=$WITH_SECRETS dry_run=$DRY_RUN)"

if [[ "$DRY_RUN" != "true" ]]; then
  rm -rf "$OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR/config" "$OUTPUT_DIR/skills/openclaw" "$OUTPUT_DIR/skills/codex" "$OUTPUT_DIR/meta"
fi

copy_file "$OPENCLAW_STATE_DIR/openclaw.json" "$OUTPUT_DIR/config/openclaw.json"
copy_file "$CODEX_HOME_DIR/config.toml" "$OUTPUT_DIR/config/codex.config.toml"
copy_file "$RELAY_ENV_FILE" "$OUTPUT_DIR/config/codex-discord-relay.env"
copy_file "$OPENCLAW_STATE_DIR/proxy.env" "$OUTPUT_DIR/config/openclaw.proxy.env"

if [[ -n "$(trim "$OPENCLAW_SKILLS")" ]]; then
  IFS=',' read -r -a skills <<<"$OPENCLAW_SKILLS"
  for raw in "${skills[@]}"; do
    name="$(trim "$raw")"
    [[ -n "$name" ]] || continue
    copy_dir "$OPENCLAW_STATE_DIR/workspace/skills/$name" "$OUTPUT_DIR/skills/openclaw/$name"
  done
fi

if [[ -n "$(trim "$CODEX_SKILLS")" ]]; then
  IFS=',' read -r -a skills <<<"$CODEX_SKILLS"
  for raw in "${skills[@]}"; do
    name="$(trim "$raw")"
    [[ -n "$name" ]] || continue
    copy_dir "$CODEX_HOME_DIR/skills/$name" "$OUTPUT_DIR/skills/codex/$name"
  done
fi

if [[ "$DRY_RUN" != "true" ]]; then
  cat > "$OUTPUT_DIR/meta/export-manifest.env" <<META
EXPORT_TIMESTAMP=$(date --iso-8601=seconds)
EXPORT_HOSTNAME=$(hostname)
EXPORT_USER=$(id -un)
WITH_SECRETS=$WITH_SECRETS
SOURCE_OPENCLAW_STATE_DIR=$OPENCLAW_STATE_DIR
SOURCE_CODEX_HOME_DIR=$CODEX_HOME_DIR
SOURCE_RELAY_ENV_FILE=$RELAY_ENV_FILE
OPENCLAW_SKILLS=$OPENCLAW_SKILLS
CODEX_SKILLS=$CODEX_SKILLS
META
fi

log "export complete: $OUTPUT_DIR"
