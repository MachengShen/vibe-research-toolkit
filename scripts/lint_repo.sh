#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failures=0
mapfile -d '' -t shell_files < <(find . -type f -name '*.sh' -not -path './.git/*' -print0 | sort -z)
mapfile -d '' -t js_files < <(find . -type f -name '*.js' -not -path './.git/*' -print0 | sort -z)

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

check_no_crlf() {
  local file="$1"
  if LC_ALL=C grep -q $'\r' "$file"; then
    fail "CRLF line endings detected: ${file#./}"
  fi
}

check_bash_header() {
  local file="$1"
  local line1 line2
  line1="$(sed -n '1p' "$file")"
  line2="$(sed -n '2p' "$file")"

  if [[ "$line1" != "#!/usr/bin/env bash" ]]; then
    fail "invalid bash shebang in ${file#./}: '$line1'"
  fi
  if [[ "$line2" != "set -euo pipefail" ]]; then
    fail "missing strict mode second line in ${file#./}: '$line2'"
  fi
}

check_js_shebang() {
  local file="$1"
  local line1
  line1="$(sed -n '1p' "$file")"
  if [[ "$line1" == '#!'* && "$line1" != "#!/usr/bin/env node" ]]; then
    fail "invalid node shebang in ${file#./}: '$line1'"
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

if [[ "${#shell_files[@]}" -eq 0 ]]; then
  fail "no shell scripts found"
fi
if [[ "${#js_files[@]}" -eq 0 ]]; then
  fail "no JavaScript files found"
fi

for script in "${shell_files[@]}"; do
  run_check "bash -n ${script#./}" bash -n "$script"
  check_bash_header "$script"
  check_no_crlf "$script"
done

if command -v shellcheck >/dev/null 2>&1; then
  run_check "shellcheck ${#shell_files[@]} shell script(s)" shellcheck "${shell_files[@]}"
else
  log "shellcheck not found; skipping shellcheck checks"
fi

for script in "${js_files[@]}"; do
  check_js_shebang "$script"
  check_no_crlf "$script"
done

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
