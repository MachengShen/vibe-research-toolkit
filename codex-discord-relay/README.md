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
  - `/task ...`
  - `/worktree ...`
  - `/plan ...`
  - `/handoff ...`
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
- `/task ...` is a persistent per-conversation task queue with an auto-runner ("Ralph loop"). Tune with `RELAY_TASKS_ENABLED`, `RELAY_TASKS_MAX_PENDING`, `RELAY_TASKS_STOP_ON_ERROR`, `RELAY_TASKS_POST_FULL_OUTPUT`.
- `/worktree ...` manages `git worktree` under `RELAY_WORKTREE_ROOT_DIR` (must be inside `CODEX_ALLOWED_WORKDIR_ROOTS`).
- The relay edits the initial `Running ...` message with human-readable intermediate progress (see `RELAY_PROGRESS*` env vars).
- `DISCORD_ALLOWED_CHANNELS` is matched against the thread parent channel as well, so threads created under an allowed channel work without adding each thread id.
- Image uploads: Codex can ask the relay to upload a local image by including `[[upload:some.png]]` in its response (or you can use `/upload some.png`). Files are resolved relative to the per-conversation `upload_dir` shown by `/status`.
- Incoming text attachments: when you attach a small text file in Discord (e.g. `.md`, `.txt`, `.json`), the relay downloads it into `<upload_dir>/attachments/` and appends its contents to the prompt automatically. Tune with `RELAY_DISCORD_ATTACHMENTS_*`.
- If Discord is blocked on your network, the relay supports proxies via `DISCORD_GATEWAY_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY`.
  It will also automatically source `/root/.openclaw/proxy.env` when starting (same proxy config used by OpenClaw).
- `/attach` is **DM-only by default**. Set `RELAY_ATTACH_ALLOW_GUILDS=true` if you intentionally want to allow attaching sessions in guild channels.

## Task Queue (Ralph Loop)

Commands:

- `/task add <text...>`: append a pending task to this conversation.
- `/task list`: show the queue.
- `/task run`: run tasks sequentially until empty/blocked/stopped.
- `/task stop`: stop immediately (kills the in-flight agent child process).
- `/task clear [done|all]`: clear completed tasks (or everything).

Env knobs:

- `RELAY_TASKS_ENABLED=true|false`
- `RELAY_TASKS_MAX_PENDING=<int>` (default `50`)
- `RELAY_TASKS_STOP_ON_ERROR=true|false` (default `false`)
- `RELAY_TASKS_POST_FULL_OUTPUT=true|false` (default `true`)
- `RELAY_TASKS_SUMMARY_AFTER_RUN=true|false` (default `true`)

## Git Worktrees

Commands:

- `/worktree list`: show `git worktree list --porcelain` for the current repo.
- `/worktree new <name> [--from <ref>] [--use]`: create a new worktree (branch `wt/<name>`).
- `/worktree use <name>`: switch workdir to an existing worktree and reset session/context.
- `/worktree rm <name> [--force]`: remove a worktree (refuses if it is active unless `--force`).
- `/worktree prune`: run `git worktree prune`.

Env knobs:

- `RELAY_WORKTREE_ROOT_DIR=/abs/path` (default `$RELAY_STATE_DIR/worktrees`)

## Plans

Commands:

- `/plan <request...>` (or `/plan new <request...>`): generate and save a plan (Codex run uses `--sandbox read-only`).
- `/plan list`: list saved plans for this conversation.
- `/plan show <id|last>`: show a saved plan.
- `/plan queue <id|last> [--run]`: extract the plan's "Task breakdown" list and enqueue items as `/task` entries (optional `--run` starts the task runner).
- `/plan apply <id|last> [--confirm]`: execute a saved plan (agent edits repo).

Notes:

- Plan generation uses `codex exec --sandbox read-only` (stateless) so it cannot write files; the relay saves the resulting Markdown to `$RELAY_STATE_DIR/plans/<conversationKey>/<planId>.md`.
- Plan apply runs the configured agent provider in normal mode (Codex/Claude) and passes the saved plan text as context.
- In guild channels, plan apply may require `--confirm` (see env knob below).

Env knobs:

- `RELAY_PLANS_ENABLED=true|false`
- `RELAY_PLANS_MAX_HISTORY=<int>` (default `20`)
- `RELAY_PLAN_APPLY_REQUIRE_CONFIRM_IN_GUILDS=true|false` (default `true`)

## Handoff And Working Memory

Commands:

- `/handoff`: generate a handoff entry (Codex run uses `--sandbox read-only`) and append it to files.
- `/handoff --commit`: also `git commit` the updated handoff files (repo only).
- `/handoff --push`: push after commit (repo only).

Notes:

- The relay appends to the files itself; Codex is used only to *generate* the text in read-only mode.
- If `RELAY_AUTO_HANDOFF_AFTER_TASK_RUN=true`, a handoff is written automatically after `/task run` completes.
- If `RELAY_AUTO_HANDOFF_AFTER_PLAN_APPLY=true`, a handoff is written automatically after `/plan apply` completes.
- `RELAY_HANDOFF_AUTO_ENABLED` is a legacy alias for enabling both auto-handoff behaviors above.

Env knobs:

- `RELAY_HANDOFF_ENABLED=true|false`
- `RELAY_HANDOFF_FILES="HANDOFF_LOG.md;docs/WORKING_MEMORY.md"` (semicolon-separated)
- `RELAY_HANDOFF_AUTO_ENABLED=true|false` (legacy; default `false`)
- `RELAY_AUTO_HANDOFF_AFTER_TASK_RUN=true|false` (default `false`)
- `RELAY_AUTO_HANDOFF_AFTER_PLAN_APPLY=true|false` (default `false`)
- `RELAY_HANDOFF_GIT_AUTO_COMMIT=true|false` (default `false`)
- `RELAY_HANDOFF_GIT_AUTO_PUSH=true|false` (default `false`)
- `RELAY_HANDOFF_GIT_COMMIT_MESSAGE="..."` (default `chore: relay handoff`)

## Optional Git Auto-Commit

If enabled, the relay will `git add -A && git commit` after successful `/task` steps and/or `/plan apply` when the repo has changes. It never auto-pushes.

Env knobs:

- `RELAY_GIT_AUTO_COMMIT=true|false` (default `false`)
- `RELAY_GIT_AUTO_COMMIT_SCOPE=task|plan|both` (default `both`)
- `RELAY_GIT_COMMIT_PREFIX="ai:"` (default `ai:`)

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
