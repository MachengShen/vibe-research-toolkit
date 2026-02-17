# Agent System Overview

## Purpose
This machine hosts a shared Discord-based workflow where Codex and Claude-style agents can handle user requests with continuity across sessions.

Use this file for fast onboarding before deeper docs.

## What the system does (functional view)
- Receives user messages from Discord through a relay layer.
- Routes each conversation to an agent session with memory of prior turns.
- Runs work in `/root` unless changed intentionally.
- Streams progress and returns final responses to the same Discord context.
- Supports media/file delivery with channel-specific limits.

## Agent roles (current operating model)
- `Codex` (`codex` CLI): execution-heavy tasks, long-running operations, concrete file/system actions.
- `Claude` (`claude` CLI): reasoning-heavy analysis, synthesis, planning, cross-file interpretation.

Both run on the same filesystem and can read/write shared project state.

## Core context files (read first)
1. `/root/AGENTS.md` (global operating rules)
2. `/root/AGENT_SYSTEM_OVERVIEW.md` (this quick summary)
3. `/root/SYSTEM_SETUP_WORKING_MEMORY.md` (machine-level decisions and evidence)
4. `/root/HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt` (latest operational handoff)

## Relay behavior (high level)
- Conversations are scoped to allowed Discord guild/channel settings.
- Each conversation maps to a persisted session.
- Requests are queued per conversation to avoid overlap.
- Progress updates are posted during longer runs.
- Timeout policy is currently configured for long completion-oriented runs.

## How to work safely in this environment
- Treat latest user text as authoritative (speech-to-text may introduce wording drift).
- Prefer functional explanations unless the user asks for deep implementation detail.
- For system-level changes, append timestamped updates to:
  - `/root/SYSTEM_SETUP_WORKING_MEMORY.md`
  - `/root/HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt`
- Keep edits append-only in handoff/memory logs.

## Where to look next (if needed)
- Relay operations and behavior: `/root/codex-discord-relay/README.md`
- Replication toolkit: `/root/openclaw-codex-discord-skills-kit/README.md`
- Runtime config: `/root/.codex-discord-relay.env`
- Runtime logs: `/root/.codex-discord-relay/relay.log`
