---
name: openclaw-media-send
description: "Use when a CLI Codex agent needs to send a Discord/Slack (or other OpenClaw-supported channel) message with a local attachment via the OpenClaw CLI (`openclaw message send --media ...`)."
---

# OpenClaw Media Send

## When To Use
- You are interacting with a Codex agent over CLI/SSH (no Discord relay), and the user wants an image/file posted into Discord (or another OpenClaw channel).
- The user gives you a local path (e.g. `/root/foo.png`) and wants it attached in chat.

## Quick Workflow
1. Confirm OpenClaw + Discord are healthy:
   - `openclaw status` (or `openclaw health`)
2. Identify the destination:
   - Ask the user for the Discord channel ID (recommended), or
   - Resolve/list IDs with OpenClaw:
     - `openclaw channels resolve --channel discord --kind group "<name>" --json`
     - `openclaw message channel list --channel discord --json` (then filter)
3. Send the message with attachment:
   - Dry-run first if unsure:
     - `openclaw message send --channel discord --target channel:<CHANNEL_ID> --media /abs/path.png --message "..." --dry-run`
   - Then actually send:
     - `openclaw message send --channel discord --target channel:<CHANNEL_ID> --media /abs/path.png --message "..." --json`

Notes:
- `--media` accepts local paths or URLs.
- `--message` is optional when `--media` is set.
- Prefer explicit `channel:<id>` (or `user:<id>` for DMs) to avoid ambiguity.

## Examples
Send an existing local image to a Discord channel:
```bash
openclaw message send \
  --channel discord \
  --target channel:123456789012345678 \
  --media /root/screenshots/plot.png \
  --message "plot attached" \
  --json
```

Send only the attachment (no text body):
```bash
openclaw message send --channel discord --target channel:123456789012345678 --media /tmp/a.png --json
```

## Troubleshooting
- Dashboard unreachable: `openclaw health` and `openclaw logs --follow`.
- Discord target problems: re-check the ID and try `--dry-run`; use `openclaw channels resolve ... --json`.
- If sending fails, re-run with `--verbose`.

## Safety
- Never attach secrets (tokens, `.env`, private keys, credential files).
- If the user asks to upload from a sensitive location, confirm intent before sending.
