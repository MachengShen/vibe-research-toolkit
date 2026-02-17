# AGENTS.md — Global Agent Context

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
- Read `<project-root>/HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt` (or `HANDOFF_LOG.md`) at task start.
- Read `/root/SYSTEM_SETUP_WORKING_MEMORY.md` for machine-level infrastructure context.
- Append timestamped updates at minimum:
  - at task start (timestamp, owner, objective)
  - after major actions (job launch/stop, code changes, failures)
  - at task end (what changed, current run state, next steps)
- Always include: absolute timestamp with timezone, exact run/log paths, latest known epoch and key metrics when training is active.
- Append-only: never delete or rewrite prior entries.

If a project already has its own `AGENTS.md`, keep those instructions and include this work-log policy.

## System-Wide Context Memory
For machine-level setup, infrastructure, relay/runtime, or cross-repo environment tasks:
- Read `/root/SYSTEM_SETUP_WORKING_MEMORY.md` at task start.
- Append new evidence-backed updates after major actions and at task end.

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
| System working memory | `/root/SYSTEM_SETUP_WORKING_MEMORY.md` |
| Global handoff log | `/root/HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt` |
