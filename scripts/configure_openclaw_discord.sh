#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/common.sh"

require_root

if [[ -z "${OPENCLAW_DISCORD_BOT_TOKEN:-}" ]]; then
  log "OPENCLAW_DISCORD_BOT_TOKEN is empty; skipping OpenClaw Discord channel config"
  exit 0
fi

log "initializing OpenClaw state (setup)"
openclaw setup >/dev/null 2>&1 || true

log "configuring OpenClaw Discord bot token"
openclaw channels add --channel discord --token "$OPENCLAW_DISCORD_BOT_TOKEN" >/dev/null

log "setting Discord allowlist policy"
openclaw config set channels.discord.groupPolicy '"allowlist"' --json >/dev/null

if [[ -n "${OPENCLAW_DISCORD_GUILD_ID:-}" && -n "${OPENCLAW_DISCORD_CHANNEL_ID:-}" ]]; then
  log "allowlisting guild=$OPENCLAW_DISCORD_GUILD_ID channel=$OPENCLAW_DISCORD_CHANNEL_ID"
  openclaw config set "channels.discord.guilds.${OPENCLAW_DISCORD_GUILD_ID}.channels.${OPENCLAW_DISCORD_CHANNEL_ID}.allow" true --json >/dev/null
fi

if [[ "${OPENCLAW_DISABLE_BUILTIN_WEB_SEARCH:-true}" == "true" ]]; then
  log "disabling built-in web.search tool (avoids Brave-key errors)"
  openclaw config set tools.web.search.enabled false --json >/dev/null || true
fi

log "OpenClaw Discord config applied"
