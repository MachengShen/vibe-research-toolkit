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
