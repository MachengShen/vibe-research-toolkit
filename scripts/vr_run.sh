#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/vr_run.sh --run-id <id> --run-dir <dir> -- <command> [args...]

Options:
  --run-id <id>      Explicit run id. If omitted, one is generated.
  --run-dir <dir>    Output directory. Defaults to exp/results/<run-id>.
  --help             Show this help.

Environment:
  VR_PRIMARY_NAME                 Default: objective
  VR_PRIMARY_HIGHER_IS_BETTER     Default: false
  VR_ENV_ALLOWLIST                Comma-separated keys to include in meta.json
  VR_ALLOWED_RUN_ROOTS            Optional comma-separated absolute roots; rejects run-dir outside these roots.
  VR_JOB_ID / RELAY_JOB_ID        Optional job id for run metadata.
  VR_TASK_ID / RELAY_TASK_ID      Optional task id for run metadata.
EOF
}

die() {
  printf '[vr_run][fail] %s\n' "$*" >&2
  exit 1
}

normalize_bool() {
  local raw
  raw="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    1|true|yes|y|on) printf 'true' ;;
    0|false|no|n|off) printf 'false' ;;
    *) die "invalid boolean value: $1" ;;
  esac
}

resolve_python() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi
  if command -v python >/dev/null 2>&1; then
    command -v python
    return
  fi
  die "python3/python not found"
}

random_suffix() {
  tr -dc 'a-z0-9' </dev/urandom | head -c 4
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="$(resolve_python)"

RUN_ID=""
RUN_DIR=""
PRIMARY_NAME="${VR_PRIMARY_NAME:-objective}"
PRIMARY_HIGHER_IS_BETTER="$(normalize_bool "${VR_PRIMARY_HIGHER_IS_BETTER:-false}")"
ENV_ALLOWLIST="${VR_ENV_ALLOWLIST:-CUDA_VISIBLE_DEVICES,OMP_NUM_THREADS,PYTHONPATH,HF_HOME,WANDB_MODE,WANDB_PROJECT,WANDB_RUN_ID,NO_PROXY,HTTPS_PROXY,HTTP_PROXY,ALL_PROXY}"
ALLOWED_RUN_ROOTS="${VR_ALLOWED_RUN_ROOTS:-}"
JOB_ID="${VR_JOB_ID:-${RELAY_JOB_ID:-}}"
TASK_ID="${VR_TASK_ID:-${RELAY_TASK_ID:-}}"

CMD=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id)
      [[ $# -ge 2 ]] || die "--run-id requires a value"
      RUN_ID="$2"
      shift 2
      ;;
    --run-dir)
      [[ $# -ge 2 ]] || die "--run-dir requires a value"
      RUN_DIR="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      CMD=("$@")
      break
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ "${#CMD[@]}" -gt 0 ]] || die "missing command after --"

if [[ -z "$RUN_ID" ]]; then
  suffix="$(random_suffix || true)"
  [[ -n "$suffix" ]] || suffix="0000"
  RUN_ID="r$(date +%Y%m%d-%H%M%S)-${suffix}"
fi
if [[ -z "$RUN_DIR" ]]; then
  RUN_DIR="exp/results/${RUN_ID}"
fi

mkdir -p "$RUN_DIR/artifacts"
RUN_DIR_ABS="$(cd "$RUN_DIR" && pwd)"

if [[ -n "$ALLOWED_RUN_ROOTS" ]]; then
  allowed=false
  IFS=',' read -r -a roots <<<"$ALLOWED_RUN_ROOTS"
  for raw in "${roots[@]}"; do
    root="$(printf '%s' "$raw" | xargs)"
    [[ -n "$root" ]] || continue
    if [[ "$RUN_DIR_ABS" == "$root" || "$RUN_DIR_ABS" == "$root/"* ]]; then
      allowed=true
      break
    fi
  done
  [[ "$allowed" == true ]] || die "run-dir '$RUN_DIR_ABS' is outside VR_ALLOWED_RUN_ROOTS"
fi

TRAIN_LOG="${RUN_DIR_ABS}/train.log"
META_PATH="${RUN_DIR_ABS}/meta.json"
METRICS_PATH="${RUN_DIR_ABS}/metrics.json"

STARTED_AT="$(date --iso-8601=seconds)"

GIT_COMMIT=""
GIT_BRANCH=""
GIT_DIRTY="unknown"
if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
  GIT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ -n "$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null)" ]]; then
    GIT_DIRTY="true"
  else
    GIT_DIRTY="false"
  fi
fi

SELECTED_ENV_JSON="$(
  "$PYTHON_BIN" - "$ENV_ALLOWLIST" <<'PY'
import json
import os
import sys

keys = [k.strip() for k in sys.argv[1].split(",") if k.strip()]
print(json.dumps({k: os.environ[k] for k in keys if k in os.environ}, sort_keys=True))
PY
)"

"$PYTHON_BIN" - "$META_PATH" "$RUN_ID" "$RUN_DIR_ABS" "$STARTED_AT" "$(pwd)" "$GIT_COMMIT" "$GIT_BRANCH" "$GIT_DIRTY" "$SELECTED_ENV_JSON" "$JOB_ID" "$TASK_ID" "${CMD[@]}" <<'PY'
import json
import pathlib
import sys

meta_path = pathlib.Path(sys.argv[1])
run_id = sys.argv[2]
run_dir = sys.argv[3]
started_at = sys.argv[4]
cwd = sys.argv[5]
git_commit = sys.argv[6]
git_branch = sys.argv[7]
git_dirty = sys.argv[8]
selected_env = json.loads(sys.argv[9])
job_id = sys.argv[10]
task_id = sys.argv[11]
command = sys.argv[12:]

meta = {
    "run_id": run_id,
    "run_dir": run_dir,
    "started_at": started_at,
    "cwd": cwd,
    "command": command,
    "git": {
        "commit": git_commit or None,
        "branch": git_branch or None,
        "dirty": git_dirty,
    },
    "context": {
        "job_id": job_id or None,
        "task_id": task_id or None,
    },
    "env": selected_env,
}

meta_path.write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

printf '[vr_run] run_id=%s\n' "$RUN_ID"
printf '[vr_run] run_dir=%s\n' "$RUN_DIR_ABS"
printf '[vr_run] command=%s\n' "${CMD[*]}"

set +e
"${CMD[@]}" > >(tee "$TRAIN_LOG") 2>&1
CMD_EXIT=$?
set -e

ENDED_AT="$(date --iso-8601=seconds)"

"$PYTHON_BIN" - "$METRICS_PATH" "$RUN_ID" "$RUN_DIR_ABS" "$STARTED_AT" "$ENDED_AT" "$CMD_EXIT" "$PRIMARY_NAME" "$PRIMARY_HIGHER_IS_BETTER" "$JOB_ID" "$TASK_ID" <<'PY'
import json
import pathlib
import sys
from typing import Any


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


metrics_path = pathlib.Path(sys.argv[1])
run_id = sys.argv[2]
run_dir = sys.argv[3]
started_at = sys.argv[4]
ended_at = sys.argv[5]
exit_code = int(sys.argv[6])
primary_name = sys.argv[7]
primary_higher = sys.argv[8].lower() == "true"
job_id = sys.argv[9]
task_id = sys.argv[10]

doc = {}
parse_notes = []

if metrics_path.exists():
    try:
        existing = json.loads(metrics_path.read_text(encoding="utf-8"))
        if isinstance(existing, dict):
            doc = existing
        else:
            parse_notes.append("existing metrics.json was not an object")
    except Exception as exc:
        parse_notes.append(f"existing metrics.json parse error: {exc}")

status = doc.get("status")
if status not in {"success", "failed", "canceled"}:
    status = "success" if exit_code == 0 else "failed"
elif exit_code != 0 and status == "success":
    status = "failed"

primary = doc.get("primary")
if not isinstance(primary, dict):
    primary = {}

name = primary.get("name")
if not isinstance(name, str) or not name:
    name = primary_name

value = primary.get("value")
if not is_number(value):
    metrics_obj = doc.get("metrics")
    if isinstance(metrics_obj, dict) and is_number(metrics_obj.get(name)):
        value = float(metrics_obj[name])
    else:
        value = 0.0

higher = primary.get("higher_is_better")
if not isinstance(higher, bool):
    higher = primary_higher

metrics_obj = doc.get("metrics")
if not isinstance(metrics_obj, dict):
    metrics_obj = {}
    for key, candidate in doc.items():
        if key in {"status", "primary", "metrics", "run", "artifacts", "error"}:
            continue
        if is_number(candidate):
            metrics_obj[str(key)] = candidate

run = doc.get("run")
if not isinstance(run, dict):
    run = {}
run["run_id"] = run.get("run_id") or run_id
run["started_at"] = run.get("started_at") or started_at
run["ended_at"] = ended_at
if job_id and not run.get("job_id"):
    run["job_id"] = job_id
if task_id and not run.get("task_id"):
    run["task_id"] = task_id

artifacts = doc.get("artifacts")
if not isinstance(artifacts, dict):
    artifacts = {}
artifacts.setdefault("run_dir", run_dir)
artifacts.setdefault("metrics", str(metrics_path))
artifacts.setdefault("log", str(metrics_path.parent / "train.log"))
artifacts.setdefault("meta", str(metrics_path.parent / "meta.json"))

error = doc.get("error")
if not isinstance(error, str):
    error = ""
if exit_code != 0 and not error:
    error = f"command exited with code {exit_code}"
if parse_notes:
    extra = "; ".join(parse_notes)
    error = f"{error}; {extra}" if error else extra

doc["status"] = status
doc["primary"] = {"name": name, "value": float(value), "higher_is_better": higher}
doc["metrics"] = metrics_obj
doc["run"] = run
doc["artifacts"] = artifacts

if error:
    doc["error"] = error
elif "error" in doc and status == "success":
    del doc["error"]

metrics_path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

"$PYTHON_BIN" - "$META_PATH" "$ENDED_AT" "$CMD_EXIT" <<'PY'
import json
import pathlib
import sys

meta_path = pathlib.Path(sys.argv[1])
ended_at = sys.argv[2]
exit_code = int(sys.argv[3])

meta = json.loads(meta_path.read_text(encoding="utf-8"))
meta["ended_at"] = ended_at
meta["exit_code"] = exit_code
meta_path.write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

if [[ -f "$ROOT_DIR/tools/exp/validate_metrics.py" ]]; then
  if ! "$PYTHON_BIN" "$ROOT_DIR/tools/exp/validate_metrics.py" "$METRICS_PATH" >/dev/null; then
    printf '[vr_run][fail] produced invalid metrics.json: %s\n' "$METRICS_PATH" >&2
    exit 2
  fi
fi

if [[ "$CMD_EXIT" -ne 0 ]]; then
  printf '[vr_run] command failed with exit_code=%s\n' "$CMD_EXIT" >&2
  exit "$CMD_EXIT"
fi

printf '[vr_run] completed run_id=%s metrics=%s\n' "$RUN_ID" "$METRICS_PATH"
