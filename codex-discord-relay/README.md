# Codex Discord Relay

Direct Discord -> agent CLI relay so you can chat with Codex or Claude from Discord (including iPhone) without going through OpenClaw.

## What it does

- Replies in DMs. In guild channels it replies when mentioned; in threads it can auto-respond without mention (see `RELAY_THREAD_AUTO_RESPOND`).
- Persists an agent session id per Discord conversation.
- Queues messages per conversation to avoid overlap.
- Supports two backends via `RELAY_AGENT_PROVIDER`:
  - `codex` (default): uses `codex exec` / `codex exec resume`
  - `claude`: uses `claude -p --output-format json --resume`
- Supports quick commands:
  - `/status`
  - `/reset`
  - `/workdir /absolute/path`
  - `/attach <session_id>`
  - `/upload <path>`
  - `/context`
  - `/context reload`
  - `/help`

## Setup

1. Install dependencies:

```bash
cd /root/codex-discord-relay
npm install
```

2. Create runtime env:

```bash
cp /root/codex-discord-relay/.env.example /root/.codex-discord-relay.env
chmod 600 /root/.codex-discord-relay.env
```

If you want Claude backend, set in `/root/.codex-discord-relay.env`:

```bash
RELAY_AGENT_PROVIDER=claude
CLAUDE_BIN=claude
# optional:
# CLAUDE_MODEL=sonnet
# CLAUDE_PERMISSION_MODE=acceptEdits
# CLAUDE_ALLOWED_TOOLS=Bash,Read,Glob,Grep,Write,Edit,NotebookEdit,TodoWrite,Task,TaskOutput,TaskStop,EnterPlanMode,ExitPlanMode,ToolSearch,AskUserQuestion,Skill,WebSearch,WebFetch
# RELAY_AGENT_TIMEOUT_MS=900000
```

3. Start/recover service:

```bash
/usr/local/bin/codex-discord-relay-ensure.sh

# If multi-instance wrappers are installed on this machine:
/usr/local/bin/codex-discord-relay-ensure-multi.sh
```

4. Check logs:

```bash
tail -f /root/.codex-discord-relay/relay.log
```

## Operate

Single-instance commands:

```bash
codex-discord-relayctl status
codex-discord-relayctl restart
codex-discord-relayctl logs
```

Multi-instance commands (if installed):

```bash
codex-discord-relay-multictl list
codex-discord-relay-multictl status all
codex-discord-relay-multictl restart default
codex-discord-relay-multictl logs default
```

## Instance Layout (multi-instance mode)

- Default env: `/root/.codex-discord-relay.env`
- Extra env files: `/root/.codex-discord-relay/instances.d/<name>.env`
- Default state: `/root/.codex-discord-relay`
- Extra state: `/root/.codex-discord-relay/instances/<name>/`

## Notes

- `RELAY_AGENT_PROVIDER=codex|claude` selects the backend.
- `RELAY_AGENT_TIMEOUT_MS` controls max runtime per agent call (default `600000` ms, set `0` to disable).
- `CLAUDE_PERMISSION_MODE=acceptEdits` is recommended when relay runs as root.
- `CLAUDE_ALLOWED_TOOLS` can pre-allow specific Claude tools (comma or space separated) to avoid interactive approval prompts in relay flows.
- Agent context bootstrap is enabled by default. The relay injects runtime context into prompts so agents know they are replying via Discord and can request uploads with `[[upload:...]]`.
  Tune with `RELAY_CONTEXT_ENABLED`, `RELAY_CONTEXT_EVERY_TURN`, `RELAY_CONTEXT_VERSION`, `RELAY_CONTEXT_FILE`, `RELAY_CONTEXT_MAX_CHARS`, and `RELAY_CONTEXT_MAX_CHARS_PER_FILE`.
- Default `CODEX_APPROVAL=never` (Codex mode) prevents approval prompts from blocking mobile usage.
- Default `CODEX_SANDBOX=danger-full-access` matches the YOLO/no-permission flow; set it to `workspace-write` if you want tighter sandboxing.
- `/workdir` is restricted by `CODEX_ALLOWED_WORKDIR_ROOTS`.
- The relay edits the initial `Running ...` message with human-readable intermediate progress (see `RELAY_PROGRESS*` env vars).
- `DISCORD_ALLOWED_CHANNELS` is matched against the thread parent channel as well, so threads created under an allowed channel work without adding each thread id.
- Image uploads: Codex can ask the relay to upload a local image by including `[[upload:some.png]]` in its response (or you can use `/upload some.png`). Files are resolved relative to the per-conversation `upload_dir` shown by `/status`.
- If Discord is blocked on your network, the relay supports proxies via `DISCORD_GATEWAY_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY`.
  It will also automatically source `/root/.openclaw/proxy.env` when starting (same proxy config used by OpenClaw).
- `/attach` is **DM-only by default**. Set `RELAY_ATTACH_ALLOW_GUILDS=true` if you intentionally want to allow attaching sessions in guild channels.

## Agent Context Bootstrap

By default, the relay prepends a small runtime context block before forwarding a user prompt to Codex/Claude. This makes agents aware of:

- They are being used via Discord relay
- Replies are routed back to Discord
- Upload marker syntax (`[[upload:path]]`) for attachments
- Slash-command boundaries (`/status`, `/reset`, etc. are user-side)

Controls:

- `RELAY_CONTEXT_ENABLED=true|false`
- `RELAY_CONTEXT_EVERY_TURN=true|false` (default false)
- `RELAY_CONTEXT_VERSION=<int>` (default `1`; bump to force re-bootstrap on existing sessions)
- `RELAY_CONTEXT_FILE=<spec1>;<spec2>;...` (optional per-instance extra context list)
  - Prefix each spec with `head:`, `tail:`, or `headtail:`. If omitted, `head:` is used.
  - Absolute paths are loaded directly.
  - Relative paths resolve against the active session workdir (`/workdir`).
- `RELAY_CONTEXT_MAX_CHARS=<int>` (default `40000`)
- `RELAY_CONTEXT_MAX_CHARS_PER_FILE=<int>` (default `2000` in templates; runtime default falls back to total budget)

Example:

```bash
RELAY_CONTEXT_FILE="/root/.codex-discord-relay/global-context.md;tail:docs/WORKING_MEMORY.md;tail:HANDOFF_LOG.md;tail:/root/SYSTEM_SETUP_WORKING_MEMORY.md;tail:/root/HANDOFF_SUMMARY_FOR_NEXT_CODEX.txt"
RELAY_CONTEXT_MAX_CHARS=40000
RELAY_CONTEXT_MAX_CHARS_PER_FILE=20000
```

Tips:

- `/status` shows `context_bootstrap` state and current session context version.
- `/context` prints resolved context specs, file status, and estimated injected chars for the current workdir.
- `/context reload` forces one-time context re-injection on the next user message without resetting the agent session.
- After changing `RELAY_CONTEXT_FILE`, either bump `RELAY_CONTEXT_VERSION`, run `/context reload`, or run `/reset`.

## Progress Message Tuning

These `.env` variables control intermediate status edits in Discord:

- `RELAY_PROGRESS=true|false`
- `RELAY_PROGRESS_MIN_EDIT_MS` (default `5000`)
- `RELAY_PROGRESS_HEARTBEAT_MS` (default `20000`)
- `RELAY_PROGRESS_MAX_LINES` (default `6`)
- `RELAY_PROGRESS_SHOW_COMMANDS=false` (recommended; avoid leaking sensitive command text)

## Troubleshooting Stalls

```bash
# 1) Is relay alive?
codex-discord-relay-multictl list

# 2) Are Codex child jobs stuck? (Codex mode only)
pgrep -af "codex .*exec" || true

# 3) Check relay logs
tail -n 200 /root/.codex-discord-relay/relay.log
```

Frequent causes:

- Proxy/network issues: `ETIMEDOUT ...:443` in relay log.
- Old Node runtime: `Cannot find module 'node:fs'` or `node:fs/promises`.
- Hung Codex child run (Codex mode) blocks that conversation queue until process exits or relay restarts.
- Timeout too low for long prompts: if you see `codex timeout ...` or `claude timeout ...`, increase `RELAY_AGENT_TIMEOUT_MS`.
