#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

usage() {
  cat <<'USAGE'
Usage: bootstrap.sh [options]

Options:
  --with-secrets           allow state snapshot scripts to include secrets
  --no-secrets             redact secrets in snapshot scripts (default)
  --apply-snapshot         apply machine-state snapshot before service start
  --export-snapshot        export machine-state snapshot at end of bootstrap
  --sync-local-skills      sync local skills into packaged-skills before install
  --no-global-context      skip installing global context templates
  --global-context-overwrite
                           overwrite existing global context files
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

install_global_context_templates() {
  local source_dir="$ROOT_DIR/templates/global-context"
  local target_home="$GLOBAL_CONTEXT_TARGET_HOME"
  local overwrite="$GLOBAL_CONTEXT_OVERWRITE"

  if [[ ! -d "$source_dir" ]]; then
    log "global context templates not found at $source_dir; skipping"
    return 0
  fi

  if [[ "$target_home" != /* ]]; then
    die "OPENCLAW_GLOBAL_CONTEXT_TARGET_HOME must be an absolute path: $target_home"
  fi

  mkdir -p "$target_home/.claude"
  local relay_state_dir="${RELAY_STATE_DIR:-$target_home/.codex-discord-relay}"
  mkdir -p "$relay_state_dir"

  # source-path|destination-path
  local mappings=(
    "$source_dir/AGENTS.md|$target_home/AGENTS.md"
    "$source_dir/CLAUDE.md|$target_home/.claude/CLAUDE.md"
    "$source_dir/AGENT_SYSTEM_OVERVIEW.md|$target_home/AGENT_SYSTEM_OVERVIEW.md"
    "$source_dir/relay-context.md|$relay_state_dir/global-context.md"
  )

  local pair src dst
  for pair in "${mappings[@]}"; do
    src="${pair%%|*}"
    dst="${pair##*|}"
    if [[ ! -f "$src" ]]; then
      log "global context template missing: $src; skipping"
      continue
    fi
    if [[ -e "$dst" && "$overwrite" != "true" ]]; then
      log "global context exists, keeping current file: $dst"
      continue
    fi
    cp -f "$src" "$dst"
    log "global context installed: $dst"
  done
}

ENV_FILE="$ROOT_DIR/config/setup.env"
if [[ -f "$ENV_FILE" ]]; then
  log "loading env from $ENV_FILE"
  load_env_file "$ENV_FILE"
else
  log "no $ENV_FILE found; relying on exported env vars"
fi

STATE_SYNC_INCLUDE_SECRETS="${OPENCLAW_STATE_SYNC_INCLUDE_SECRETS:-false}"
APPLY_SNAPSHOT_ON_BOOTSTRAP="${OPENCLAW_APPLY_SNAPSHOT_ON_BOOTSTRAP:-false}"
EXPORT_SNAPSHOT_ON_BOOTSTRAP="${OPENCLAW_EXPORT_SNAPSHOT_ON_BOOTSTRAP:-false}"
SYNC_LOCAL_SKILLS_ON_BOOTSTRAP="${OPENCLAW_SYNC_LOCAL_SKILLS_ON_BOOTSTRAP:-false}"
INSTALL_GLOBAL_CONTEXT="${OPENCLAW_INSTALL_GLOBAL_CONTEXT:-true}"
GLOBAL_CONTEXT_OVERWRITE="${OPENCLAW_GLOBAL_CONTEXT_OVERWRITE:-false}"
GLOBAL_CONTEXT_TARGET_HOME="${OPENCLAW_GLOBAL_CONTEXT_TARGET_HOME:-/root}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-secrets) STATE_SYNC_INCLUDE_SECRETS="true"; shift 1 ;;
    --no-secrets) STATE_SYNC_INCLUDE_SECRETS="false"; shift 1 ;;
    --apply-snapshot) APPLY_SNAPSHOT_ON_BOOTSTRAP="true"; shift 1 ;;
    --export-snapshot) EXPORT_SNAPSHOT_ON_BOOTSTRAP="true"; shift 1 ;;
    --sync-local-skills) SYNC_LOCAL_SKILLS_ON_BOOTSTRAP="true"; shift 1 ;;
    --no-global-context) INSTALL_GLOBAL_CONTEXT="false"; shift 1 ;;
    --global-context-overwrite) GLOBAL_CONTEXT_OVERWRITE="true"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

STATE_SYNC_INCLUDE_SECRETS="$(bool_normalize "$STATE_SYNC_INCLUDE_SECRETS")"
APPLY_SNAPSHOT_ON_BOOTSTRAP="$(bool_normalize "$APPLY_SNAPSHOT_ON_BOOTSTRAP")"
EXPORT_SNAPSHOT_ON_BOOTSTRAP="$(bool_normalize "$EXPORT_SNAPSHOT_ON_BOOTSTRAP")"
SYNC_LOCAL_SKILLS_ON_BOOTSTRAP="$(bool_normalize "$SYNC_LOCAL_SKILLS_ON_BOOTSTRAP")"
INSTALL_GLOBAL_CONTEXT="$(bool_normalize "$INSTALL_GLOBAL_CONTEXT")"
GLOBAL_CONTEXT_OVERWRITE="$(bool_normalize "$GLOBAL_CONTEXT_OVERWRITE")"

require_root

state_secret_flag="--no-secrets"
if [[ "$STATE_SYNC_INCLUDE_SECRETS" == "true" ]]; then
  state_secret_flag="--with-secrets"
fi

if [[ "$SYNC_LOCAL_SKILLS_ON_BOOTSTRAP" == "true" ]]; then
  "$ROOT_DIR/scripts/sync_local_skills_to_packaged.sh" || true
fi

# Proxy env for GFW
"$ROOT_DIR/scripts/setup_proxy_env.sh"

# OpenClaw (optional but recommended)
if command -v npm >/dev/null 2>&1; then
  "$ROOT_DIR/scripts/install_openclaw.sh" || true
fi
"$ROOT_DIR/scripts/install_openclaw_gateway_watchdog.sh"
"$ROOT_DIR/scripts/configure_openclaw_discord.sh" || true

# Codex relay (required for vibe coding via Discord)
"$ROOT_DIR/scripts/install_codex_discord_relay.sh"

# Optional: install packaged local skills into CODEX_HOME/skills.
if [[ "${OPENCLAW_INSTALL_PACKAGED_SKILLS:-true}" =~ ^(1|true|yes|on)$ ]]; then
  "$ROOT_DIR/scripts/install_packaged_skills.sh" || true
fi

if [[ "$INSTALL_GLOBAL_CONTEXT" == "true" ]]; then
  install_global_context_templates
fi

# Periodic self-update service for this toolkit
"$ROOT_DIR/scripts/install_openclaw_kit_autoupdate.sh"
"$ROOT_DIR/scripts/install_local_state_sync_cron.sh"

if [[ "$APPLY_SNAPSHOT_ON_BOOTSTRAP" == "true" ]]; then
  "$ROOT_DIR/scripts/apply_local_state.sh" "$state_secret_flag" || true
fi

# Cron + start
"$ROOT_DIR/scripts/install_cron.sh"
/usr/local/bin/openclaw-gateway-ensure.sh || true
if [[ -x /usr/local/bin/codex-discord-relay-ensure-multi.sh ]]; then
  /usr/local/bin/codex-discord-relay-ensure-multi.sh || true
else
  /usr/local/bin/codex-discord-relay-ensure.sh || true
fi

"$ROOT_DIR/scripts/healthcheck.sh" || true
"$ROOT_DIR/scripts/verify_install.sh" || true

if [[ "$EXPORT_SNAPSHOT_ON_BOOTSTRAP" == "true" ]]; then
  "$ROOT_DIR/scripts/export_local_state.sh" "$state_secret_flag" || true
fi

log "bootstrap complete"
