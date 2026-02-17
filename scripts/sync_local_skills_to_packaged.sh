#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

SKILLS_CSV="${OPENCLAW_LOCAL_SKILLS_TO_PACKAGE:-tavily-search,delegate-coding-tasks}"
SRC_OPENCLAW="${OPENCLAW_LOCAL_SKILLS_SOURCE:-/root/.openclaw/workspace/skills}"
SRC_CODEX="${OPENCLAW_CODEX_SKILLS_SOURCE:-/root/.codex/skills}"
DST_ROOT="${OPENCLAW_PACKAGED_SKILLS_ROOT:-$ROOT_DIR/packaged-skills/codex}"
MANIFEST_FILE="${OPENCLAW_PACKAGED_SKILLS_MANIFEST:-$ROOT_DIR/packaged-skills/skills.manifest}"
OVERWRITE="${OPENCLAW_LOCAL_SKILLS_OVERWRITE:-true}"
UPDATE_MANIFEST="${OPENCLAW_LOCAL_SKILLS_UPDATE_MANIFEST:-true}"
DRY_RUN="false"

usage() {
  cat <<'USAGE'
Usage: sync_local_skills_to_packaged.sh [options]

Copy selected local skills into packaged-skills/codex and optionally update skills.manifest.

Options:
  --skills CSV              skill names to sync (default: tavily-search,delegate-coding-tasks)
  --overwrite true|false    replace existing packaged dirs (default: true)
  --update-manifest true|false
  --dry-run                 print actions without writing
  -h, --help                show help
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

copy_skill() {
  local name="$1"
  local src=""
  local dst="$DST_ROOT/$name"

  if [[ -d "$SRC_OPENCLAW/$name" ]]; then
    src="$SRC_OPENCLAW/$name"
  elif [[ -d "$SRC_CODEX/$name" ]]; then
    src="$SRC_CODEX/$name"
  else
    log "skip missing local skill: $name"
    return
  fi

  if [[ -e "$dst" && "$OVERWRITE" != "true" ]]; then
    log "skip existing packaged skill (overwrite=false): $name"
    return
  fi

  log "sync skill: $src -> $dst"
  synced+=("$name")
  [[ "$DRY_RUN" == "true" ]] && return

  mkdir -p "$DST_ROOT"
  if command -v rsync >/dev/null 2>&1; then
    mkdir -p "$dst"
    rsync -a --delete "$src/" "$dst/"
  else
    rm -rf "$dst"
    cp -a "$src" "$dst"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skills) SKILLS_CSV="${2:-}"; shift 2 ;;
    --overwrite) OVERWRITE="${2:-}"; shift 2 ;;
    --update-manifest) UPDATE_MANIFEST="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN="true"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

OVERWRITE="$(bool_normalize "$OVERWRITE")"
UPDATE_MANIFEST="$(bool_normalize "$UPDATE_MANIFEST")"

synced=()
IFS=',' read -r -a raw_names <<<"$SKILLS_CSV"
for raw in "${raw_names[@]}"; do
  name="$(trim "$raw")"
  [[ -n "$name" ]] || continue
  copy_skill "$name"
done

if [[ "$UPDATE_MANIFEST" == "true" && "${#synced[@]}" -gt 0 ]]; then
  log "update manifest: $MANIFEST_FILE"
  if [[ "$DRY_RUN" != "true" ]]; then
    tmp="$(mktemp)"
    {
      if [[ -f "$MANIFEST_FILE" ]]; then
        grep -E '^#' "$MANIFEST_FILE" || true
      else
        echo "# Packaged custom skills installed by scripts/install_packaged_skills.sh"
      fi
      {
        [[ -f "$MANIFEST_FILE" ]] && grep -E '^codex/' "$MANIFEST_FILE" || true
        for name in "${synced[@]}"; do
          echo "codex/$name"
        done
      } | sed '/^$/d' | sort -u
    } > "$tmp"
    mv "$tmp" "$MANIFEST_FILE"
  fi
fi

log "sync complete (synced=${#synced[@]})"
