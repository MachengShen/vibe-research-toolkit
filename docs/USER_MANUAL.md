# OpenClaw + Codex Discord Relay — User Manual (Research Workflow)

This manual explains how to use the **Discord → Codex/Claude CLI relay** in this repo effectively, especially for **research** (experiments, writing, literature review, reproducible pipelines).

---

## 1) What this system is (mental model)

You are running a **Discord bot** that:
- Receives your message (DM or mention in a server)
- Builds a prompt (optionally injecting your "working memory" + handoff docs)
- Calls an **agent CLI** (Codex CLI or Claude CLI)
- Posts the response back into Discord
- Persists a per-conversation agent session (`thread_id`) + `workdir`
- Optionally runs a **task queue**, **git worktrees**, **plan mode**, and **handoff automation**

### Key concepts
- **Conversation key**: Unique identifier per Discord context (DM vs channel vs thread). Each key has its own persistent session state.
- **Session**: Stores `threadId` (agent session resume id), `workdir`, and optional queue/plan/handoff metadata.
- **Workdir**: The directory the agent will operate in. Switch with `/workdir`.
- **Context bootstrap**: Optional injection of runtime context + your memory/handoff files into the agent prompt. See `/context`.
- **Task queue ("Ralph loop")**: Persistent backlog of tasks that can auto-run sequentially with `/task run`.
- **Git worktrees**: Lightweight parallel workspaces so multiple agents can work without conflicts. Manage with `/worktree ...`.
- **Plan mode**: Generate a plan first (read-only), then apply it. Manage with `/plan ...`.
- **Handoff/Working memory**: Append-only artifacts for continuity across sessions/agents. Manage with `/handoff ...`.

---

## 2) Setup & prerequisites

### Requirements
- Node.js **>= 20**
- A Discord bot token (`DISCORD_BOT_TOKEN`)
- Codex CLI installed (and configured), and optionally Claude CLI if using Claude backend
- A Linux host is assumed by the bootstrap scripts (systemd/cron)

### Basic install (single-instance)
1) Clone the repo onto your server.
2) Copy and edit setup env:
   - `cp config/setup.env.example config/setup.env`
3) Bootstrap (root):
   - `sudo ./bootstrap.sh`

### Relay-only install (no OpenClaw)
If you only want the Discord→agent relay:
1) Install dependencies:
   - `cd codex-discord-relay && npm install`
2) Create env file:
   - `cp codex-discord-relay/.env.example /root/.codex-discord-relay.env`
3) Start service:
   - `/usr/local/bin/codex-discord-relay-ensure.sh`

### Verify
- `codex-discord-relayctl status`
- `codex-discord-relayctl logs`
- In Discord, DM the bot and run `/status`

---

## 3) Command cheat sheet (the ones you'll actually use)

### Core session commands
- `/status`
  Shows session id, current workdir, upload directory, and context bootstrap info.

- `/workdir /absolute/path`
  Changes workdir and **resets** the agent session for this conversation key.

- `/reset`
  Resets the agent session for this conversation key (keeps workdir).

- `/attach <thread_id>`
  Attach this Discord context to an existing agent session id (DM-only by default).

- `/help`
  Prints command list.

### Context / memory commands
- `/context`
  Shows which context files are being injected (resolved paths + char counts).

- `/context reload`
  Forces the next message to re-inject context (without fully resetting the agent session).

### Task queue ("Ralph loop")
- `/task add <text...>`
- `/task list`
- `/task run`
- `/task stop`
- `/task clear [done|all]`

### Parallelism via git worktrees
- `/worktree list`
- `/worktree new <name> [--from <ref>] [--use]`
- `/worktree use <name>`
- `/worktree rm <name> [--force]`
- `/worktree prune`

### Plans
- `/plan <request...>` (alias of `/plan new ...`)
- `/plan list`
- `/plan show <plan_id>`
- `/plan apply <plan_id> [--confirm]`

### Handoff / working memory
- `/handoff [--dry-run] [--commit|--no-commit] [--push|--no-push]`

### Attachments / uploads
- Attach small text files in Discord (e.g. `.md`, `.txt`, `.json`) → relay downloads and appends contents to prompt automatically.
- `/upload <path>` to upload an image from the per-conversation upload directory.
- Or have the agent request images by writing: `[[upload:relative/or/absolute/path]]` in its final response.

---

## 4) Recommended research workflow patterns

### Pattern A — "Plan → Apply → Tasks → Handoff" (default)
Use this for anything that touches code or papers.

1) Set/confirm workdir:
   - `/workdir /path/to/your/project`
   - `/status`

2) Generate a plan:
   - `/plan Design an experiment to test X; add instrumentation; produce plots; update notes`

3) Review the plan:
   - `/plan show last`

4) Apply:
   - `/plan apply last --confirm` (guild channels may require `--confirm`)

5) Convert plan breakdown into tasks:
   - `/task add Implement instrumentation`
   - `/task add Run baseline experiment`
   - `/task add Plot results + summarize`
   - `/task run`

6) Write handoff (research log):
   - `/handoff --commit` (optional)

Why this works:
- Plan reduces wasted agent edits.
- Tasks batch execution so you don't babysit.
- Handoff keeps continuity and makes collaboration possible.

---

### Pattern B — Parallel experiments with worktrees (fast iteration)
Use this when you want 2–5 experiments in parallel.

1) Pick a repo root as workdir:
   - `/workdir /path/to/repo`

2) Create worktrees:
   - `/worktree new exp-a --use`
   - `/worktree new exp-b`
   - `/worktree new exp-c`

3) In Discord, create separate **threads** (or use multiple DMs/instances) and in each:
   - `/worktree use exp-b`
   - then run `/plan ...` + `/task ...`

4) Merge results later with git:
   - compare branches `wt/exp-a`, `wt/exp-b`, etc.
   - cherry-pick commits or merge.

Research tip:
- Use one worktree for "writing/paper" and others for "experiments/code". Keeps diffs clean.

---

### Pattern C — Literature review / reading mode (no repo edits)
1) Use a dedicated workdir for notes:
   - `/workdir /path/to/notes`
2) Keep context small:
   - include only working memory and a "reading queue" file in `RELAY_CONTEXT_FILE`
3) Add tasks like:
   - `/task add Summarize paper A; extract key claims + methods + limitations`
   - `/task add Compare paper A vs B; list open questions`
   - `/task run`
4) `/handoff` to append the summary into your log.

---

## 5) How to use Working Memory + Handoff effectively

Think of these as your "research lab notebook":

### docs/WORKING_MEMORY.md (current truth)
- Current hypotheses + dataset/experiment status
- Current repo state ("what works / what's broken")
- Active TODOs (short)

### HANDOFF_LOG.md (append-only timeline)
- What happened today
- What changed and why
- What to do next and what to avoid

Practical discipline:
- Keep working memory compact and updated.
- Let handoff be longer and chronological.

If enabled, auto-handoff after `/task run` and `/plan apply` keeps these files fresh without manual work.

---

## 6) Tuning settings for research productivity

### "Mobile-first" defaults (recommended)
- `CODEX_APPROVAL=never`
  Avoid interactive approval prompts.
- `CODEX_SANDBOX=workspace-write` (safer) or `danger-full-access` (fastest).
- Increase timeouts for long experiments:
  - `RELAY_AGENT_TIMEOUT_MS=900000` (15 min) or `0` (disable timeout)

### Context settings (avoid prompt bloat)
- Use tail/headtail for large logs:
  - `tail:docs/WORKING_MEMORY.md`
  - `tail:HANDOFF_LOG.md`
- Keep budgets sane:
  - `RELAY_CONTEXT_MAX_CHARS=40000`
  - `RELAY_CONTEXT_MAX_CHARS_PER_FILE=20000`
- If the agent starts "forgetting", bump:
  - `RELAY_CONTEXT_VERSION += 1` or run `/context reload`

### Parallelism settings
- Use worktrees for parallel code changes.
- If you need completely separate rate limits/configs, run multi-instance relays.

---

## 7) Troubleshooting

### Stop a stuck run
- `/task stop` (kills in-flight CLI child process)

### Check logs
- `tail -f /root/.codex-discord-relay/relay.log`
- `codex-discord-relayctl logs`

### Not replying in server channels
- In guild channels, the relay replies only when mentioned unless thread auto-respond is enabled.
- Confirm allowlists: `DISCORD_ALLOWED_GUILDS`, `DISCORD_ALLOWED_CHANNELS`

### Proxies
If Discord is blocked:
- set `DISCORD_GATEWAY_PROXY` or `HTTPS_PROXY`
- also ensure `/root/.openclaw/proxy.env` is correct if you use OpenClaw

### Validate scripts
Quick sanity checks to verify installation:
- `node --check codex-discord-relay/relay.js`
- `bash -n bootstrap.sh`
- `bash -n scripts/*.sh`

---

## 8) Quick "research recipes" (copy/paste prompts)

### New experiment sprint
`/plan Set up an experiment to test <hypothesis>. Add a script to run it, write results to a timestamped folder, and produce a plot. Update working memory with how to run it.`

### Reproduce paper result
`/plan Reproduce Figure 3 from <paper>. Identify required data and steps, implement pipeline, and write a short replication report in notes/replication.md.`

### Clean up and package
```
/task add Run tests, fix lint, and make sure README explains how to run the experiment end-to-end
/task add Update HANDOFF_LOG with what changed and what to do next
/task run
```

---

## 9) Safety notes
- Keep `CODEX_ALLOWED_WORKDIR_ROOTS` tight (don't allow `/`).
- Avoid enabling auto-push unless you really want it.
- In guild channels, prefer requiring `--confirm` for `/plan apply`.
