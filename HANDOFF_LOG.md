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
