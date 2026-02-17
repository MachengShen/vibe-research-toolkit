#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: init_repo_memory.sh [--force]

Creates repo-local working-memory and handoff files:
  docs/WORKING_MEMORY.md
  HANDOFF_LOG.md

Options:
  --force    overwrite existing files
  -h, --help show this help
USAGE
}

force=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) force=true; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  repo_root="$(pwd -P)"
fi

mkdir -p "$repo_root/docs"

work_file="$repo_root/docs/WORKING_MEMORY.md"
handoff_file="$repo_root/HANDOFF_LOG.md"
timestamp="$(date '+%Y-%m-%d %H:%M %Z')"

work_template="$(cat <<EOF
# Working Memory (append-only)

## $timestamp
### Objective
- ...

### Evidence inspected
- ...

### Conclusions
- ...

### Open items
- ...
EOF
)"

handoff_template="$(cat <<EOF
# Handoff Log (append-only)

## $timestamp
- Changed: ...
- Evidence: ...
- Next step: ...
EOF
)"

write_template_if_needed() {
  local target="$1"
  local body="$2"

  if [[ -f "$target" && "$force" != "true" ]]; then
    echo "keep: $target"
    return 0
  fi

  printf '%s\n' "$body" > "$target"
  echo "write: $target"
}

write_template_if_needed "$work_file" "$work_template"
write_template_if_needed "$handoff_file" "$handoff_template"

