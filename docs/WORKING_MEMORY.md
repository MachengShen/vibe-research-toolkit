# Toolkit Working Memory (living snapshot)

Last updated: 2026-02-20T15:07:19+08:00

## Objective
Maintain `openclaw-codex-discord-skills-kit` as the canonical reproducible setup for Discord relay + skills workflows.

## Stable decisions
- Use `HANDOFF_LOG.md` as the only handoff history file in this repo.
- Do not keep a separate `HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt`.
- Working memory is compact, current-state oriented, and can be rewritten.

## Current capabilities in relay toolkit
- Persistent conversation sessions + queue-safe execution.
- `/task` Ralph loop with interruptive stop.
- `/worktree` workflow for isolated parallel work.
- `/plan` (`new/list/show/queue/apply`) + optional auto-handoff.
- Agent relay actions for long jobs with `thenTask` callback.
- Per-task handoff append option.
- Job-finish callback finalization is queue-independent, so `thenTask` can still enqueue when foreground agent runs are stuck.
- Claude runner now performs one automatic retry for transient init-only exits before surfacing failure.
- Upload marker resolution now supports session-workdir-relative paths (fallback to conversation upload dir), improving downloadable artifact reliability.

## Important files
- Relay core: `codex-discord-relay/relay.js`
- Relay docs: `codex-discord-relay/README.md`
- Defaults: `config/setup.env.example`, `codex-discord-relay/.env.example`
- Installer: `scripts/install_codex_discord_relay.sh`
- Global context templates: `templates/global-context/*`

## Open priorities
- Keep docs/examples aligned with actual live defaults.
- Preserve minimal, high-signal handoff records.
- Keep packaged skills installable and documented.
