# Toolkit Handoff Log (append-only)

## 2026-02-19T17:22:45+08:00
### Scope
- Consolidated toolkit-level handoff history.
- Replaced `HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt` with this canonical `HANDOFF_LOG.md`.

### Current project status
- Branch: `main`
- Remote: `origin`
- Relay stack includes:
  - task queue + worktree management
  - plan commands + `/plan queue`
  - agent relay actions (`job_start`/watch/stop)
  - per-task auto-handoff
  - long-task callback packaged skill

### Key recent commits
- `620cabc` context: require recording git commits in handoff and working memory
- `f67c300` context: split handoff append-only vs working-memory snapshot
- `fb4d261` docs/skills: add relay long-task callback workflow
- `537d6cf` relay: fix claude prompt separator and file upload docs
- `6fb82fa` relay: auto-append handoff after each task
- `bb5ea06` relay: agent actions for job start/watch

### Next expected work
- Keep templates, install scripts, and live env defaults consistent when memory/context policy changes.
- Prefer concise handoff entries and compact working-memory updates over repetitive run transcripts.

## 2026-02-19T23:00:02+08:00
### Scope
- Patched watcher callback robustness for relay long-job flows.

### Changes
- `codex-discord-relay/relay.js`:
  - `tickJobWatcher()` no longer depends on `enqueueConversation(...)` for terminal job finalization.
  - When an `exit_code` is present, the relay now finalizes job state and enqueues `thenTask` directly.
- `codex-discord-relay/README.md`:
  - documented that job-finish finalization runs outside the normal conversation queue.

### Why
- In production, a failed watched job could remain stuck as `running` if the same conversation queue was blocked by a long foreground run (e.g., `/plan apply`), preventing callback tasks from being queued.

### Verified outcome
- After relay restart/restore, previously stuck job callback queued follow-up task successfully (`job.then_task.queued`), and task runner resumed.

## 2026-02-20T12:07:24+08:00
### Scope
- Add resilience for intermittent Claude `init`-only exits observed in live relay logs.

### Changes
- Updated `codex-discord-relay/relay.js`:
  - new helper `isTransientClaudeInitError(err)`
  - one-time retry branch (`agent.run.retry_claude_init`) when Claude exits with init-only payload
  - preserves existing stale-session retry path

### Verification
- `node --check codex-discord-relay/relay.js`
- live parity confirmed by sha256 match after syncing to `/root/codex-discord-relay/relay.js`
- targeted local harness validated retry branch activation and successful second attempt.

### Notes
- Repository currently has pre-existing unrelated working-tree changes; no new git commit was created in this step.

## 2026-02-20T15:07:19+08:00
### Scope
- Fix relay file-upload false negatives for relative `[[upload:...]]` markers.

### Root cause
- Relative markers were resolved only against conversation upload dir, not session workdir.
- Agents that generated files in repo/workdir and emitted relative markers hit `Upload missing`.

### Changes
- `codex-discord-relay/relay.js`:
  - added `buildUploadCandidates(rawPath, { sessionWorkdir, conversationDir })`
  - `resolveAndValidateUploads(...)` now tries session workdir first, then conversation dir fallback
  - upload validation call now passes `session.workdir || CONFIG.defaultWorkdir`

### Verification
- `node --check codex-discord-relay/relay.js`
- live parity confirmed (sha256 match with `/root/codex-discord-relay/relay.js`)

### Notes
- No git commit created in this step due pre-existing unrelated working-tree changes.

## 2026-02-21T18:17:32+08:00
### Scope
- Update relay runtime-context message so agents see actual relay-actions availability instead of stale DM-only wording.

### Changes
- :
  -  now renders relay-actions hint with live config:
    - 
    - 
  - replaced static "DM-only by default" phrase in injected context.

### Verification
- 
- synced to live and verified sha256 parity:
  - 
  - 
- relay restart + status:
  - 
  - 

### Outcome
- Agents in guild threads receive accurate callback-capability guidance aligned with current deployment settings.

## 2026-02-21T18:17:51+08:00
### Scope
- Correction entry for malformed toolkit handoff block written at 2026-02-21T18:17:32+08:00.

### Correction
- Previous block lost literal markdown content due shell escaping.
- Actual toolkit change:
  - File changed: codex-discord-relay/relay.js
  - Function: buildRelayRuntimeContext(...)
  - Behavior: relay-actions hint now displays live values for RELAY_AGENT_ACTIONS_ENABLED and RELAY_AGENT_ACTIONS_DM_ONLY.

### Verification
- node --check passed for toolkit and live relay.js
- sha256 parity confirmed between:
  - /root/openclaw-codex-discord-skills-kit/codex-discord-relay/relay.js
  - /root/codex-discord-relay/relay.js
- codex-discord-relay-multictl restart all completed with default and claude running.

## 2026-02-21T19:04:25+08:00
### Scope
- Add read-only slash-command fast-path so status commands remain responsive while queue is busy.

### Changes
- File: `codex-discord-relay/relay.js`
- Added:
  - `commandHead(command)` helper
  - `shouldBypassConversationQueue(command)` helper
- Dispatch update:
  - read-only/status commands now call `handleCommand(...)` directly instead of `enqueueConversation(...)`.
- `handleCommand("status")` now includes queue state line.

### Verification
- `node --check /root/openclaw-codex-discord-skills-kit/codex-discord-relay/relay.js`
- synced to live `/root/codex-discord-relay/relay.js`
- `node --check /root/codex-discord-relay/relay.js`
- `codex-discord-relay-multictl restart all`
- `codex-discord-relay-multictl status all` shows both instances running.

### Outcome
- `/task list` and other read-only status commands are now immediately responsive under queue load.

## 2026-02-21T21:03:24+08:00
### Scope
- Improve relay long-job observability (task/job descriptions + progress output).
- Fix claude failure-path scope bug causing `activeClaudeModel is not defined` after upstream run errors/timeouts.

### Changes
- `codex-discord-relay/relay.js`:
  - fixed catch-path model label scope by hoisting `activeClaudeModel` / `usedClaudeFallback`.
  - action schema supports optional labels:
    - `job_start.description`
    - `watch.thenTaskDescription`
    - `task_add.description`
  - persisted/normalized metadata for jobs/tasks (`description`, `sourceJobId`).
  - watcher/task-runner progress messages now include labels and task queue counters.
  - `/status` includes task summary + active running job summary.
  - `/task list` includes description/source/prompt preview.
- `codex-discord-relay/README.md`:
  - updated relay-action examples/docs for new optional labels.

### Verification
- `node --check /root/openclaw-codex-discord-skills-kit/codex-discord-relay/relay.js`
- synced to live runtime and verified:
  - `node --check /root/codex-discord-relay/relay.js`
  - `/usr/local/bin/codex-discord-relay-multictl restart all`
  - `/usr/local/bin/codex-discord-relay-multictl status all`

### Outcome
- Long-run workflows are easier to track without slash-command polling.
- Claude timeout/error paths now preserve original failure detail without secondary scope crashes.

## 2026-02-21T21:30:35+08:00
### Scope
- Add resilience for transient Codex failures potentially caused by intermittent proxy/VPN/API instability.
- Add a repeatable probe script to test Codex-vs-Claude failure correlation with network health.

### Changes
- `codex-discord-relay/relay.js`
  - added config toggles:
    - `RELAY_CODEX_TRANSIENT_RETRY_ENABLED` (default true)
    - `RELAY_CODEX_TRANSIENT_RETRY_MAX` (default 1, cap 0..3)
  - added Codex transient error classifier and retry path:
    - helper `isTransientCodexRuntimeError(...)`
    - event `agent.run.retry_codex_transient`
  - run status summaries now include transient-retry signal and transient-hint on failures.
- `codex-discord-relay/README.md`
  - documented new Codex transient retry env vars and troubleshooting guidance.
- new script `codex-discord-relay/scripts/vpn_hypothesis_probe.sh`
  - collects cycle-level network probes + Codex/Claude mini-run outcomes into JSONL
  - writes markdown summary for quick comparison
  - maintains `vpn-probe-latest` symlink for callback analysis.

### Verification
- `node --check /root/openclaw-codex-discord-skills-kit/codex-discord-relay/relay.js`
- toolkit/live relay.js sha256 parity confirmed after sync.
- probe smoke run succeeded:
  - `/tmp/vpn-probe-smoke2-36102/vpn-probe-20260221-212949/summary.md`

### Outcome
- Relay now has built-in mitigation for transient Codex failures and a concrete experiment harness to validate VPN/proxy causality.

## 2026-02-22T12:56:15+08:00
### Scope
- Review GPT Pro "P0 publish-blocker" handoff and apply publishability fixes that are still relevant on current repo state.

### Findings
- Core shebang/newline breakage described in the handoff is already fixed in current files:
  - `bootstrap.sh` has correct bash header
  - `codex-discord-relay/relay.js` has clean node shebang and `"use strict"` on line 2
  - shell scripts are multi-line and parseable
- Remaining publishability gaps:
  - no GitHub Actions CI workflow present
  - `scripts/lint_repo.sh` did not enforce full publish invariants (shebang hygiene + CRLF + broader shell-file scope)
  - `bootstrap.sh --help` and `scripts/apply_local_state.sh --help` still required root due early `require_root`.

### Actions
- Rewrote `scripts/lint_repo.sh` to enforce:
  - `node --check codex-discord-relay/relay.js`
  - `bash -n bootstrap.sh`
  - `bash -n` for all repo `*.sh` files
  - optional `shellcheck` for same shell-file set when installed
  - packaged skills frontmatter checks (`name`, `description`) for `packaged-skills/codex/*/SKILL.md`
  - bash shebang + strict-mode line checks
  - node shebang hygiene for shebang-bearing `.js`
  - CRLF detection for all `.sh` and `.js`
- Updated argument-handling ergonomics to allow non-root help:
  - moved `require_root` after arg parsing in `bootstrap.sh`
  - moved `require_root` after arg parsing/validation in `scripts/apply_local_state.sh`
- Added minimal CI workflow:
  - `.github/workflows/ci.yml`
  - runs on `push` and `pull_request`
  - installs shellcheck and executes `bash scripts/lint_repo.sh`
- Added README dev/CI publishability notes in `README.md` (lint command + script hygiene invariants).

### Verification
- `bash /root/openclaw-codex-discord-skills-kit/scripts/lint_repo.sh` (pass)
- `cd /root/openclaw-codex-discord-skills-kit && ./bootstrap.sh --help` (pass, non-root)
- `cd /root/openclaw-codex-discord-skills-kit && ./scripts/install_packaged_skills.sh --list` (pass)
- `cd /root/openclaw-codex-discord-skills-kit && ./scripts/verify_install.sh || true` (pass with warning: `openclaw not installed`)
- `node --check /root/openclaw-codex-discord-skills-kit/codex-discord-relay/relay.js` (pass)

### Outcome
- Repo now has CI-backed lint enforcement for script/runability invariants and improved non-root CLI ergonomics for help paths.
- P0 publishability checklist items from the handoff are implemented or confirmed already satisfied on current codebase.

### Run/log paths
- `/root/openclaw-codex-discord-skills-kit/scripts/lint_repo.sh`
- `/root/openclaw-codex-discord-skills-kit/.github/workflows/ci.yml`
- `/root/openclaw-codex-discord-skills-kit/bootstrap.sh`
- `/root/openclaw-codex-discord-skills-kit/scripts/apply_local_state.sh`
- `/root/openclaw-codex-discord-skills-kit/README.md`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T13:21:17+08:00
### Scope
- Attempt to publish new commits/tag to GitHub after release preparation.

### Findings
- Push to new remote failed because target repo does not yet exist:
  - `https://github.com/MachengShen/VibeResearch_toolkit.git` -> `Repository not found`
- Fallback push to current repo URL failed due token scope restrictions:
  - remote rejected updates with
    - `refusing to allow an OAuth App to create or update workflow .github/workflows/ci.yml without workflow scope`

### Actions
- Verified legacy repo still resolves via `git ls-remote`.
- Attempted branch and tag push directly to legacy URL:
  - branch `publish-no-workflow`
  - tag `v1.0.0`
- Both rejected due missing `workflow` scope on current auth.

### Outcome
- Release commits/tag exist locally only:
  - `3ee9208`
  - `87bba87`
  - `v1.0.0`
- Remote publication is blocked until either:
  - GitHub repo rename to `VibeResearch_toolkit` is completed, and
  - push auth uses a token with `workflow` scope (or workflow file commit is excluded).

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T13:20:01+08:00
### Scope
- Complete follow-up: local directory rename, bootstrap refresh, clean commit split, and first stable release marker.

### Actions
- Renamed local toolkit directory:
  - `/root/openclaw-codex-discord-skills-kit` -> `/root/VibeResearch_toolkit`
- Ran bootstrap refresh from new path with global context overwrite:
  - `cd /root/VibeResearch_toolkit && ./bootstrap.sh --global-context-overwrite`
- Created stable-release artifacts:
  - `VERSION` (`1.0.0`)
  - `CHANGELOG.md`
  - README/User Manual release references
- Created clean commit split:
  - `3ee9208 docs: rebrand toolkit and publish v1.0.0 manuals`
    - scope: README + manuals + release docs
  - `87bba87 chore: harden runtime defaults and path compatibility`
    - scope: CI/lint, bootstrap/runtime defaults, template/path compatibility
- Created release tag:
  - `v1.0.0` -> `87bba87`

### Findings
- Bootstrap refresh completed and reinstalled relay/skills/global-context templates using new path defaults.
- OpenClaw optional npm install still fails in this environment due native module build constraints under Node 24 (`@discordjs/opus` compile/toolchain incompatibility), but relay/toolkit verification remains passing.

### Verification
- `cd /root/VibeResearch_toolkit && bash scripts/lint_repo.sh` (pass)
- `cd /root/VibeResearch_toolkit && ./bootstrap.sh --help` (pass)
- `cd /root/VibeResearch_toolkit && ./scripts/install_packaged_skills.sh --list` (pass)
- `cd /root/VibeResearch_toolkit && ./scripts/verify_install.sh || true` (pass with warning: openclaw not installed)
- `node --check /root/VibeResearch_toolkit/codex-discord-relay/relay.js` (pass)
- `git remote -v` (origin points to `https://github.com/MachengShen/VibeResearch_toolkit.git`)
- `/etc/cron.d/openclaw-kit-autoupdate` now points `OPENCLAW_KIT_REPO_DIR=/root/VibeResearch_toolkit`

### Run/log paths
- `/root/VibeResearch_toolkit/README.md`
- `/root/VibeResearch_toolkit/docs/USER_MANUAL.md`
- `/root/VibeResearch_toolkit/CHANGELOG.md`
- `/root/VibeResearch_toolkit/VERSION`
- `/root/VibeResearch_toolkit/system/openclaw-kit-autoupdate.sh`
- `/root/VibeResearch_toolkit/.github/workflows/ci.yml`
- `/root/.npm/_logs/2026-02-22T05_17_27_832Z-debug-0.log`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T13:09:26+08:00
### Scope
- Rebrand-facing documentation pass for publishability and researcher onboarding.
- Switch local git remote to planned repository name `VibeResearch_toolkit`.

### Findings
- Existing docs were functional but positioned as infrastructure-centric rather than researcher-centric.
- Path defaults/templates still primarily referenced legacy repo naming.
- User requested stronger emphasis on ML-research design rationale and practical manuals.

### Actions
- Rewrote `README.md` around `VibeResearch_toolkit` positioning:
  - emphasized Discord-first research, interactivity, relay callback workflow, and hypothesis-driven skills
  - added additional ML-focused features (worktrees, continuity memory, observability, reproducibility, proxy resilience)
  - added docs index and migration note.
- Rewrote `docs/USER_MANUAL.md` for operational use by researchers.
- Added new documentation:
  - `docs/ML_RESEARCH_DESIGN.md`
  - `docs/REPO_RENAME_AND_MIGRATION.md`
- Updated naming/path defaults and templates toward `VibeResearch_toolkit` while preserving compatibility fallback logic:
  - `system/openclaw-kit-autoupdate.sh`
  - `system/openclaw-kit-autoupdate.service`
  - `config/setup.env.example`
  - `templates/global-context/AGENTS.md`
  - `templates/global-context/CLAUDE.md`
  - `templates/global-context/relay-context.md`
  - `templates/global-context/AGENT_SYSTEM_OVERVIEW.md`
  - `machine-state/config/codex-discord-relay.env`
  - `docs/WORKING_MEMORY.md` objective text
- Updated local git remote:
  - `git remote set-url origin https://github.com/MachengShen/VibeResearch_toolkit.git`

### Verification
- `cd /root/openclaw-codex-discord-skills-kit && git remote -v` (origin fetch/push now points to `MachengShen/VibeResearch_toolkit.git`)
- `cd /root/openclaw-codex-discord-skills-kit && bash scripts/lint_repo.sh` (pass)

### Outcome
- Toolkit documentation now presents a publishable, ML-research-first narrative and usage model.
- Migration path to `VibeResearch_toolkit` is documented and local remote is aligned with target repo identity.

### Run/log paths
- `/root/openclaw-codex-discord-skills-kit/README.md`
- `/root/openclaw-codex-discord-skills-kit/docs/USER_MANUAL.md`
- `/root/openclaw-codex-discord-skills-kit/docs/ML_RESEARCH_DESIGN.md`
- `/root/openclaw-codex-discord-skills-kit/docs/REPO_RENAME_AND_MIGRATION.md`
- `/root/openclaw-codex-discord-skills-kit/system/openclaw-kit-autoupdate.sh`
- `/root/openclaw-codex-discord-skills-kit/system/openclaw-kit-autoupdate.service`
- `/root/openclaw-codex-discord-skills-kit/templates/global-context/AGENTS.md`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T13:31:41+08:00
### Scope
- Resolve external-review GitHub blockers: missing target repo and workflow-scope push rejection for `.github/workflows/ci.yml`.

### Findings
- Target repo previously returned `Repository not found`.
- Current GitHub auth is user `MachengShen` with scopes: `gist`, `read:org`, `repo` (no `workflow`).
- Push to `publish-no-workflow` and `v1.0.0` is rejected by GitHub without `workflow` scope because history includes `.github/workflows/ci.yml`.

### Actions
- Created target repository:
  - `gh repo create MachengShen/VibeResearch_toolkit --private --disable-issues --disable-wiki ...`
  - Result: `https://github.com/MachengShen/VibeResearch_toolkit`
- Verified remote access state:
  - `git ls-remote https://github.com/MachengShen/VibeResearch_toolkit.git HEAD` (now resolves)
- Re-validated push behavior:
  - `git push origin publish-no-workflow` -> rejected due to missing `workflow` scope
  - `git push origin v1.0.0` -> rejected due to missing `workflow` scope
- Attempted auth upgrade path:
  - `gh auth refresh -h github.com -s workflow`
  - requires interactive device/browser confirmation by account owner.

### Outcome
- Blocker #1 fixed: target GitHub repository exists.
- Blocker #2 remains: credential requires `workflow` scope approval before branch/tag push can succeed.

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`
- `/root/VibeResearch_toolkit/.github/workflows/ci.yml`
- `/root/VibeResearch_toolkit/.git/config`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T13:42:05+08:00
### Scope
- Re-validated post-device-auth GitHub push path for `VibeResearch_toolkit` publication.

### Findings
- `gh auth status -h github.com` still reports scopes: `gist`, `read:org`, `repo` (no `workflow`).
- Real push remains blocked:
  - `git push origin publish-no-workflow`
  - `git push origin v1.0.0`
  both rejected with:
  - `refusing to allow an OAuth App to create or update workflow .github/workflows/ci.yml without workflow scope`.
- `git push --dry-run origin publish-no-workflow` is not sufficient as a permission check (dry-run passes while real push fails).

### Outcome
- Repository availability is fixed; only auth scope escalation (`workflow`) remains before branch/tag publication can complete.

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`
- `/root/VibeResearch_toolkit/.github/workflows/ci.yml`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T13:46:04+08:00
### Scope
- Finalize GitHub publication after workflow-scope auth refresh.

### Findings
- `gh auth status -h github.com` now includes token scope `workflow`.
- Prior blocking rejection on `.github/workflows/ci.yml` is resolved.

### Actions
- Pushed release branch:
  - `git push origin publish-no-workflow`
- Pushed stable tag:
  - `git push origin v1.0.0`

### Outcome
- Remote now has:
  - branch `publish-no-workflow`
  - tag `v1.0.0` (points to commit `87bba87`)
- External review from GitHub can proceed from the new repository.

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`
- `/root/VibeResearch_toolkit/.github/workflows/ci.yml`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T13:54:08+08:00
### Scope
- Execute publication tasks requested by user: open PR `publish-no-workflow -> main` and create GitHub Release from `v1.0.0`.

### Findings
- Repository had only `publish-no-workflow` branch; `main` branch did not exist.
- Default branch was `publish-no-workflow`, so PR target `main` required branch bootstrap.

### Actions
- Created `main` from release-doc commit:
  - `git push origin 3ee920846df88989321d272341f0b3e61e80b216:refs/heads/main`
- Set default branch to `main`:
  - `gh repo edit MachengShen/VibeResearch_toolkit --default-branch main`
- Opened PR:
  - `gh pr create ... --base main --head publish-no-workflow`
  - URL: `https://github.com/MachengShen/VibeResearch_toolkit/pull/1`
- Created release from existing tag:
  - `gh release create v1.0.0 --generate-notes`
  - URL: `https://github.com/MachengShen/VibeResearch_toolkit/releases/tag/v1.0.0`

### Outcome
- Publication workflow is live:
  - `main` is default branch.
  - PR #1 is open (`publish-no-workflow` -> `main`).
  - Release `v1.0.0` is published from commit `87bba87`.

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`
- `/root/VibeResearch_toolkit/.github/workflows/ci.yml`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T13:54:46+08:00
### Scope
- Capture post-publication migration stance evidence for old-name repository.

### Findings
- Old-name repo currently exists and is still public + active (not archived):
  - `https://github.com/MachengShen/openclaw-codex-discord-skills-kit`
  - default branch `main`
  - `isArchived=false`

### Outcome
- New canonical repo is ready (`VibeResearch_toolkit` with PR/release).
- Old repo can be moved to deprecation/archive flow when user confirms final cutover policy.

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T13:57:27+08:00
### Scope
- Execute final migration cutover preference: public `VibeResearch_toolkit`, old-name repository private/archived, and no need for public migration linkage.

### Actions
- Changed repository visibility:
  - `gh repo edit MachengShen/VibeResearch_toolkit --visibility public --accept-visibility-change-consequences`
  - `gh repo edit MachengShen/openclaw-codex-discord-skills-kit --visibility private --accept-visibility-change-consequences`
- Archived old-name repository:
  - `gh repo archive MachengShen/openclaw-codex-discord-skills-kit --yes`

### Verification
- `gh repo view MachengShen/VibeResearch_toolkit --json ...`:
  - `visibility=PUBLIC`, `isPrivate=false`, `isArchived=false`, `defaultBranch=main`
- `gh repo view MachengShen/openclaw-codex-discord-skills-kit --json ...`:
  - `visibility=PRIVATE`, `isPrivate=true`, `isArchived=true`, `defaultBranch=main`
- Existing publication assets remain live:
  - PR: `https://github.com/MachengShen/VibeResearch_toolkit/pull/1` (OPEN)
  - Release: `https://github.com/MachengShen/VibeResearch_toolkit/releases/tag/v1.0.0`

### Outcome
- Active development and public visibility now cleanly centered on `VibeResearch_toolkit`.
- Old-name repository is no longer publicly visible and is archived.

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T13:59:02+08:00
### Scope
- Finalize public-facing migration posture after repository visibility cutover.

### Actions
- Updated GitHub repository visibility/archive state:
  - `VibeResearch_toolkit` -> `PUBLIC`
  - old-name repository -> `PRIVATE` + archived
- Removed public-facing legacy-name references in docs and pushed to PR branch.

### Commit
- `264b3d4` `docs: remove public legacy-repo references`
  - scope: `README.md`, `docs/USER_MANUAL.md`, removal of `docs/REPO_RENAME_AND_MIGRATION.md`
  - pushed to: `origin/publish-no-workflow`

### Verification
- `gh repo view MachengShen/VibeResearch_toolkit --json ...` => public, non-archived, default branch `main`
- `gh repo view MachengShen/openclaw-codex-discord-skills-kit --json ...` => private, archived
- `gh pr view 1 -R MachengShen/VibeResearch_toolkit --json ...` => open
- `bash scripts/lint_repo.sh` => pass

### Outcome
- Public repo no longer carries explicit migration-link documentation to the old-name repository.
- Development remains centered on `VibeResearch_toolkit` with PR #1 updated.

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`
- `/root/VibeResearch_toolkit/README.md`
- `/root/VibeResearch_toolkit/docs/USER_MANUAL.md`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T15:22:12+08:00
### Scope
- Reviewed external hardening report and applied verified remaining publishability fixes on `publish-no-workflow`.

### Findings
- Report items about shebang corruption, relay.js shebang, malformed lint script, missing CI, and one-line frontmatter were already fixed in current branch state.
- Confirmed remaining real blockers:
  - missing `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`
  - permissive public defaults in `config/setup.env.example` for upload + approval/sandbox
  - README missing relay-only install path and troubleshooting section
  - skill frontmatter version key not enforced/standardized

### Actions
- Added governance/security docs:
  - `LICENSE` (MIT)
  - `CONTRIBUTING.md`
  - `SECURITY.md`
- Hardened public defaults in `config/setup.env.example`:
  - `RELAY_UPLOAD_ALLOW_OUTSIDE_CONVERSATION=false`
  - `RELAY_UPLOAD_ALLOWED_ROOTS=/tmp`
  - `CODEX_SANDBOX=workspace-write`
  - `CODEX_APPROVAL_POLICY=on-request` (+ alias)
- Updated `README.md`:
  - added Track A relay-only install (no root)
  - added Track B full bootstrap install
  - added Troubleshooting (required env vars/logs/Discord permissions)
- Strengthened lint gate:
  - `scripts/lint_repo.sh` now requires packaged skill YAML `version`
- Normalized packaged skill metadata:
  - added `version: 1.0` to skill frontmatter files missing version
- Updated changelog for unreleased hardening entry.

### Commit
- `9c1ea19` `chore: harden release defaults and publishability checks`
  - scope: README/config/lint/packaged-skills/governance docs/changelog
  - branch: `publish-no-workflow`
  - pushed to origin

### Verification
- `bash scripts/lint_repo.sh` (pass)
- `bash -n bootstrap.sh` (pass)
- `find . -name "*.sh" -print0 | xargs -0 -n 1 bash -n` (pass)
- `node --check codex-discord-relay/relay.js` (pass)
- shebang trailing-code scans:
  - `rg '^#!/usr/bin/env bash .+' -g '*.sh' .` => no matches
  - `rg '^#!/usr/bin/env node .+' -g '*.js' .` => no matches

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`
- `/root/VibeResearch_toolkit/README.md`
- `/root/VibeResearch_toolkit/config/setup.env.example`
- `/root/VibeResearch_toolkit/scripts/lint_repo.sh`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T15:35:50+08:00
### Scope
- User approved completion of release flow: unblock PR CI, merge `publish-no-workflow` into `main`, and publish GitHub release `v1.0.1`.

### Findings
- PR #1 was mergeable but failing CI due ShellCheck warnings in maintenance scripts.
- Failures were non-functional style/safety issues (`SC2012`, `SC2015`, `SC2155`, `SC1090`, `SC2086`) across shared/ensure scripts.

### Actions
- Patched scripts to satisfy CI ShellCheck gate without loosening lint policy:
  - `scripts/common.sh`
  - `scripts/sync_local_skills_to_packaged.sh`
  - `system/codex-discord-relay-ensure-multi.sh`
  - `system/codex-discord-relay-ensure.sh`
  - `system/openclaw-gateway-ensure.sh`
- Local verification:
  - `bash scripts/lint_repo.sh` (pass)
- Created and pushed commit:
  - `f95fb03` `fix: address shellcheck findings in maintenance scripts`
- Verified PR checks green and merged PR #1:
  - merge commit: `cd0000eaa22837c78175bd8f8197e1fbb94c854f`
  - PR: `https://github.com/MachengShen/vibe-research-toolkit/pull/1`
- Created GitHub release from `main`:
  - tag/release: `v1.0.1`
  - URL: `https://github.com/MachengShen/vibe-research-toolkit/releases/tag/v1.0.1`

### Outcome
- `main` now includes all release-hardening work plus CI fixes.
- Release `v1.0.1` is published and non-draft.

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`
- `/root/VibeResearch_toolkit/scripts/lint_repo.sh`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T15:40:59+08:00
### Scope
- User reported public docs still using old repository naming (`VibeResearch_toolkit`) after repository rename to `vibe-research-toolkit`.

### Actions
- Updated public-facing markdown docs to normalized lowercase canonical naming:
  - `README.md`
  - `CONTRIBUTING.md`
  - `docs/USER_MANUAL.md`
  - `docs/ML_RESEARCH_DESIGN.md`
  - `CHANGELOG.md`
  - `templates/global-context/AGENTS.md`
  - `templates/global-context/CLAUDE.md`
  - `templates/global-context/AGENT_SYSTEM_OVERVIEW.md`
  - `templates/global-context/relay-context.md`
- Updated clone examples and paths where applicable:
  - `https://github.com/MachengShen/vibe-research-toolkit.git`
  - `cd vibe-research-toolkit`
- Bumped docs stable-release references to `v1.0.1` where present.

### Commit
- `c8f0361` `docs: normalize repo naming to vibe-research-toolkit`
  - branch: `publish-no-workflow`
  - pushed to origin

### Verification
- `bash scripts/lint_repo.sh` (pass)
- `rg -n "VibeResearch_toolkit|MachengShen/VibeResearch_toolkit" --glob '*.md' --glob '!HANDOFF_LOG.md'` (no matches)

### Publish
- Opened and merged PR #2:
  - `https://github.com/MachengShen/vibe-research-toolkit/pull/2`
  - merge commit: `32788e58994fbbbd182b42f8e513fe77a2c47e53`
- Verified `origin/main` README now shows lowercase canonical naming and clone URL.

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`
- `/root/VibeResearch_toolkit/README.md`
- `/root/VibeResearch_toolkit/CONTRIBUTING.md`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T19:50:42+08:00
### Scope
- Start implementation of P2 ML automation package from GPT-Pro handoff (Layer 1 + minimal Layer 2) in `vibe-research-toolkit`.

### Repo state
- Path: /root/VibeResearch_toolkit
- Branch: p2-ml-automation
- Base: origin/main
- Commit at start: 32788e58994fbbbd182b42f8e513fe77a2c47e53

### Objective
- Add deterministic run wrapper, metrics schema/validator, registry append + run summary tools, experiment templates, relay skill guidance update, and USER_MANUAL automation section.

## 2026-02-22T19:57:24+08:00
### Scope
- Implemented GPT-Pro P2 ML automation package (Layer 1 + minimal Layer 2) for structured experiment runs.

### Actions
- Added deterministic run wrapper:
  - `scripts/vr_run.sh`
  - standardizes `meta.json`, `train.log`, `metrics.json`, `artifacts/`
  - auto-generates schema-compliant fallback `metrics.json` on failures
- Added metrics contract + tooling:
  - `tools/exp/metrics_schema.json`
  - `tools/exp/validate_metrics.py`
  - `tools/exp/append_registry.py` (duplicate run_id reject by default)
  - `tools/exp/summarize_run.py`
- Added template set:
  - `templates/experiments/train_baseline.yaml`
  - `templates/experiments/ablation_lr.yaml`
  - `templates/experiments/eval_only.yaml`
- Updated relay long-task skill guidance for ML research runs:
  - `packaged-skills/codex/relay-long-task-callback/SKILL.md`
  - added Research Run Profile and post-run thenTask sequence
- Updated user docs:
  - `docs/USER_MANUAL.md`
  - added ML automation section with run wrapper, registry, and commands

### Commit
- `64dc6dc` `feat: add ML experiment run contract automation tools`
  - branch: `p2-ml-automation`

### Verification
- `bash scripts/lint_repo.sh` (pass)
- Acceptance Test A equivalent:
  - `scripts/vr_run.sh --run-id rtest-... --run-dir /tmp/vrtest/rtest-... -- bash -lc 'echo hello; exit 0'`
  - produced `meta.json`, `train.log`, `metrics.json`
  - `python3 tools/exp/validate_metrics.py <run_dir>/metrics.json` (pass)
- Acceptance Test B equivalent:
  - `python3 tools/exp/append_registry.py --registry /tmp/vrtest/registry.jsonl --run-dir <run_dir>` (append pass)
  - duplicate check verified fail-closed on same run_id
- Summarizer smoke:
  - `python3 tools/exp/summarize_run.py --run-dir <run_dir> --out-md /tmp/vrtest/summary.md --append` (pass)
- Failure-path check:
  - wrapper run with non-zero command exit writes valid metrics with `status=failed` and non-empty `error`.

### Outcome
- P2 automation now has deterministic run packaging + contract validation + registry + summary artifacts, and documented relay usage profile.
- Optional `/exp run` and `/exp sweep` commands were not added in this pass.

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`
- `/tmp/vrtest/registry.jsonl`
- `/tmp/vrtest/summary.md`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T19:59:24+08:00
### Scope
- Finalized publication of P2 ML automation package by merging PR #3 into `main`.

### Merge
- PR: `https://github.com/MachengShen/vibe-research-toolkit/pull/3`
- State: `MERGED`
- Merged at: `2026-02-22T11:59:14Z`
- Merge commit: `b624dfbe8cbc50494da011bb225bbd3f281bb58c`

### Outcome
- `origin/main` now includes:
  - deterministic run wrapper (`scripts/vr_run.sh`)
  - metrics schema/validator/registry/summarizer tools (`tools/exp/*`)
  - experiment templates (`templates/experiments/*`)
  - relay skill guidance update for research runs
  - USER_MANUAL ML automation section

### Run/log paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-22T22:12:15+08:00
### Scope
- Implemented `CODEX_FINAL_PIPELINE_AND_ML_ROBUSTNESS_PLAN_v2` in toolkit runtime + ML tooling (watch contract v2, preflight guards, visibility gate, signal-safe run contract, registry/template/best-run tools).

### Runtime actions (`codex-discord-relay/relay.js`)
- Added feature-flag config parsing:
  - `RELAY_WATCH_REQUIRE_FILES_ENABLED`
  - `RELAY_WATCH_REQUIRE_FILES_DEFAULT_TIMEOUT_SEC`
  - `RELAY_WATCH_REQUIRE_FILES_DEFAULT_POLL_SEC`
  - `RELAY_JOB_PREFLIGHT_ENABLED`
  - `RELAY_WAIT_PATTERN_GUARD_MODE`
  - `RELAY_VISIBILITY_GATE_ENABLED`
  - `RELAY_VISIBILITY_STARTUP_HEARTBEAT_SEC`
  - `RELAY_VISIBILITY_HEARTBEAT_EVERY_SEC`
- Extended relay watch schema and normalization with:
  - `requireFiles`, `readyTimeoutSec`, `readyPollSec`, `onMissing`, `long`, `firstPostRegex`.
- Added `job_start.preflight` schema support:
  - checks: `path_exists`, `cmd_exit_zero`, `min_free_disk_gb`
  - `onFail: reject|warn`.
- Implemented wait-pattern guard (`pgrep -f` self-match risk) with `off|warn|reject` mode.
- Added persisted lifecycle transition tracking per job:
  - states include `queued`, `running`, `exited`, `awaiting_artifacts`, `callback_queued`, `callback_running`, `completed`, `blocked`, `failed`.
  - stored with timestamp/reason/details under `job.lifecycle*` fields.
- Implemented fail-closed artifact gating on watcher finalization:
  - successful exit + required files => wait/poll until ready or timeout.
  - telemetry events:
    - `job.await_artifacts.start`
    - `job.await_artifacts.ready`
    - `job.await_artifacts.timeout`
    - `job.await_artifacts.error`
- Added heuristic defaults for `scripts/vr_run.sh` launches:
  - if `thenTask` exists and `requireFiles` not supplied, auto-infer `<run_dir>/metrics.json`, `<run_dir>/meta.json`, `<run_dir>/train.log`.
- Added visibility SLO/degradation behavior for long watchers (non-blocking):
  - startup heartbeat + periodic heartbeat state
  - `visibilityStatus` exposed in watcher/status output.

### Docs/env actions
- Updated:
  - `/root/VibeResearch_toolkit/codex-discord-relay/.env.example`
  - `/root/VibeResearch_toolkit/codex-discord-relay/README.md`
- Added watch-contract v2, preflight, visibility, and registry-lock env/docs.

### ML tooling actions
- Reworked `/root/VibeResearch_toolkit/scripts/vr_run.sh`:
  - signal-safe finalization with `EXIT`/`TERM`/`INT` traps.
  - guarantees `meta.json` + schema-valid `metrics.json` on success/failure/cancel.
  - writes run status + `exit_code` + `signal` into metrics/meta.
  - fallback minimal metrics writer if validation initially fails.
- Hardened `/root/VibeResearch_toolkit/tools/exp/append_registry.py`:
  - lock-based append via `fcntl.flock` using `<registry>.lock`.
  - env-controlled lock default: `RELAY_REGISTRY_LOCK_ENABLED=true`.
  - deterministic duplicate handling retained (`--allow-duplicate` optional).
  - stores numeric `metrics` map in registry rows for metric-specific selection.
- Hardened `/root/VibeResearch_toolkit/tools/exp/summarize_run.py`:
  - added optional `--registry`; no fixed run-dir parent assumptions.
- Added new tooling:
  - `/root/VibeResearch_toolkit/tools/exp/render_template.py`
  - `/root/VibeResearch_toolkit/tools/exp/best_run.py`

### Skill integration
- Updated packaged callback skill profile:
  - `/root/VibeResearch_toolkit/packaged-skills/codex/relay-long-task-callback/SKILL.md`
  - now explicitly requires `watch.requireFiles`, timeout/onMissing, and `preflight` examples.

### Verification
- Runtime syntax:
  - `node --check /root/VibeResearch_toolkit/codex-discord-relay/relay.js` (pass)
- Shell/python syntax:
  - `bash -n /root/VibeResearch_toolkit/scripts/vr_run.sh` (pass)
  - `python3 -m py_compile /root/VibeResearch_toolkit/tools/exp/{append_registry.py,summarize_run.py,render_template.py,best_run.py,validate_metrics.py}` (pass)
- Smoke tests (all pass):
  - `render_template.py` render sanity
  - `vr_run.sh` success/failure/cancel contracts + schema validation
  - `append_registry.py` duplicate fail-closed behavior
  - `best_run.py` selection from registry

### Runtime sync (no restart)
- Synced toolkit runtime artifacts into live runtime mirror:
  - `/root/codex-discord-relay/relay.js`
  - `/root/codex-discord-relay/README.md`
  - `/root/codex-discord-relay/.env.example`
- Synced active callback skill text from packaged source:
  - `/root/.agents/skills/relay-long-task-callback/SKILL.md`
  - `/root/.codex/skills/relay-long-task-callback/SKILL.md`

### Runtime note
- No relay process restart was performed in this pass to avoid interrupting active experiments/jobs.

### Evidence paths
- `/root/VibeResearch_toolkit/codex-discord-relay/relay.js`
- `/root/VibeResearch_toolkit/codex-discord-relay/.env.example`
- `/root/VibeResearch_toolkit/codex-discord-relay/README.md`
- `/root/VibeResearch_toolkit/scripts/vr_run.sh`
- `/root/VibeResearch_toolkit/tools/exp/append_registry.py`
- `/root/VibeResearch_toolkit/tools/exp/summarize_run.py`
- `/root/VibeResearch_toolkit/tools/exp/render_template.py`
- `/root/VibeResearch_toolkit/tools/exp/best_run.py`
- `/root/VibeResearch_toolkit/packaged-skills/codex/relay-long-task-callback/SKILL.md`
- `/root/codex-discord-relay/relay.js`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-23T11:41:38+08:00
### Scope
- User requested uploading the completed pipeline+ML robustness v2 implementation to remote and generating a brief GBDPro review report.

### Actions
- Added review brief:
  - `/root/VibeResearch_toolkit/GBDPRO_REVIEW_BRIEF_2026-02-23.md`
- Committed and pushed implementation bundle to upstream branch:
  - commit: `de0e1b3`
  - branch: `p2-ml-automation`
  - remote: `origin` (`MachengShen/vibe-research-toolkit`)
- Commit includes runtime/tooling/docs/skill updates from the v2 robustness implementation.

### Evidence paths
- `/root/VibeResearch_toolkit/GBDPRO_REVIEW_BRIEF_2026-02-23.md`
- `/root/VibeResearch_toolkit/codex-discord-relay/relay.js`
- `/root/VibeResearch_toolkit/scripts/vr_run.sh`
- `/root/VibeResearch_toolkit/tools/exp/render_template.py`
- `/root/VibeResearch_toolkit/tools/exp/best_run.py`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-23T11:44:44+08:00
### Scope
- User requested a PR-style GBDPro handoff summary that includes risk checklist, canary flag settings, and embedded branch/commit references so only the report file is needed for review handoff.

### Actions
- Rewrote report into PR-style review format with:
  - implementation intent and area-by-area change summary
  - risk checklist (completed + pending rollout items)
  - canary flag settings table with recommended values
  - reviewer question set for GBDPro
  - explicit branch and commit inventory
- Updated file:
  - `/root/VibeResearch_toolkit/GBDPRO_REVIEW_BRIEF_2026-02-23.md`
- Commit created:
  - `7e881f0` — `docs: expand GBDPro brief with PR-style risk and canary checklist`

### Evidence paths
- `/root/VibeResearch_toolkit/GBDPRO_REVIEW_BRIEF_2026-02-23.md`
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-23T13:33:43+08:00
### Scope
- Review GBDPro feedback highlighting missing essential execution checks and produce a concrete remediation plan.

### Actions
- Reviewed attachment:
  - `/root/.codex-discord-relay/instances/claude/uploads/discord_1472061022239195304_thread_1472525033799942216/attachments/1771824690075_c421f14e_CODEX_PR_CHECKLIST_AND_ROBUSTNESS_EXEC_SUITE.md`
- Assessed current state:
  - CI currently runs lint-only in `.github/workflows/ci.yml`
  - no dedicated essential execution gate script exists
- Authored implementation plan:
  - `/root/VibeResearch_toolkit/docs/plans/2026-02-23-essential-execution-check-gate.md`
  - plan introduces required PR execution gate + extended robustness suite + canary/manual runtime checks.

### Evidence paths
- `/root/VibeResearch_toolkit/.github/workflows/ci.yml`
- `/root/VibeResearch_toolkit/scripts/lint_repo.sh`
- `/root/VibeResearch_toolkit/docs/plans/2026-02-23-essential-execution-check-gate.md`

### Runtime note
- No runtime code/config changes were applied in this step.

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-23T13:48:08+08:00
### Scope
- User approved implementation of Tasks 1-4 from `docs/plans/2026-02-23-essential-execution-check-gate.md` to close the missing essential execution check concern.

### Actions
- Implemented required execution gate script:
  - `/root/VibeResearch_toolkit/scripts/essential_exec_check.sh`
- Implemented extended robustness suite runner + toy testbed:
  - `/root/VibeResearch_toolkit/scripts/robustness_exec_suite.sh`
  - `/root/VibeResearch_toolkit/tools/testbed/toy_train.py`
- Added execution contract and runbook docs:
  - `/root/VibeResearch_toolkit/docs/verification/EXECUTION_CHECK_CONTRACT.md`
  - `/root/VibeResearch_toolkit/docs/runbooks/ROBUSTNESS_EXEC_SUITE.md`
- Updated CI enforcement:
  - `/root/VibeResearch_toolkit/.github/workflows/ci.yml`
  - added required `essential-exec` job with artifact upload
  - added relay dependency install (`npm ci --prefix codex-discord-relay`) for runtime smoke fidelity
- Added nightly/manual robustness workflow:
  - `/root/VibeResearch_toolkit/.github/workflows/robustness-nightly.yml`
- Updated docs and repo hygiene:
  - `/root/VibeResearch_toolkit/README.md`
  - `/root/VibeResearch_toolkit/.gitignore` (ignore `reports/`)

### Verification
- `bash scripts/lint_repo.sh` (pass)
- `bash scripts/essential_exec_check.sh` (pass)
  - report: `reports/essential_exec/20260223-134709`
- `bash scripts/robustness_exec_suite.sh` (pass)
  - report: `reports/robustness_suite/2026-02-23`

### Commit
- `54daa36` — `ci: add essential execution gate and robustness suite`

### Runtime note
- No live relay restart was performed in this task.

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-23T14:00:48+0800
### Scope
- Complete the remaining GBDPro execution-check proposal items beyond MVP Tasks 1-4 (reviewer UX + machine-readable gate hardening + rollout/DoD documentation).

### Actions
- Added PR reviewer UX assets:
  - `.github/pull_request_template.md`
  - `docs/verification/PR_REVIEW_CHECKLIST.md`
  - updated `CONTRIBUTING.md` with mandatory execution evidence and manual runtime-check expectations.
- Added machine-readable summary quality gate:
  - `tools/verification/check_summary.py` (schema + consistency validation, top failing/warning checks output).
  - wired into `scripts/essential_exec_check.sh` and `scripts/robustness_exec_suite.sh`.
  - both suite summaries now carry per-test `evidence_path`.
- Strengthened suite logs and final-report format:
  - per-test `started_at`/`ended_at` timestamps in both scripts.
  - robustness suite now auto-appends D-section summary (overall, failed tests, top 3 fixes, report-vs-reality note).
- CI/workflow enforcement updates:
  - `.github/workflows/ci.yml` now validates essential summary schema after gate run.
  - `.github/workflows/robustness-nightly.yml` now validates robustness summary schema.
- Documentation updates:
  - `README.md`
  - `docs/runbooks/ROBUSTNESS_EXEC_SUITE.md`
  - `docs/verification/EXECUTION_CHECK_CONTRACT.md` (adds rollout phases + Definition of Done).

### Verification
- `bash scripts/lint_repo.sh` (pass)
- `bash scripts/essential_exec_check.sh` (pass)
  - report: `reports/essential_exec/20260223-135934`
- `bash scripts/robustness_exec_suite.sh` (pass)
  - report: `reports/robustness_suite/2026-02-23`

### Commit
- `fb901f1` — `ci: complete execution-check gate with reviewer template and summary validation`

### Runtime note
- No relay restart performed in this task.

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-23T17:16:34+0800
### Scope
- Sync toolkit with new relay monitoring optimization defaults and collaboration-skill packaging/docs requirements.

### Actions
- Synced relay runtime/docs/env from live runtime to toolkit:
  - 
  - 
  - 
- Updated callback skill defaults in packaged skill:
  - 
- Mirrored newly created collaboration skills into packaged distribution:
  - 
  - 
  - 
  - 
  - 
  - 
- Updated packaged manifest:
  - 
- Added mandatory skill map in workflow docs:
  - 
  - 

### Verification
- [lint] node --check codex-discord-relay/relay.js
[lint] bash -n bootstrap.sh
[lint] bash -n bootstrap.sh
[lint] bash -n codex-discord-relay/scripts/vpn_hypothesis_probe.sh
[lint] bash -n packaged-skills/codex/codex-discord-relay-stuck-check/scripts/stuck_check.sh
[lint] bash -n packaged-skills/codex/periodic-mechanistic-service/scripts/install_periodic_systemd_timer.sh
[lint] bash -n scripts/apply_local_state.sh
[lint] bash -n scripts/common.sh
[lint] bash -n scripts/configure_openclaw_discord.sh
[lint] bash -n scripts/essential_exec_check.sh
[lint] bash -n scripts/export_local_state.sh
[lint] bash -n scripts/gpu_gate.sh
[lint] bash -n scripts/healthcheck.sh
[lint] bash -n scripts/init_repo_memory.sh
[lint] bash -n scripts/install_codex_discord_relay.sh
[lint] bash -n scripts/install_cron.sh
[lint] bash -n scripts/install_local_state_sync_cron.sh
[lint] bash -n scripts/install_openclaw.sh
[lint] bash -n scripts/install_openclaw_gateway_watchdog.sh
[lint] bash -n scripts/install_openclaw_kit_autoupdate.sh
[lint] bash -n scripts/install_packaged_skills.sh
[lint] bash -n scripts/lint_repo.sh
[lint] bash -n scripts/robustness_exec_suite.sh
[lint] bash -n scripts/setup_proxy_env.sh
[lint] bash -n scripts/sync_local_skills_to_packaged.sh
[lint] bash -n scripts/sync_local_state_to_repo.sh
[lint] bash -n scripts/verify_install.sh
[lint] bash -n scripts/vr_run.sh
[lint] bash -n system/codex-discord-relay-ensure-multi.sh
[lint] bash -n system/codex-discord-relay-ensure.sh
[lint] bash -n system/openclaw-gateway-ensure.sh
[lint] bash -n system/openclaw-kit-autoupdate.sh
[lint] shellcheck not found; skipping shellcheck checks

[lint] all checks passed (pass)
- relay file parity checks passed vs live runtime copy.
- packaged skill directories present for all six newly mirrored skills.

### Runtime note
- Live default relay was restarted from  after env/runtime sync; toolkit copy remains source-aligned.

### Evidence paths
- 
- 
- 
- 
- 
- 
- 
- 
- 
- 
- 
- 
- 

### Training status
- Inactive (epoch/metrics N/A)

## 2026-02-23T17:38:05+0800
### Mistake
- One append entry used unquoted heredoc syntax, causing markdown backticks to expand.

### Guardrail
- Use single-quoted heredoc delimiters for all log/memory markdown appends.

### Evidence paths
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- `/root/VibeResearch_toolkit/docs/WORKING_MEMORY.md`

## 2026-02-23T22:15:59+0800
### Objective
- Add selective progress-message persistency for Discord relay threads: durable narrative notes, transient command traces.

### Changes
- Relay runtime:
  - added `RELAY_PROGRESS_PERSISTENT_MODE=all|narrative|off`
  - added `RELAY_PROGRESS_PERSISTENT_MIN_CHARS`
  - added `RELAY_PROGRESS_PERSISTENT_MAX_CHARS`
  - narrative mode now suppresses low-signal command/tool progress lines from durable progress posts.
- Docs/env templates updated:
  - `codex-discord-relay/README.md`
  - `codex-discord-relay/.env.example`
  - `config/setup.env.example`
- Synced toolkit relay files to live runtime relay and applied runtime env values on server.

### Verification
- `node --check /root/VibeResearch_toolkit/codex-discord-relay/relay.js` (pass)
- `node --check /root/codex-discord-relay/relay.js` (pass)
- restart + status:
  - `/usr/local/bin/codex-discord-relay-multictl restart all`
  - `/usr/local/bin/codex-discord-relay-multictl status all` (default+claude running)

### Evidence
- `/root/VibeResearch_toolkit/codex-discord-relay/relay.js`
- `/root/VibeResearch_toolkit/codex-discord-relay/README.md`
- `/root/VibeResearch_toolkit/codex-discord-relay/.env.example`
- `/root/VibeResearch_toolkit/config/setup.env.example`
- `/root/.codex-discord-relay.env`
- `/root/.codex-discord-relay/instances.d/claude.env`

## 2026-02-23T22:27:40+0800
### Objective
- Add `narrative+milestones` relay progress persistence mode.

### Changes
- `codex-discord-relay/relay.js`
  - parse mode aliases for `narrative+milestones`
  - added milestone summarizer and persistent-post classification
  - milestone posts bypass interval throttle (dedupe + max-per-run still apply)
- docs/examples:
  - `codex-discord-relay/README.md`
  - `codex-discord-relay/.env.example`
  - `config/setup.env.example`

### Verification
- `node --check codex-discord-relay/relay.js` (pass)
- live/toolkit parity confirmed for relay files.

### Runtime rollout
- live relay env set to `RELAY_PROGRESS_PERSISTENT_MODE=narrative+milestones` for both default and claude instances.

## 2026-02-23T22:36:41+08:00
### Objective
- Mirror open-research contract/playbook canonical docs into toolkit workspace without changing runtime code/env.

### Changes
- Added:
  - `docs/OPEN_RESEARCH_CONTRACT.md`
  - `docs/CLAIM_LEDGER.md`
  - `docs/NEGATIVE_RESULTS.md`
  - `docs/templates/{WORKING_MEMORY,HANDOFF_LOG,CLAIM_LEDGER,NEGATIVE_RESULTS,HYPOTHESIS_CARD,PULL_REQUEST}_TEMPLATE.md`
  - `docs/hypotheses/` directory

### Exact command(s) run
- `cp/install open_research_infra_docs assets -> /root/VibeResearch_toolkit/docs`

### Evidence paths
- `/root/VibeResearch_toolkit/docs/OPEN_RESEARCH_CONTRACT.md`
- `/root/VibeResearch_toolkit/docs/CLAIM_LEDGER.md`
- `/root/VibeResearch_toolkit/docs/NEGATIVE_RESULTS.md`
- `/root/VibeResearch_toolkit/docs/templates/`

### Current run state
- Documentation-only update; no toolkit runtime restart required.

## 2026-02-24T14:32:55+08:00
### Objective
- Implement Phase 1 relay-native supervisor integration in relay runtime with execution validation.

### Changes
- Added feature-gated `job_start.supervisor` contract parsing (`stage0_smoke_gate`) in `codex-discord-relay/relay.js`.
- Added supervisor launch compiler (structured spec -> stage0 command) and watch patch auto-wiring.
- Added finalize-time supervisor state validation (status + cleanup policy checks) before callback enqueue.
- Added env/config knobs and docs:
  - `RELAY_SUPERVISOR_PHASE1_*`
  - `RELAY_MAX_JOB_COMMAND_CHARS`
- Updated files:
  - `codex-discord-relay/relay.js`
  - `codex-discord-relay/README.md`
  - `codex-discord-relay/.env.example`
  - `config/setup.env.example`
- Synced toolkit updates to live relay copy under `/root/codex-discord-relay/`.

### Verification
- `node --check` passed for toolkit/live `relay.js`.
- Runtime canary passed using compiled stage0 supervisor command:
  - `run_id=relay_phase1_canary_1771914624004`
  - state `success`
  - cleanup action `deleted_smoke_run_dir_kept_manifest`.
- Runtime validator checks passed for expected success and mismatch cases.
- Toolkit/live parity checks passed for relay runtime files.

### Evidence
- `/root/VibeResearch_toolkit/codex-discord-relay/relay.js`
- `/root/VibeResearch_toolkit/codex-discord-relay/README.md`
- `/root/VibeResearch_toolkit/codex-discord-relay/.env.example`
- `/root/VibeResearch_toolkit/config/setup.env.example`
- `/root/codex-discord-relay/relay.js`
- `/root/ebm-online-rl-prototype/tmp/relay_phase1_canary_1771914624004/state.json`

### Next steps
1. Enable `RELAY_SUPERVISOR_PHASE1_ENABLED=true` in live env.
2. Perform drained safe restart.
3. Canary one native `job_start.supervisor` action in-thread.

## 2026-02-24T14:33:38+08:00
### Scope
- Activation check for Phase 1 runtime changes.

### Verification
- Safe restart attempt blocked by drain guard (`rc=4`) while active conversation is running.
- Relay remains running (`pid=25917`).

### Next steps
1. Retry safe restart after conversation drains.
2. Run native `job_start.supervisor` canary in Discord thread.

## 2026-02-24T15:49:54+08:00
### Objective
- Clarify cross-repo scope for relay supervisor work, and push the current toolkit snapshot to remote.

### Initial context
- Runtime canary execution used `/root/ebm-online-rl-prototype` because `scripts/stage0_smoke_gate.py` currently lives there.
- Toolkit repo (`/root/VibeResearch_toolkit`) has a large pending diff set across relay/docs/skills packaging and needs consolidation before push.

## 2026-02-24T15:50:45+08:00
### Scope
- Pushed current toolkit snapshot to remote branch and recorded commit linkage.

### Commit record
- `08c9f28` feat(relay): integrate phase1 supervisor flow and sync toolkit runtime assets
- scope: relay runtime/docs/env + toolkit memory/handoff updates + packaged skills/docs template assets.

### Verification
- syntax checks before push:
  - `node --check codex-discord-relay/relay.js`
  - `bash -n system/codex-discord-relay-multictl`
  - `python3 -m py_compile scripts/profile_relay_runs.py`
- push result: `origin/p2-ml-automation` updated `c219494 -> 08c9f28`.

### Evidence paths
- `/root/VibeResearch_toolkit/codex-discord-relay/relay.js`
- `/root/VibeResearch_toolkit/system/codex-discord-relay-multictl`
- `/root/VibeResearch_toolkit/scripts/profile_relay_runs.py`

## 2026-02-24T16:26:47+08:00
### Objective
- Remove implicit dependency on `/root/ebm-online-rl-prototype` for Phase 1 supervisor usage by bundling `stage0_smoke_gate.py` into relay and making default resolution portable.

### Initial context
- Current Phase 1 default script is configured as `scripts/stage0_smoke_gate.py`, while the script currently exists only in EBM repo.
- User requested portability so toolkit package can be deployed without requiring EBM repo layout.

## 2026-02-24T16:30:18+08:00
### Scope
- Removed implicit EBM path dependency for Phase 1 supervisor by bundling stage0 runner into relay repo and updating resolution logic.

### Changes
- Added bundled runner:
  - `codex-discord-relay/scripts/stage0_smoke_gate.py`
- Updated `codex-discord-relay/relay.js`:
  - default supervisor script path now supports relay-bundled fallback
  - script existence check before launch spec success
- Updated docs/examples:
  - `codex-discord-relay/README.md`
  - `codex-discord-relay/.env.example`
  - `config/setup.env.example`
- Synced toolkit->live relay files.

### Verification
- `node --check` passed for toolkit/live `relay.js`.
- `python3 -m py_compile` passed for toolkit/live bundled stage0 script.
- Portability canary passed from `/tmp` using bundled relay script path (no EBM repo required):
  - run dir `/tmp/relay-portable-supervisor-2EgfSo/run`
  - `STATE_STATUS=success`
  - `CLEANUP_ACTION=deleted_smoke_run_dir_kept_manifest`
  - `GATE_ERR_BYTES=0`

### Commit record
- `290ef88` feat(relay): bundle stage0 supervisor runner for portable deployments
- pushed: `origin/p2-ml-automation` (`c7de99b -> 290ef88`)

### Evidence paths
- `/root/VibeResearch_toolkit/codex-discord-relay/relay.js`
- `/root/VibeResearch_toolkit/codex-discord-relay/scripts/stage0_smoke_gate.py`
- `/root/codex-discord-relay/relay.js`
- `/root/codex-discord-relay/scripts/stage0_smoke_gate.py`
## ${ts}
### Objective
- Clear release blocker evidence and ship toolkit version bump to `1.1.0` only after fresh execution-gate verification.

### Changes
- Investigated user-reported `A1.lint` failure context from `scripts/essential_exec_check.sh` and re-ran local gates.
- Confirmed current branch passes required checks; `A1.lint` is green.
- Bumped release metadata to `1.1.0`:
  - `VERSION`
  - `codex-discord-relay/package.json`
  - `codex-discord-relay/package-lock.json`
  - `README.md`
  - `docs/USER_MANUAL.md`
  - `docs/WORKING_MEMORY.md`
  - `CHANGELOG.md`
- Created commit:
  - `e93d3f3` release: bump toolkit to v1.1.0

### Verification
- `bash scripts/lint_repo.sh` -> pass
- `bash scripts/essential_exec_check.sh` -> pass (`required_failed=0`, `warnings=1`)
- Non-required warning only: `A2.relay.help` (missing local `node_modules` help-path skip behavior)

### Evidence
- `reports/essential_exec/release_1_1_0_20260224-201801/suite_log.md`
- `reports/essential_exec/release_1_1_0_20260224-201801/summary.json`
- `/root/VibeResearch_toolkit/codex-discord-relay/package.json`
- `/root/VibeResearch_toolkit/VERSION`

### Exact command(s) run
- `bash scripts/lint_repo.sh`
- `ESSENTIAL_EXEC_REPORT_DIR=reports/essential_exec/release_1_1_0_... bash scripts/essential_exec_check.sh`
- `npm --prefix codex-discord-relay version 1.1.0 --no-git-tag-version`
- `git commit -m "release: bump toolkit to v1.1.0"`

### Next steps
- Tag/push `v1.1.0` once memory-log commit is recorded.
## 2026-02-24T20:19:11+08:00
### Correction
- The immediately previous entry header used literal `${ts}` due quoted-heredoc variable non-expansion.
- This timestamped entry is authoritative for the release-bump record.

### Mistake
- Appended `HANDOFF_LOG.md` with a literal timestamp placeholder (`## ${ts}`) instead of a concrete timestamp.

### Cause
- Used `cat <<'EOF'` with an interpolated variable in the markdown body.

### Guardrail
- When appending logs with quoted heredocs, print dynamic fields (timestamp/run ids) via `printf` before the heredoc body; never place shell vars inside `<<'EOF'` content.

### Evidence
- `/root/VibeResearch_toolkit/HANDOFF_LOG.md`
- command: `cat <<'EOF' >> HANDOFF_LOG.md` with `## ${ts}` body line
## 2026-02-24T20:20:16+08:00
### Scope
- Finalize `1.1.0` release prep after user-reported lint gate failure signal.

### Release hardening status
- `ready`
- Required execution checks pass on current head.
- No release blockers remain.

### Verification
- `bash scripts/lint_repo.sh` -> pass
- `ESSENTIAL_EXEC_REPORT_DIR=reports/essential_exec/release_1_1_0_20260224-201801 bash scripts/essential_exec_check.sh` -> pass
  - summary: `overall=pass required_failed=0 warnings=1`
  - non-required warning: `A2.relay.help`

### Versioning + remote state
- Release commit: `e93d3f3` (`release: bump toolkit to v1.1.0`)
- Metadata commit: `8a93861` (`docs: log v1.1.0 verification and handoff guardrail`)
- Branch pushed: `origin/p2-ml-automation` -> `8a93861`
- Tag created/pushed: `v1.1.0` -> `e93d3f3`

### Evidence
- `/root/VibeResearch_toolkit/reports/essential_exec/release_1_1_0_20260224-201801/summary.json`
- `/root/VibeResearch_toolkit/reports/essential_exec/release_1_1_0_20260224-201801/suite_log.md`
- `/root/VibeResearch_toolkit/VERSION`
- `/root/VibeResearch_toolkit/codex-discord-relay/package.json`

### Exact command(s) run
- `bash scripts/lint_repo.sh`
- `ESSENTIAL_EXEC_REPORT_DIR=reports/essential_exec/release_1_1_0_20260224-201801 bash scripts/essential_exec_check.sh`
- `git tag -a v1.1.0 e93d3f3 -m "v1.1.0"`
- `git push origin p2-ml-automation && git push origin v1.1.0`

### Next steps
- Optional: publish GitHub Release notes from tag `v1.1.0`.
