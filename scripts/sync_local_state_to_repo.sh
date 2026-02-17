#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

OUTPUT_DIR="${OPENCLAW_STATE_SYNC_OUTPUT_DIR:-$ROOT_DIR/machine-state}"
WITH_SECRETS="${OPENCLAW_STATE_SYNC_INCLUDE_SECRETS:-false}"
SYNC_SKILLS="${OPENCLAW_STATE_SYNC_PACKAGE_LOCAL_SKILLS:-true}"
SKILLS_CSV="${OPENCLAW_LOCAL_SKILLS_TO_PACKAGE:-tavily-search,delegate-coding-tasks}"
DO_COMMIT="${OPENCLAW_STATE_SYNC_COMMIT:-true}"
DO_PUSH="${OPENCLAW_STATE_SYNC_PUSH:-false}"
COMMIT_MESSAGE="${OPENCLAW_STATE_SYNC_COMMIT_MESSAGE:-chore: sync local machine state snapshot}"
DRY_RUN="false"

usage() {
  cat <<'USAGE'
Usage: sync_local_state_to_repo.sh [options]

Export local machine state into repo and optionally commit/push.

Options:
  --with-secrets            include secrets in snapshot
  --no-secrets              redact snapshot (default)
  --sync-skills true|false  sync selected local skills into packaged-skills
  --skills CSV              skill names for packaging
  --commit true|false       create git commit when changes exist (default: true)
  --push true|false         push after commit (default: false)
  --message TEXT            commit message
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-secrets) WITH_SECRETS="true"; shift 1 ;;
    --no-secrets) WITH_SECRETS="false"; shift 1 ;;
    --sync-skills) SYNC_SKILLS="${2:-}"; shift 2 ;;
    --skills) SKILLS_CSV="${2:-}"; shift 2 ;;
    --commit) DO_COMMIT="${2:-}"; shift 2 ;;
    --push) DO_PUSH="${2:-}"; shift 2 ;;
    --message) COMMIT_MESSAGE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN="true"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

WITH_SECRETS="$(bool_normalize "$WITH_SECRETS")"
SYNC_SKILLS="$(bool_normalize "$SYNC_SKILLS")"
DO_COMMIT="$(bool_normalize "$DO_COMMIT")"
DO_PUSH="$(bool_normalize "$DO_PUSH")"

log "sync local state into repo (with_secrets=$WITH_SECRETS sync_skills=$SYNC_SKILLS commit=$DO_COMMIT push=$DO_PUSH dry_run=$DRY_RUN)"

export_cmd=("$ROOT_DIR/scripts/export_local_state.sh" "--output-dir" "$OUTPUT_DIR")
if [[ "$WITH_SECRETS" == "true" ]]; then
  export_cmd+=("--with-secrets")
else
  export_cmd+=("--no-secrets")
fi
[[ "$DRY_RUN" == "true" ]] && export_cmd+=("--dry-run")
"${export_cmd[@]}"

if [[ "$SYNC_SKILLS" == "true" ]]; then
  sync_cmd=("$ROOT_DIR/scripts/sync_local_skills_to_packaged.sh" "--skills" "$SKILLS_CSV")
  [[ "$DRY_RUN" == "true" ]] && sync_cmd+=("--dry-run")
  "${sync_cmd[@]}"
fi

if [[ "$DO_COMMIT" != "true" ]]; then
  log "commit disabled"
  exit 0
fi

if [[ "$DRY_RUN" == "true" ]]; then
  log "dry-run: skipping git add/commit/push"
  exit 0
fi

git -C "$ROOT_DIR" add "$OUTPUT_DIR" "$ROOT_DIR/packaged-skills/skills.manifest" 2>/dev/null || true

IFS=',' read -r -a skill_names <<<"$SKILLS_CSV"
for raw in "${skill_names[@]}"; do
  name="$(trim "$raw")"
  [[ -n "$name" ]] || continue
  if [[ -d "$ROOT_DIR/packaged-skills/codex/$name" ]]; then
    git -C "$ROOT_DIR" add "$ROOT_DIR/packaged-skills/codex/$name"
  fi
done

if git -C "$ROOT_DIR" diff --cached --quiet; then
  log "no state changes to commit"
  exit 0
fi

git -C "$ROOT_DIR" commit -m "$COMMIT_MESSAGE"

if [[ "$DO_PUSH" == "true" ]]; then
  branch="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
  git -C "$ROOT_DIR" push origin "$branch"
fi

log "sync complete"
