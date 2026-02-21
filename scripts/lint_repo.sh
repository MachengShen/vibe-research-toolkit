#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failures=0

log() {
  printf '[lint] %s\n' "$*"
}

fail() {
  printf '[lint][fail] %s\n' "$*" >&2
  failures=$((failures + 1))
}

run_check() {
  local label="$1"
  shift
  log "$label"
  if ! "$@"; then
    fail "$label"
  fi
}

check_skill_frontmatter() {
  local skill_path="$1"
  if [[ ! -f "$skill_path" ]]; then
    fail "missing skill file: $skill_path"
    return
  fi

  local header
  if ! header="$(awk '
    NR==1 {
      if ($0 != "---") {
        print "__NO_HEADER__"
        exit 0
      }
      next
    }
    $0 == "---" {
      exit 0
    }
    {
      print
    }
  ' "$skill_path")"; then
    fail "failed reading YAML header: $skill_path"
    return
  fi

  if [[ "$header" == "__NO_HEADER__" ]]; then
    fail "missing YAML header delimiters in: $skill_path"
    return
  fi

  if ! printf '%s\n' "$header" | grep -Eq '^[[:space:]]*name:[[:space:]]*[^[:space:]].*$'; then
    fail "missing YAML 'name' in: $skill_path"
  fi
  if ! printf '%s\n' "$header" | grep -Eq '^[[:space:]]*description:[[:space:]]*[^[:space:]].*$'; then
    fail "missing YAML 'description' in: $skill_path"
  fi
}

run_check "node --check codex-discord-relay/relay.js" node --check codex-discord-relay/relay.js
run_check "bash -n bootstrap.sh" bash -n bootstrap.sh

for script in scripts/*.sh; do
  run_check "bash -n ${script}" bash -n "$script"
done

if command -v shellcheck >/dev/null 2>&1; then
  run_check "shellcheck bootstrap.sh scripts/*.sh" shellcheck bootstrap.sh scripts/*.sh
else
  log "shellcheck not found; skipping shellcheck checks"
fi

if [[ -d packaged-skills/codex ]]; then
  while IFS= read -r -d '' skill_dir; do
    check_skill_frontmatter "${skill_dir}/SKILL.md"
  done < <(find packaged-skills/codex -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)
else
  fail "missing packaged-skills/codex directory"
fi

if [[ "$failures" -gt 0 ]]; then
  printf '\n[lint] completed with %d failure(s)\n' "$failures" >&2
  exit 1
fi

printf '\n[lint] all checks passed\n'
