# GBDPro Review Brief — Pipeline + ML Robustness v2

**Date:** 2026-02-23  
**Repo:** `MachengShen/vibe-research-toolkit`  
**Branch:** `p2-ml-automation`

## Scope Completed
Implemented the attached robustness v2 plan across relay runtime, ML run wrapper, experiment tooling, and callback skill guidance.

## Key Runtime Changes
- Added watch artifact-gating contract in `codex-discord-relay/relay.js`:
  - `watch.requireFiles`, `readyTimeoutSec`, `readyPollSec`, `onMissing`
  - fail-closed callback flow with lifecycle transitions and telemetry
- Added `job_start.preflight` checks:
  - `path_exists`, `cmd_exit_zero`, `min_free_disk_gb`
- Added unsafe wait-pattern guard (`pgrep -f` self-match detection) controlled by `RELAY_WAIT_PATTERN_GUARD_MODE`
- Added long-job visibility gating/heartbeat degradation tracking
- Added/confirmed feature flags in `.env.example` and documented rollout in `README.md`

## Key ML Tooling Changes
- Hardened `scripts/vr_run.sh`:
  - trap-based shutdown handling (`EXIT`, `INT`, `TERM`)
  - guaranteed `metrics.json` + `meta.json` on success/failure/cancel
- Hardened `tools/exp/append_registry.py` with file-locking and deterministic duplicate behavior
- Updated `tools/exp/summarize_run.py` with optional `--registry`
- Added `tools/exp/render_template.py` (template -> command/watch/artifact rendering)
- Added `tools/exp/best_run.py` (best successful run selection)

## Skill/Workflow Update
- Updated `packaged-skills/codex/relay-long-task-callback/SKILL.md` to require `watch.requireFiles` and readiness timeout in research run profile.

## Verification Executed
- `node --check codex-discord-relay/relay.js`
- `bash -n scripts/vr_run.sh`
- `python3 -m py_compile tools/exp/append_registry.py tools/exp/summarize_run.py tools/exp/render_template.py tools/exp/best_run.py`
- smoke checks:
  - template rendering
  - wrapper success/failure/cancel artifact validation
  - registry duplicate fail-closed behavior
  - best-run selection output

## Rollout Guidance
1. Merge/deploy code first with all new flags disabled.
2. Canary-enable in one conversation/project:
   - `RELAY_WATCH_REQUIRE_FILES_ENABLED=true`
   - `RELAY_JOB_PREFLIGHT_ENABLED=true`
   - `RELAY_VISIBILITY_GATE_ENABLED=true`
   - `RELAY_WAIT_PATTERN_GUARD_MODE=warn` (then `reject` after confidence)
3. Promote to broader research workloads after 24h stable canary.

## Reviewer Focus Areas
- Callback gate edge cases (`onMissing=block` vs `enqueue`)
- Preflight false positives/negatives for long jobs
- Signal-handling and artifact guarantees in `vr_run.sh`
- Registry lock behavior under concurrent append pressure
