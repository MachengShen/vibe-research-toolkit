# currentDate
Today's date is 2026-02-17.

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.

# claudeMd
Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.

## Speech-to-Text Input
User communicates via a speech-to-text API over Discord. Messages may contain phonetic transcription errors — similar-sounding words substituted for the intended ones (e.g. "AdaTok" → "AdaTalk", "Codex" → "Codec", "Claude" → "Clawed", "relay" → "really"). Do not flag or correct these. Interpret charitably based on surrounding context. If ambiguity would change a concrete action, ask one short clarification question.

## Agent Ecosystem
This machine runs two agent types side by side:
- **Claude** (`claude` CLI) — strong at reasoning, architecture decisions, research interpretation, cross-file understanding.
- **Codex** (`codex` CLI) — strong at agentic execution, long background tasks, code generation from tight specs.

Both agents share the same filesystem at `/root`. Skills live in:
- `/root/.agents/skills/` — canonical source
- `/root/.claude/skills/` — symlinks for Claude
- `/root/.codex/skills/` — symlinks for Codex

## Global Work Log Policy
For any project with active experiments or ongoing work:
- Read `<project-root>/HANDOFF_LOG.md` or `HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt` at task start.
- Read `/root/SYSTEM_SETUP_WORKING_MEMORY.md` for machine-level infrastructure context.
- Append timestamped updates after major actions and at task end.
- Never overwrite prior entries — append only.

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
| Global handoff log | `/root/HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt` |
