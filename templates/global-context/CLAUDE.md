# Global Claude Agent Context

## Speech-to-Text Input
User communicates via a speech-to-text API over Discord. Messages may contain phonetic transcription errors — similar-sounding words substituted for the intended ones (e.g. "AdaTok" → "AdaTalk", "Codex" → "Codec", "Claude" → "Clawed", "relay" → "really"). Do not flag or correct these. Interpret charitably based on surrounding context. If ambiguity would change a concrete action, ask one short clarification question.

## Agent Ecosystem
This machine runs two agent types side by side:
- **Claude** (`claude` CLI) — this agent. Strong at reasoning, architecture decisions, research interpretation, cross-file understanding.
- **Codex** (`codex` CLI) — OpenAI agent. Strong at agentic execution, long background tasks, code generation from tight specs.

Both agents share the same filesystem at `/root`. Skills live in:
- `/root/.agents/skills/` — canonical source
- `/root/.claude/skills/` — symlinks for Claude
- `/root/.codex/skills/` — symlinks for Codex

## Global Work Log Policy
For any project with active experiments or ongoing work:
- Read `<project-root>/HANDOFF_LOG.md` at task start.
- If present, read `<project-root>/docs/WORKING_MEMORY.md` for the latest current-state snapshot.
- Read `/root/SYSTEM_SETUP_WORKING_MEMORY.md` for machine-level infrastructure context.
- Update memory artifacts after major actions and at task end:
  - `HANDOFF_LOG.md` is append-only chronological history.
  - `docs/WORKING_MEMORY.md` is a living snapshot and may be compacted or rewritten.
- If you create a git commit in the project repo, record it in both files:
  - append commit hash + subject + affected scope to `HANDOFF_LOG.md`
  - update `docs/WORKING_MEMORY.md` with the latest commit reference and its current significance
- Append-only rules apply to handoff logs, not to working-memory snapshot files.

## Relay Infrastructure
- Agent is accessed via `codex-discord-relay` — a Discord bot that proxies messages to agent CLI sessions.
- Config: `/root/.codex-discord-relay.env`
- Logs: `/root/.codex-discord-relay/relay.log`
- Restart: `codex-discord-relay-multictl restart default`

## Key Paths
| Purpose | Path |
|---|---|
| Skills (canonical) | `/root/.agents/skills/` |
| Skills kit repo | `/root/openclaw-codex-discord-skills-kit/` |
| Relay config | `/root/.codex-discord-relay.env` |
| Agent system overview | `/root/AGENT_SYSTEM_OVERVIEW.md` |
| System working memory | `/root/SYSTEM_SETUP_WORKING_MEMORY.md` |
| Global handoff log | `/root/HANDOFF_LOG.md` |
