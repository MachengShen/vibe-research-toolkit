#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

SKILLS_SRC_ROOT="$ROOT_DIR/packaged-skills/codex"
TARGET_CODEX_HOME="${CODEX_HOME:-${OPENCLAW_CODEX_HOME:-$HOME/.codex}}"
TARGET_SKILLS_DIR="${OPENCLAW_PACKAGED_SKILLS_TARGET:-$TARGET_CODEX_HOME/skills}"
OVERWRITE="${OPENCLAW_PACKAGED_SKILLS_OVERWRITE:-true}"
ONLY="${OPENCLAW_PACKAGED_SKILLS_ONLY:-}"
LIST_ONLY="false"
DRY_RUN="false"

usage() {
  cat <<'USAGE'
Usage: install_packaged_skills.sh [options]

Options:
  --target DIR              target skills dir (default: $CODEX_HOME/skills or ~/.codex/skills)
  --overwrite true|false    replace existing installed skills (default: true)
  --only CSV                install subset, e.g. "discord-image-upload,openclaw-media-send"
  --list                    list packaged skills and exit
  --dry-run                 print actions without writing
  -h, --help                show help
USAGE
}

bool_normalize() {
  local raw="${1:-}"
  case "$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) echo "true" ;;
    0|false|no|off) echo "false" ;;
    *)
      die "invalid boolean: $raw"
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET_SKILLS_DIR="${2:-}"; shift 2 ;;
    --overwrite) OVERWRITE="$(bool_normalize "${2:-}")"; shift 2 ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    --list) LIST_ONLY="true"; shift 1 ;;
    --dry-run) DRY_RUN="true"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -d "$SKILLS_SRC_ROOT" ]] || die "missing packaged skills dir: $SKILLS_SRC_ROOT"

mapfile -t all_skills < <(find "$SKILLS_SRC_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
[[ "${#all_skills[@]}" -gt 0 ]] || die "no packaged skills found under $SKILLS_SRC_ROOT"

if [[ "$LIST_ONLY" == "true" ]]; then
  printf '%s\n' "${all_skills[@]}"
  exit 0
fi

selected=()
if [[ -n "$ONLY" ]]; then
  IFS=',' read -r -a req <<<"$ONLY"
  for name in "${req[@]}"; do
    s="$(printf '%s' "$name" | xargs)"
    [[ -n "$s" ]] || continue
    if [[ -d "$SKILLS_SRC_ROOT/$s" ]]; then
      selected+=("$s")
    else
      log "skip unknown packaged skill: $s"
    fi
  done
else
  selected=("${all_skills[@]}")
fi

[[ "${#selected[@]}" -gt 0 ]] || die "no skills selected for install"

log "installing packaged skills to $TARGET_SKILLS_DIR"
[[ "$DRY_RUN" == "true" ]] || mkdir -p "$TARGET_SKILLS_DIR"

for skill in "${selected[@]}"; do
  src="$SKILLS_SRC_ROOT/$skill"
  dst="$TARGET_SKILLS_DIR/$skill"

  if [[ -e "$dst" && "$OVERWRITE" != "true" ]]; then
    log "skip existing skill (overwrite=false): $skill"
    continue
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log "dry-run install: $skill -> $dst"
    continue
  fi

  if command -v rsync >/dev/null 2>&1; then
    mkdir -p "$dst"
    rsync -a --delete "$src/" "$dst/"
  else
    rm -rf "$dst"
    cp -a "$src" "$dst"
  fi
  log "installed skill: $skill"
done

