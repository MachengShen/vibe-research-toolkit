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
- Latest release: `v1.1.0`
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

## 2026-02-23T11:41:38+08:00
### Objective
- Finalize external-review handoff by pushing the robustness v2 implementation and producing a concise GBDPro-facing report.

### Changes
- Added reviewer brief at `/root/VibeResearch_toolkit/GBDPRO_REVIEW_BRIEF_2026-02-23.md`.
- Pushed commit `de0e1b3` to `origin/p2-ml-automation`.

### Latest commit
- `de0e1b3` — feat: implement pipeline and ML robustness v2
- Significance: introduces watch artifact gating + preflight + visibility guards in relay runtime and hardens ML run tooling/contracts for unattended runs.

### Evidence
- `/root/VibeResearch_toolkit/GBDPRO_REVIEW_BRIEF_2026-02-23.md`
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `git push origin p2-ml-automation`

### Next steps
- Open a controlled restart window to activate updated live relay runtime if not yet restarted.
- Canary-enable new runtime flags on one project/conversation before broad rollout.

## 2026-02-23T11:44:44+08:00
### Objective
- Produce a self-contained PR-style GBDPro review summary file with direct branch+commit references and canary rollout checklist.

### Changes
- Reworked `/root/VibeResearch_toolkit/GBDPRO_REVIEW_BRIEF_2026-02-23.md` into a PR-style summary including:
  - risk checklist
  - canary flag configuration table
  - reviewer focus questions
  - branch/commit inventory for direct handoff.

### Latest commit
- `7e881f0` — docs: expand GBDPro brief with PR-style risk and canary checklist
- Significance: report is now standalone for reviewer handoff without requiring separate repository links.

### Evidence
- `/root/VibeResearch_toolkit/GBDPRO_REVIEW_BRIEF_2026-02-23.md`
- `git log --oneline -n 3`

### Next steps
- Share the updated report file directly with GBDPro.
- Optional: if desired, generate a one-page “canary runbook” companion file with restart/check/rollback commands.

## 2026-02-23T13:33:43+08:00
### Objective
- Address reviewer concern that the robustness stream lacks an essential execution check gate.

### Changes
- Added a concrete implementation plan for execution assurance:
  - `/root/VibeResearch_toolkit/docs/plans/2026-02-23-essential-execution-check-gate.md`
- Plan scope includes:
  - required PR execution gate (`scripts/essential_exec_check.sh` + CI enforcement)
  - extended robustness suite (`scripts/robustness_exec_suite.sh` + testbed + nightly workflow)
  - PR checklist/template integration and machine-readable summary validation.

### Current state
- Current CI remains lint-only until implementation is executed.
- No runtime behavior changed in this planning step.

### Next steps
1. Review and approve plan.
2. Implement Tasks 1-4 first (contract + essential gate + CI enforcement) as MVP.
3. Add extended suite and reviewer UX tasks after MVP gate is stable.

## 2026-02-23T13:48:08+08:00
### Objective
- Implement MVP execution assurance (Tasks 1-4): required execution gate + CI enforcement + extended robustness runbook/suite.

### Changes
- Added required PR execution gate script and outputs:
  - `scripts/essential_exec_check.sh`
  - `reports/essential_exec/<timestamp>/{suite_log.md,summary.json}`
- Added extended robustness suite components:
  - `scripts/robustness_exec_suite.sh`
  - `tools/testbed/toy_train.py`
  - `docs/runbooks/ROBUSTNESS_EXEC_SUITE.md`
- Added explicit contract doc:
  - `docs/verification/EXECUTION_CHECK_CONTRACT.md`
- CI updates:
  - `.github/workflows/ci.yml` now includes required `essential-exec` job + artifacts
  - `.github/workflows/robustness-nightly.yml` added for nightly/manual suite runs
- Documentation updated in `README.md`; reports ignored via `.gitignore`.

### Latest commit
- `54daa36` — ci: add essential execution gate and robustness suite
- Significance: closes the primary design gap by making execution checks first-class and CI-enforced.

### Verification evidence
- `bash scripts/lint_repo.sh` (pass)
- `bash scripts/essential_exec_check.sh` (pass)
- `bash scripts/robustness_exec_suite.sh` (pass)

### Next steps
1. Add PR template/checklist integration so reviewers must attach execution evidence.
2. Add machine-readable summary schema checker (`tools/verification/check_summary.py`) and enforce in CI.
3. Run one Discord runtime canary session (wait-loop guard + visibility + restart recovery) and link logs.

## 2026-02-23T14:00:57+0800
### Objective
- Finish full implementation of GBDPro execution-check proposal by completing post-MVP Tasks 5-8.

### Changes
- Added reviewer integration artifacts:
  - `.github/pull_request_template.md`
  - `docs/verification/PR_REVIEW_CHECKLIST.md`
- Added summary schema validator:
  - `tools/verification/check_summary.py`
- Updated execution scripts:
  - `scripts/essential_exec_check.sh` and `scripts/robustness_exec_suite.sh` now include per-test evidence paths, timestamp logging, and summary-schema validation.
  - robustness suite auto-generates D-section final summary requirements.
- Updated workflow enforcement:
  - `.github/workflows/ci.yml`
  - `.github/workflows/robustness-nightly.yml`
- Updated docs:
  - `CONTRIBUTING.md`
  - `README.md`
  - `docs/runbooks/ROBUSTNESS_EXEC_SUITE.md`
  - `docs/verification/EXECUTION_CHECK_CONTRACT.md`

### Latest commit
- `fb901f1` — `ci: complete execution-check gate with reviewer template and summary validation`
- Significance: closes remaining proposal gaps (reviewer checklist UX + machine-readable quality gate + rollout/DoD contract), so the execution-check design is now fully implemented in code/docs/workflows.

### Verification
- `bash scripts/lint_repo.sh` (pass)
- `bash scripts/essential_exec_check.sh` (pass)
- `bash scripts/robustness_exec_suite.sh` (pass)

### Next steps
1. Run one Discord/manual Tier-3 canary (T7/T8/T9) and attach evidence paths to a PR.
2. Make `essential-exec` a required branch protection check if not already enforced in GitHub settings.

## 2026-02-23T17:16:34+0800
### Objective
- Apply requested relay monitoring optimizations with distribution/docs parity for future toolkit users.

### Changes
- Updated relay runtime behavior and defaults for callback-first long-run monitoring:
  - long-task watcher defaults tuned to , reduced tail volume.
  - stale-progress guard added (unchanged log + low utilization window).
- Synced live/toolkit relay runtime docs/env files.
- Added six packaged collaboration skills and updated packaged skills manifest.
- Added mandatory skill map guidance to toolkit workflow docs.

### Verification
-  (pass)
- live/toolkit relay parity checks passed (, , ).

### Evidence
- /root/VibeResearch_toolkit/codex-discord-relay/relay.js
- /root/VibeResearch_toolkit/codex-discord-relay/README.md
- /root/VibeResearch_toolkit/codex-discord-relay/.env.example
- /root/VibeResearch_toolkit/packaged-skills/skills.manifest
- /root/VibeResearch_toolkit/README.md
- /root/VibeResearch_toolkit/AGENTS.md

### Next steps
1. Run one canary long-run in Discord and confirm watcher cadence/noise reduction and stale-guard alert semantics.
2. If stable, roll the same env defaults across any additional relay instances.

## 2026-02-23T17:38:05+0800
### Objective
- Capture append-format guardrail after command-substitution noise in a prior handoff write.

### Changes
- Added guardrail: all memory markdown appends must use `<<'EOF'` quoted heredocs.

### Evidence
- /root/VibeResearch_toolkit/HANDOFF_LOG.md
- /root/VibeResearch_toolkit/docs/WORKING_MEMORY.md

### Next steps
- Reuse quoted-heredoc append snippets for future automation notes.

## 2026-02-23T22:16:05+0800
### Objective
- Support selective progress persistency in Discord: durable narrative updates while command-level traces remain transient.

### Current state
- Relay now supports `RELAY_PROGRESS_PERSISTENT_MODE` with `narrative` filtering.
- New knobs available for persistent-progress text bounds:
  - `RELAY_PROGRESS_PERSISTENT_MIN_CHARS`
  - `RELAY_PROGRESS_PERSISTENT_MAX_CHARS`
- Runtime env on this server is set to `narrative` mode for both default and claude relay instances.

### Files updated
- `codex-discord-relay/relay.js`
- `codex-discord-relay/README.md`
- `codex-discord-relay/.env.example`
- `config/setup.env.example`

### Next step
1. Run one Discord canary in a thread and confirm durable progress posts retain high-signal notes while command/tool traces stay transient in the edited Running message.

## 2026-02-23T22:27:47+0800
### Objective
- Improve Discord UX with durable narrative progress + explicit milestones, while keeping command traces transient.

### Current state
- New mode: `RELAY_PROGRESS_PERSISTENT_MODE=narrative+milestones`.
- Durable updates now include checkpoint summaries such as:
  - `Milestone: request queued`
  - `Milestone: run started`
  - `Milestone: context loaded`
  - `Milestone: ready to summarize`
- Command/tool trace lines remain in transient edited `Running ...` status only.

### Updated files
- `codex-discord-relay/relay.js`
- `codex-discord-relay/README.md`
- `codex-discord-relay/.env.example`
- `config/setup.env.example`

## 2026-02-23T22:36:41+08:00
### Objective
- Align toolkit docs with open-research contract/playbook baseline.

### Changes
- Added toolkit-local contract and canonical governance artifacts:
  - `docs/OPEN_RESEARCH_CONTRACT.md`
  - `docs/CLAIM_LEDGER.md`
  - `docs/NEGATIVE_RESULTS.md`
  - `docs/templates/*`

### Evidence
- `/root/VibeResearch_toolkit/docs/OPEN_RESEARCH_CONTRACT.md`
- `/root/VibeResearch_toolkit/docs/CLAIM_LEDGER.md`
- `/root/VibeResearch_toolkit/docs/NEGATIVE_RESULTS.md`
- `/root/VibeResearch_toolkit/docs/templates/`

### Next step
- Optional follow-up: wire these files into runtime env (`RELAY_CONTEXT_FILE`, `RELAY_HANDOFF_FILES`) during a drained restart window.

## 2026-02-24T14:32:55+08:00
### Objective
- Deliver Phase 1 relay-native supervisor path for smoke-gated long runs.

### Current state
- `job_start` now supports a feature-gated `supervisor` block (`stage0_smoke_gate`).
- Relay compiles supervisor spec to command, auto-injects required watch files, and validates state/cleanup contract before callback enqueue.
- New knobs are documented in toolkit env/docs:
  - `RELAY_SUPERVISOR_PHASE1_ENABLED`
  - `RELAY_SUPERVISOR_PHASE1_DEFAULT_*`
  - `RELAY_MAX_JOB_COMMAND_CHARS`

### Validation snapshot
- Syntax checks passed on toolkit/live `relay.js`.
- Runtime canary run `relay_phase1_canary_1771914624004` succeeded with expected cleanup behavior.
- Supervisor validator mismatch path correctly reports `supervisor_state_status_mismatch`.

### Evidence
- `/root/VibeResearch_toolkit/codex-discord-relay/relay.js`
- `/root/VibeResearch_toolkit/codex-discord-relay/README.md`
- `/root/VibeResearch_toolkit/codex-discord-relay/.env.example`
- `/root/VibeResearch_toolkit/config/setup.env.example`
- `/root/ebm-online-rl-prototype/tmp/relay_phase1_canary_1771914624004/state.json`

### Next steps
1. Turn on phase1 flag in live env and restart after drain.
2. Run one Discord-thread canary via native supervisor action path.

## 2026-02-24T14:33:38+08:00
### Activation status
- Runtime restart to load Phase 1 changes is pending; safe restart was blocked by active-run drain guard.
- Relay process remains healthy/running.

### Next step
- Retry safe restart post-drain and execute native supervisor canary action.

## 2026-02-24T15:49:54+08:00
### Scope
- Investigating why relay validation touched `/root/ebm-online-rl-prototype` and preparing a toolkit remote push.
- Current plan: verify relay/runtime files, commit coherent toolkit snapshot, push to `origin/p2-ml-automation`, then report stability status.

## 2026-02-24T15:50:45+08:00
### Latest commit reference
- `08c9f28` feat(relay): integrate phase1 supervisor flow and sync toolkit runtime assets.
- Significance: remote toolkit branch now contains the current Phase 1 supervisor integration snapshot and associated runtime/docs/skills packaging updates.
- Push status: `origin/p2-ml-automation` advanced to `08c9f28`.

## 2026-02-24T16:26:47+08:00
### Scope
- Portability hardening for relay Phase 1 supervisor.
- Planned change: vendor `stage0_smoke_gate.py` into relay repo and make script-path resolution prefer bundled runner when project-local path is absent.

## 2026-02-24T16:30:18+08:00
### Latest commit reference
- `290ef88` feat(relay): bundle stage0 supervisor runner for portable deployments.
- Significance: relay package now carries its own stage0 smoke-gate runtime and no longer operationally depends on EBM repo path presence for Phase 1 supervisor default behavior.
- Push status: `origin/p2-ml-automation` advanced to `290ef88`.

## 2026-02-24T20:19:15+08:00
### Process guardrail
- For markdown log appends, keep `<<'EOF'` quoted and print dynamic values (timestamps/run IDs) with `printf` outside the heredoc body to avoid literal placeholder leakage.

## 2026-02-24T20:19:22+08:00
### Latest commit reference
- `e93d3f3` release: bump toolkit to v1.1.0
- Significance: aligns release metadata and user-facing manuals/changelog to `1.1.0` after fresh local execution-gate verification.
- Verification evidence: `reports/essential_exec/release_1_1_0_20260224-201801/summary.json`.

## 2026-02-24T20:20:21+08:00
### Release snapshot
- Release status: `ready` after fresh execution-gate verification.
- Latest release tag: `v1.1.0` (points to `e93d3f3`).
- Branch head on remote: `origin/p2-ml-automation` at `8a93861`.
- Verification artifact: `reports/essential_exec/release_1_1_0_20260224-201801/summary.json` (`overall=pass`, `required_failed=0`).

## 2026-02-24T20:33:03+08:00
### Release snapshot
- GitHub release `v1.1.0` is now published at:
  - `https://github.com/MachengShen/vibe-research-toolkit/releases/tag/v1.1.0`
- Release state: stable (`isDraft=false`, `isPrerelease=false`).
- Tag: `v1.1.0` (release commit `e93d3f3`).

## 2026-02-24T20:38:29+08:00
### Documentation snapshot
- README now highlights the latest architecture change (`v1.1.0` supervisor + portable stage0 runner).
- User manual now includes an explicit supervisor-backed long-run usage path (`6B`) with rollout sequence.

## 2026-02-24T20:38:43+08:00
### Latest commit reference
- `13f99f7` docs: refresh README/manual for supervisor portability design.
- Significance: user-facing docs now explicitly reflect the Phase 1 supervisor + bundled portability architecture and recommended rollout path.
## 2026-02-25T15:37:33+08:00
### Objective
- Ship first-class relay ML automation commands and deterministic post-run learning artifacts.

### Current state
- `/exp` command family implemented in relay runtime:
  - `/exp run` -> template render + `vr_run.sh` launch + chained `post_run_pipeline.py`
  - `/exp best` -> registry best-run query
  - `/exp report` -> markdown report generation + excerpt
- New exp tooling available:
  - `tools/exp/classify_failure.py`
  - `tools/exp/post_run_pipeline.py`
  - `tools/exp/report_registry.py`
- Compatibility update: `render_template.py` now accepts `--id` and `--param` aliases.
- Docs/skills/env updated for operator usage and defaults (`RELAY_EXP_*`).

### Validation snapshot
- Tooling acceptance checks passed (render/wrap/validate/classify/append/report).
- Toy run simulations passed for both success and failure post-run pipelines.
- Live relay code synced to `/root/codex-discord-relay`, but in-memory activation is waiting for drained safe restart.

### Runtime activation
- Guarded restart worker active:
  - script: `/tmp/restart_default_retry_exp.sh`
  - log: `/tmp/restart_default_retry_exp.log`

### Next step
- Run one live `/exp run` canary after restart and verify:
  - job watcher updates
  - registry append (`exp/registry.jsonl`)
  - report update (`reports/rolling_report.md` + optional `/exp report` output)
  - experience/reflection artifacts.
