---
name: discord-image-upload
description: "Use when a Discord-connected Codex agent needs to attach local image files (PNG/JPEG/WebP/GIF) in Discord messages, via `codex-discord-relay` (`[[upload:...]]`) and optionally OpenClaw (`MEDIA: ...`)."
version: 1.0
---

# Discord Image Upload

## When To Use
- You are chatting in Discord and the user says “send/upload/show this image.”
- You generated an image file (plot/screenshot/diagram) and need to attach it in Discord.
- You need to attach an existing local image from disk (for example `/root/foo.png`).

## Pick The Right Protocol
- **codex-discord-relay**: Supports Discord slash commands like `/upload` and `/status` and uses `[[upload:...]]` markers.
- **OpenClaw Discord connector**: Supports `MEDIA: <path-or-url>` directives (or sending via `openclaw message send --media ...`).

If you’re not sure which one you’re behind, default to `[[upload:...]]`. If the relay doesn’t upload, switch to `MEDIA: ...` or ask the user whether they’re using `codex-discord-relay` or OpenClaw.

## codex-discord-relay: Upload Directives
- Put one directive per line in your **final** reply as plain text (not in a code block).
- Use one of:
  - `[[upload:relative.png]]` (relative paths resolve under `$RELAY_UPLOAD_DIR`)
  - `[[upload:/abs/path.png]]` (only works if absolute-path uploads are enabled and the path is within allowed roots)

### Preferred Flow (Write Into `$RELAY_UPLOAD_DIR`)
1. Write/copy the image to `$RELAY_UPLOAD_DIR/<name>.png`.
2. In your final reply, include `[[upload:<name>.png]]`.

### Existing File Flow (Absolute Path)
If the user already has an image on disk and you are allowed to upload it, include:
- `[[upload:/root/path/to/image.png]]`

## Limits And Guardrails (codex-discord-relay)
- Allowed extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`
- Typical relay limits: max 3 files per reply; max 8MB per file
- Absolute-path uploads may be restricted to an allowlist of roots (for example `/root` and `/tmp`).

## Examples (codex-discord-relay)
User: “Send `/root/tmp/a.png`”

Assistant (final reply):
```
Here you go.
[[upload:/root/tmp/a.png]]
```

User: “Generate the plot and send it”

Assistant:
- Write the plot to `$RELAY_UPLOAD_DIR/plot.png`
- Final reply:
```
Plot attached.
[[upload:plot.png]]
```

## Troubleshooting (codex-discord-relay)
- In Discord, run `/status` to confirm the `upload_dir` and whether absolute-path uploads are enabled.
- If an upload fails: check file existence, extension, size, and whether the path is within the allowed roots.
- On the server: `codex-discord-relayctl status` and `tail -n 200 /root/.codex-discord-relay/relay.log`.

## Safety
- Never upload secrets (tokens/keys/config files).
- If a user asks to upload a file outside `$RELAY_UPLOAD_DIR`, confirm the exact path and intent first.
