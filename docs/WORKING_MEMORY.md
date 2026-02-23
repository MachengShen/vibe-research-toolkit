# Toolkit Working Memory (living snapshot)

Last updated: 2026-02-22T19:59:24+08:00
Repo: /root/VibeResearch_toolkit
Branch: p2-ml-automation
Commit: 64dc6dc (dirty: yes)

## Objective
Maintain `vibe-research-toolkit` as the canonical Discord-first research operations toolkit and ship P2 automation so ML runs are deterministic, schema-validated, and auto-comparable.

## Current relay capabilities (high signal)
- Persistent conversation sessions with queue-safe execution.
- `/task`, `/worktree`, `/plan`, `/job`, `/handoff`, `/status` workflows.
- Callback-driven long-run pattern (`job_start` + `watch` + `thenTask`) with queue-independent finalization.
- Read-only status command bypass during active runs.
- Codex/Claude retry hardening and proxy-aware operational defaults.

## P2 ML automation status
### Layer 1 (implemented)
- Deterministic wrapper:
  - `scripts/vr_run.sh`
- Metrics contract + validation:
  - `tools/exp/metrics_schema.json`
  - `tools/exp/validate_metrics.py`
- Registry append:
  - `tools/exp/append_registry.py`
  - append-only JSONL; duplicate `run_id` fails closed by default
- Run summary generation:
  - `tools/exp/summarize_run.py`

### Layer 2 MVP (implemented in templates + skill guidance)
- Experiment templates:
  - `templates/experiments/train_baseline.yaml`
  - `templates/experiments/ablation_lr.yaml`
  - `templates/experiments/eval_only.yaml`
- Relay callback skill update with research-run profile:
  - `packaged-skills/codex/relay-long-task-callback/SKILL.md`
  - includes run allocation + validation + registry + summary + memory update steps in `thenTask`

### User docs
- `docs/USER_MANUAL.md` now includes “ML automation package (run wrapper + registry)”.

## Verification evidence (latest)
- Repo lint: `bash scripts/lint_repo.sh` (pass)
- Wrapper success path:
```bash
scripts/vr_run.sh --run-id rtest-... --run-dir /tmp/vrtest/rtest-... -- bash -lc 'echo hello; exit 0'
python3 tools/exp/validate_metrics.py /tmp/vrtest/rtest-.../metrics.json
```
- Registry append + duplicate guard:
```bash
python3 tools/exp/append_registry.py --registry /tmp/vrtest/registry.jsonl --run-dir /tmp/vrtest/rtest-...
python3 tools/exp/append_registry.py --registry /tmp/vrtest/registry.jsonl --run-dir /tmp/vrtest/rtest-...  # fails duplicate by default
```
- Summary generation:
```bash
python3 tools/exp/summarize_run.py --run-dir /tmp/vrtest/rtest-... --out-md /tmp/vrtest/summary.md --append
```
- Failure-path validation:
  - `vr_run.sh` with non-zero command exit still writes schema-valid `metrics.json` with `status=failed` and non-empty `error`.

## Latest commits (relevant)
- `b624dfb` merge commit for PR #3 (`p2-ml-automation` -> `main`)
- `64dc6dc` feat: add ML experiment run contract automation tools
- `32788e5` merge PR #2 docs naming normalization
- `cd0000e` merge PR #1 release hardening stream

## Current publication state
- Canonical remote: `https://github.com/MachengShen/vibe-research-toolkit.git`
- Visibility: public
- Latest release: `v1.0.1`
- PR merged: `https://github.com/MachengShen/vibe-research-toolkit/pull/3`

## Open priorities
1. Optional next step: add `/exp run` and `/exp sweep` (or research actions `exp_run`/`exp_sweep`) for unattended sequential sweeps.
2. Wire an explicit post-run helper/task path that auto-updates `HANDOFF_LOG.md` and rewrites this file after each completed run.
3. Add a small template renderer utility (template + key=value -> concrete command) to reduce prompt-side formatting errors.
4. Keep `scripts/lint_repo.sh` and docs/skill examples aligned when automation interfaces evolve.

## 2026-02-22T22:12:15+08:00
### Objective
- Execute pipeline+ML robustness v2 implementation (runtime guardrails + tooling hardening) while keeping deployment safe for active experiments.

### Current state snapshot
- Runtime contract additions are implemented in toolkit relay source:
  - watch artifact gating (`requireFiles`, timeout/poll, onMissing)
  - `job_start.preflight` checks
  - wait-pattern guard (`off|warn|reject`)
  - visibility startup/heartbeat degradation tracking
  - persisted lifecycle transitions per job
- ML run/tooling contract is hardened:
  - signal-safe `vr_run.sh` with guaranteed `metrics.json`/`meta.json`
  - lock-safe `append_registry.py`
  - `summarize_run.py --registry`
  - new `render_template.py` and `best_run.py`
- Callback skill profile in packaged skills updated for required `watch.requireFiles` + preflight usage.

### Verification evidence
- `node --check /root/VibeResearch_toolkit/codex-discord-relay/relay.js` (pass)
- `bash -n /root/VibeResearch_toolkit/scripts/vr_run.sh` (pass)
- `python3 -m py_compile .../tools/exp/*.py` (pass)
- smoke suite (pass):
  - template render
  - vr_run success/failure/cancel with schema validation
  - registry duplicate fail-closed
  - best-run selection

### Deployment state
- Toolkit runtime files were synced to live mirror under `/root/codex-discord-relay`.
- No relay restart performed yet (intentional to avoid interrupting running jobs).

### Next steps
1. Canary-enable flags in one conversation/project:
   - `RELAY_WATCH_REQUIRE_FILES_ENABLED=true`
   - `RELAY_JOB_PREFLIGHT_ENABLED=true`
   - `RELAY_VISIBILITY_GATE_ENABLED=true`
   - `RELAY_WAIT_PATTERN_GUARD_MODE=warn`
2. Restart relay instance during a safe window to activate runtime changes.
3. Observe 24h canary behavior and then consider broader enablement.
