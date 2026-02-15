#!/usr/bin/env node
"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

function resolveDiscordProxyUrl() {
  // Prefer explicit Discord proxy env, then fall back to conventional proxy env vars.
  const candidates = [
    process.env.DISCORD_GATEWAY_PROXY,
    process.env.DISCORD_PROXY_URL,
    process.env.HTTPS_PROXY,
    process.env.HTTP_PROXY,
    process.env.ALL_PROXY,
    process.env.OPENCLAW_PROXY_URL,
  ];
  for (const raw of candidates) {
    const v = (raw || "").trim();
    if (v) return v;
  }
  return null;
}

function installWsProxyIfConfigured(proxyUrl) {
  if (!proxyUrl) return;
  try {
    const { HttpsProxyAgent } = require("https-proxy-agent");
    const ws = require("ws");

    const Original = ws.WebSocket || ws;
    const agent = new HttpsProxyAgent(proxyUrl);

    class ProxiedWebSocket extends Original {
      constructor(address, protocols, options) {
        const opts = options ? { ...options } : {};
        if (!opts.agent) opts.agent = agent;
        super(address, protocols, opts);
      }
    }

    // @discordjs/ws imports `ws` and captures `WebSocket` at module init, so this must
    // run before requiring discord.js.
    ws.WebSocket = ProxiedWebSocket;
  } catch (err) {
    // Don't hard-fail: the relay can still run in environments where Discord isn't blocked.
    console.error(`Failed to install WebSocket proxy (${proxyUrl}): ${String(err.message || err)}`);
  }
}

function buildRestAgentIfConfigured(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    const { ProxyAgent } = require("undici");
    return new ProxyAgent(proxyUrl);
  } catch (err) {
    console.error(`Failed to configure REST proxy (${proxyUrl}): ${String(err.message || err)}`);
    return null;
  }
}

const DISCORD_PROXY_URL = resolveDiscordProxyUrl();
installWsProxyIfConfigured(DISCORD_PROXY_URL);

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const DISCORD_REST_AGENT = buildRestAgentIfConfigured(DISCORD_PROXY_URL);

function parseCsv(value) {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

const CONFIG = {
  token: (process.env.DISCORD_BOT_TOKEN || "").trim(),
  codexBin: (process.env.CODEX_BIN || "codex").trim(),
  defaultWorkdir: path.resolve(process.env.CODEX_WORKDIR || "/root"),
  allowedWorkdirRoots: (() => {
    const roots = parseCsv(process.env.CODEX_ALLOWED_WORKDIR_ROOTS || "/root");
    return Array.from(roots).map((root) => path.resolve(root));
  })(),
  model: (process.env.CODEX_MODEL || "").trim(),
  sandbox: (process.env.CODEX_SANDBOX || "workspace-write").trim(),
  approvalPolicy: (
    process.env.CODEX_APPROVAL_POLICY ||
    process.env.CODEX_APPROVAL ||
    ""
  ).trim(),
  enableSearch: boolEnv("CODEX_ENABLE_SEARCH", true),
  skipGitRepoCheck: boolEnv("CODEX_SKIP_GIT_REPO_CHECK", true),
  configOverrides: (process.env.CODEX_CONFIG_OVERRIDES || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean),
  stateDir: path.resolve(process.env.RELAY_STATE_DIR || "/root/.codex-discord-relay"),
  stateFile: path.resolve(
    process.env.RELAY_STATE_FILE || "/root/.codex-discord-relay/sessions.json"
  ),
  maxReplyChars: Number(process.env.RELAY_MAX_REPLY_CHARS || 1800),
  allowAttachInGuilds: boolEnv("RELAY_ATTACH_ALLOW_GUILDS", false),
  allowedGuilds: parseCsv(process.env.DISCORD_ALLOWED_GUILDS || ""),
  allowedChannels: parseCsv(process.env.DISCORD_ALLOWED_CHANNELS || ""),
};

if (!CONFIG.token) {
  console.error("DISCORD_BOT_TOKEN is required.");
  process.exit(1);
}

const state = {
  version: 1,
  sessions: {},
};
let saveChain = Promise.resolve();
const queueByConversation = new Map();

function isSubPath(parentDir, childDir) {
  const relative = path.relative(parentDir, childDir);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isAllowedWorkdir(workdir) {
  return CONFIG.allowedWorkdirRoots.some((root) => isSubPath(root, workdir));
}

async function ensureStateLoaded() {
  await fsp.mkdir(CONFIG.stateDir, { recursive: true });
  try {
    const raw = await fsp.readFile(CONFIG.stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object") {
      state.version = Number(parsed.version || 1);
      state.sessions = parsed.sessions;
      return;
    }
  } catch {}
  await queueSaveState();
}

function queueSaveState() {
  saveChain = saveChain
    .then(async () => {
      const tmp = `${CONFIG.stateFile}.tmp`;
      await fsp.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await fsp.rename(tmp, CONFIG.stateFile);
    })
    .catch((err) => {
      console.error("Failed saving state:", err.message);
    });
  return saveChain;
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let idx = 0;
  while (idx < text.length) {
    let end = Math.min(idx + maxLen, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > idx + 400) end = nl;
    }
    chunks.push(text.slice(idx, end));
    idx = end;
  }
  return chunks;
}

function getConversationKey(message) {
  if (!message.guildId) return `dm:${message.author.id}`;
  if (message.channel && message.channel.isThread && message.channel.isThread()) {
    return `discord:${message.guildId}:thread:${message.channel.id}`;
  }
  return `discord:${message.guildId}:channel:${message.channelId}`;
}

function getSession(key) {
  const existing = state.sessions[key];
  if (existing && typeof existing === "object") return existing;
  const created = {
    threadId: null,
    workdir: CONFIG.defaultWorkdir,
    updatedAt: new Date().toISOString(),
  };
  state.sessions[key] = created;
  return created;
}

function extractPrompt(message, botUserId) {
  let text = message.content || "";
  if (message.guildId) {
    const mentionRegex = new RegExp(`<@!?${botUserId}>`, "g");
    text = text.replace(mentionRegex, " ");
  }
  return text.trim();
}

function parseCommand(prompt) {
  const match = prompt.match(/^\/(help|status|reset|workdir|attach)\b(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  return {
    name: match[1].toLowerCase(),
    arg: (match[2] || "").trim(),
  };
}

function buildCodexArgs(session, prompt) {
  const args = [];
  if (CONFIG.approvalPolicy) {
    // Codex CLI doesn't expose an approval flag; set it through config.
    args.push("-c", `approval_policy=${JSON.stringify(CONFIG.approvalPolicy)}`);
  }
  if (CONFIG.sandbox) args.push("--sandbox", CONFIG.sandbox);
  if (CONFIG.model) args.push("--model", CONFIG.model);
  if (CONFIG.enableSearch) args.push("--search");
  for (const override of CONFIG.configOverrides) {
    args.push("-c", override);
  }
  args.push("exec");
  if (session.threadId) {
    args.push("resume");
    if (CONFIG.skipGitRepoCheck) args.push("--skip-git-repo-check");
    args.push(session.threadId, "--json", prompt);
  } else {
    if (CONFIG.skipGitRepoCheck) args.push("--skip-git-repo-check");
    args.push("--cd", session.workdir || CONFIG.defaultWorkdir, "--json", prompt);
  }
  return args;
}

async function runCodex(session, prompt) {
  const args = buildCodexArgs(session, prompt);
  const child = spawn(CONFIG.codexBin, args, {
    cwd: session.workdir || CONFIG.defaultWorkdir,
    env: process.env,
  });

  let threadId = session.threadId || null;
  let finalText = "";
  const stderrLines = [];
  const rawStdoutLines = [];

  const stdoutRl = readline.createInterface({ input: child.stdout });
  stdoutRl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const evt = JSON.parse(trimmed);
      if (evt.type === "thread.started" && typeof evt.thread_id === "string") {
        threadId = evt.thread_id;
      }
      if (
        evt.type === "item.completed" &&
        evt.item &&
        evt.item.type === "agent_message" &&
        typeof evt.item.text === "string"
      ) {
        finalText = evt.item.text;
      }
      return;
    } catch {}
    rawStdoutLines.push(trimmed);
    if (rawStdoutLines.length > 60) rawStdoutLines.shift();
  });

  const stderrRl = readline.createInterface({ input: child.stderr });
  stderrRl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.includes("state db missing rollout path for thread")) return;
    stderrLines.push(trimmed);
    if (stderrLines.length > 80) stderrLines.shift();
  });

  const exitCode = await new Promise((resolve) => {
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    const detail = stderrLines.slice(-20).join("\n") || rawStdoutLines.slice(-20).join("\n");
    throw new Error(`codex exit ${exitCode}\n${detail}`.trim());
  }

  if (!finalText) {
    finalText = rawStdoutLines.join("\n").trim() || "No message returned by Codex.";
  }
  return { threadId, text: finalText };
}

async function enqueueConversation(key, task) {
  const prev = queueByConversation.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  queueByConversation.set(key, next);
  try {
    return await next;
  } finally {
    if (queueByConversation.get(key) === next) queueByConversation.delete(key);
  }
}

async function sendLongReply(baseMessage, text) {
  const chunks = splitMessage(text, Math.max(300, CONFIG.maxReplyChars));
  for (let i = 0; i < chunks.length; i += 1) {
    const content = chunks[i];
    if (i === 0) await baseMessage.reply(content);
    else await baseMessage.channel.send(content);
  }
}

async function handleCommand(message, session, command) {
  if (command.name === "help") {
    await message.reply(
      [
        "Commands:",
        "`/status` - show current Codex thread + workdir",
        "`/reset` - reset Codex conversation for this Discord context",
        "`/workdir <absolute_path>` - set workdir (resets thread)",
        "`/attach <thread_id>` - attach this Discord context to an existing Codex session (DM-only by default)",
      ].join("\n")
    );
    return true;
  }

  if (command.name === "status") {
    await message.reply(
      [
        `thread_id: ${session.threadId || "none"}`,
        `workdir: ${session.workdir || CONFIG.defaultWorkdir}`,
      ].join("\n")
    );
    return true;
  }

  if (command.name === "reset") {
    session.threadId = null;
    session.updatedAt = new Date().toISOString();
    await queueSaveState();
    await message.reply("Session reset. Next message starts a new Codex thread.");
    return true;
  }

  if (command.name === "workdir") {
    if (!command.arg) {
      await message.reply("Usage: `/workdir /absolute/path`");
      return true;
    }
    const resolved = path.resolve(command.arg);
    if (!path.isAbsolute(resolved)) {
      await message.reply("Workdir must be an absolute path.");
      return true;
    }
    try {
      const st = await fsp.stat(resolved);
      if (!st.isDirectory()) {
        await message.reply("Workdir is not a directory.");
        return true;
      }
    } catch {
      await message.reply("Workdir does not exist.");
      return true;
    }
    if (!isAllowedWorkdir(resolved)) {
      await message.reply(
        `Workdir not allowed. Allowed roots: ${CONFIG.allowedWorkdirRoots.join(", ")}`
      );
      return true;
    }
    session.workdir = resolved;
    session.threadId = null;
    session.updatedAt = new Date().toISOString();
    await queueSaveState();
    await message.reply(`Workdir set to \`${resolved}\`. Session reset.`);
    return true;
  }

  if (command.name === "attach") {
    if (!command.arg) {
      await message.reply("Usage: `/attach <thread_id>`");
      return true;
    }
    if (message.guildId && !CONFIG.allowAttachInGuilds) {
      await message.reply("For safety, `/attach` is DM-only. DM me with `/attach <thread_id>`.");
      return true;
    }
    const id = command.arg.split(/\s+/)[0];
    if (!/^[0-9a-zA-Z_-][0-9a-zA-Z_.:-]{5,127}$/.test(id)) {
      await message.reply("That doesn't look like a valid Codex session/thread id.");
      return true;
    }
    session.threadId = id;
    session.updatedAt = new Date().toISOString();
    await queueSaveState();
    await message.reply(`Attached. thread_id is now: \`${id}\``);
    return true;
  }

  return false;
}

async function main() {
  await ensureStateLoaded();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
    ...(DISCORD_REST_AGENT ? { rest: { agent: DISCORD_REST_AGENT } } : {}),
  });

  client.once("clientReady", () => {
    console.log(`codex-discord-relay connected as ${client.user.tag}`);
  });

  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;
      const isDm = !message.guildId;

      if (!isDm && CONFIG.allowedGuilds.size > 0 && !CONFIG.allowedGuilds.has(message.guildId)) {
        return;
      }
      // Channel allowlist is intended for guild channels; DMs have dynamic channel ids.
      if (!isDm && CONFIG.allowedChannels.size > 0 && !CONFIG.allowedChannels.has(message.channelId)) return;

      if (!isDm) {
        const mentioned = message.mentions.has(client.user.id);
        if (!mentioned) return;
      }

      const prompt = extractPrompt(message, client.user.id);
      if (!prompt) {
        await message.reply("Send a prompt after mentioning me, or use `/help`.");
        return;
      }

      const key = getConversationKey(message);
      const session = getSession(key);

      const command = parseCommand(prompt);
      if (command) {
        await enqueueConversation(key, async () => handleCommand(message, session, command));
        return;
      }

      const pendingMsg = await message.reply("Running Codex...");
      await enqueueConversation(key, async () => {
        try {
          await message.channel.sendTyping();
          const result = await runCodex(session, prompt);
          session.threadId = result.threadId || session.threadId;
          session.updatedAt = new Date().toISOString();
          await queueSaveState();

          const answer = result.text || "No response.";
          const chunks = splitMessage(answer, Math.max(300, CONFIG.maxReplyChars));
          await pendingMsg.edit(chunks[0]);
          for (let i = 1; i < chunks.length; i += 1) {
            await message.channel.send(chunks[i]);
          }
        } catch (err) {
          const detail = String(err.message || err).slice(0, 1800);
          await pendingMsg.edit(`Codex error:\n\`\`\`\n${detail}\n\`\`\``);
        }
      });
    } catch (err) {
      try {
        await sendLongReply(message, `Relay error: ${String(err.message || err)}`);
      } catch {}
    }
  });

  const shutdown = async () => {
    try {
      await queueSaveState();
    } catch {}
    try {
      await client.destroy();
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await client.login(CONFIG.token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
