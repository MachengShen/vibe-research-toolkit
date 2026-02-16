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

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function normalizeAgentProvider(value) {
  const v = String(value || "codex").trim().toLowerCase();
  return v === "claude" ? "claude" : "codex";
}

const ALLOWED_GUILDS = parseCsv(process.env.DISCORD_ALLOWED_GUILDS || "");
const ALLOWED_CHANNELS = parseCsv(process.env.DISCORD_ALLOWED_CHANNELS || "");

const RELAY_STATE_DIR = path.resolve(process.env.RELAY_STATE_DIR || "/root/.codex-discord-relay");
const RELAY_STATE_FILE = path.resolve(
  process.env.RELAY_STATE_FILE || path.join(RELAY_STATE_DIR, "sessions.json")
);
const RELAY_UPLOAD_ROOT_DIR = path.resolve(
  process.env.RELAY_UPLOAD_ROOT_DIR || path.join(RELAY_STATE_DIR, "uploads")
);

const CONFIG = {
  token: (process.env.DISCORD_BOT_TOKEN || "").trim(),
  agentProvider: normalizeAgentProvider(process.env.RELAY_AGENT_PROVIDER || process.env.AGENT_PROVIDER),
  codexBin: (process.env.CODEX_BIN || "codex").trim(),
  claudeBin: (process.env.CLAUDE_BIN || "claude").trim(),
  defaultWorkdir: path.resolve(process.env.CODEX_WORKDIR || "/root"),
  allowedWorkdirRoots: (() => {
    const roots = parseCsv(process.env.CODEX_ALLOWED_WORKDIR_ROOTS || "/root");
    return Array.from(roots).map((root) => path.resolve(root));
  })(),
  model: (process.env.CODEX_MODEL || "").trim(),
  claudeModel: (process.env.CLAUDE_MODEL || process.env.CODEX_MODEL || "").trim(),
  claudePermissionMode: (process.env.CLAUDE_PERMISSION_MODE || "").trim(),
  agentTimeoutMs: Math.max(0, intEnv("RELAY_AGENT_TIMEOUT_MS", 10 * 60 * 1000)),
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
  stateDir: RELAY_STATE_DIR,
  stateFile: RELAY_STATE_FILE,
  maxReplyChars: Number(process.env.RELAY_MAX_REPLY_CHARS || 1800),
  allowAttachInGuilds: boolEnv("RELAY_ATTACH_ALLOW_GUILDS", false),
  allowedGuilds: ALLOWED_GUILDS,
  allowedChannels: ALLOWED_CHANNELS,
  // In threads, it's usually a 1:1 working context. Default to auto-responding there when
  // the relay is already restricted via DISCORD_ALLOWED_CHANNELS; otherwise keep mention-gating.
  threadAutoRespond: boolEnv("RELAY_THREAD_AUTO_RESPOND", ALLOWED_CHANNELS.size > 0),

  uploadEnabled: boolEnv("RELAY_UPLOAD_ENABLED", true),
  uploadRootDir: RELAY_UPLOAD_ROOT_DIR,
  uploadAllowOutsideConversation: boolEnv("RELAY_UPLOAD_ALLOW_OUTSIDE_CONVERSATION", false),
  uploadAllowedRoots: (() => {
    const raw = process.env.RELAY_UPLOAD_ALLOWED_ROOTS;
    const roots = raw == null || raw.trim() === "" ? new Set([RELAY_UPLOAD_ROOT_DIR]) : parseCsv(raw);
    return Array.from(roots).map((root) => path.resolve(root));
  })(),
  uploadMaxFiles: Math.max(0, intEnv("RELAY_UPLOAD_MAX_FILES", 3)),
  uploadMaxBytes: Math.max(0, intEnv("RELAY_UPLOAD_MAX_BYTES", 8 * 1024 * 1024)),
};

const AGENT_LABEL = CONFIG.agentProvider === "claude" ? "Claude" : "Codex";
const AGENT_SESSION_LABEL = CONFIG.agentProvider === "claude" ? "session_id" : "thread_id";

if (!CONFIG.token) {
  console.error("DISCORD_BOT_TOKEN is required.");
  process.exit(1);
}

if (!process.env.RELAY_UPLOAD_ROOT_DIR) process.env.RELAY_UPLOAD_ROOT_DIR = CONFIG.uploadRootDir;

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

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

function safeUploadDirName(key) {
  return String(key || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180) || "unknown";
}

function getConversationUploadDir(conversationKey) {
  return path.join(CONFIG.uploadRootDir, safeUploadDirName(conversationKey));
}

function normalizeUploadRawPath(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^file:\/\//i, "");
  s = s.replace(/^file:/i, "");
  return s.trim();
}

function resolveUploadPath(rawPath, baseDir) {
  const cleaned = normalizeUploadRawPath(rawPath);
  if (!cleaned) return null;
  if (path.isAbsolute(cleaned)) return path.resolve(cleaned);
  return path.resolve(baseDir, cleaned);
}

function isAllowedUploadPath(resolvedPath, conversationUploadDir) {
  if (CONFIG.uploadAllowOutsideConversation) {
    return CONFIG.uploadAllowedRoots.some((root) => isSubPath(root, resolvedPath));
  }
  return isSubPath(conversationUploadDir, resolvedPath);
}

function isImagePath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

function extractUploadMarkers(text) {
  const re = /\[\[upload:([^\]]+)\]\]/gi;
  const rawText = String(text || "");
  let out = "";
  let last = 0;
  const rawPaths = [];
  let m;
  while ((m = re.exec(rawText)) !== null) {
    out += rawText.slice(last, m.index);
    const raw = normalizeUploadRawPath(m[1] || "");
    if (raw) {
      rawPaths.push(raw);
      out += `[uploaded:${path.basename(raw)}]`;
    } else {
      out += m[0];
    }
    last = re.lastIndex;
  }
  out += rawText.slice(last);
  return { text: out, rawPaths };
}

async function resolveAndValidateUploads(conversationKey, rawPaths) {
  const conversationDir = getConversationUploadDir(conversationKey);
  await fsp.mkdir(conversationDir, { recursive: true });

  const files = [];
  const errors = [];
  const seen = new Set();

  const maxFiles = Math.max(0, CONFIG.uploadMaxFiles);
  const maxBytes = Math.max(0, CONFIG.uploadMaxBytes);

  for (const raw of rawPaths || []) {
    if (maxFiles > 0 && files.length >= maxFiles) break;
    const resolved = resolveUploadPath(raw, conversationDir);
    if (!resolved) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    if (!isAllowedUploadPath(resolved, conversationDir)) {
      errors.push(`Upload blocked (path not allowed): \`${path.basename(resolved)}\``);
      continue;
    }
    if (!isImagePath(resolved)) {
      errors.push(`Upload blocked (not an image type): \`${path.basename(resolved)}\``);
      continue;
    }

    let st;
    try {
      st = await fsp.stat(resolved);
    } catch {
      errors.push(`Upload missing: \`${path.basename(resolved)}\``);
      continue;
    }
    if (!st.isFile()) {
      errors.push(`Upload is not a file: \`${path.basename(resolved)}\``);
      continue;
    }
    if (maxBytes > 0 && st.size > maxBytes) {
      errors.push(`Upload too large (${st.size} bytes): \`${path.basename(resolved)}\``);
      continue;
    }

    files.push({ attachment: resolved, name: path.basename(resolved) });
  }

  if (maxFiles > 0 && (rawPaths || []).length > maxFiles) {
    errors.push(`Upload limit: max ${maxFiles} file(s).`);
  }

  return { conversationDir, files, errors };
}

async function ensureStateLoaded() {
  await fsp.mkdir(CONFIG.stateDir, { recursive: true });
  if (CONFIG.uploadEnabled) {
    await fsp.mkdir(CONFIG.uploadRootDir, { recursive: true });
  }
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
  const match = prompt.match(/^\/(help|status|reset|workdir|attach|upload)\b(?:\s+([\s\S]+))?$/i);
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

function waitForChildExit(child, label) {
  const timeoutMs = Math.max(0, CONFIG.agentTimeoutMs);
  return new Promise((resolve, reject) => {
    let done = false;
    let timeout = null;
    let killTimer = null;

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      fn(value);
    };

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {}
        killTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
        }, 5000);
        finish(reject, new Error(`${label} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.on("error", (err) => finish(reject, err));
    child.on("close", (code) => finish(resolve, typeof code === "number" ? code : 1));
  });
}

async function runCodex(session, prompt, extraEnv) {
  const args = buildCodexArgs(session, prompt);
  const env =
    extraEnv && typeof extraEnv === "object" ? { ...process.env, ...extraEnv } : process.env;
  const child = spawn(CONFIG.codexBin, args, {
    cwd: session.workdir || CONFIG.defaultWorkdir,
    env,
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

  const exitCode = await waitForChildExit(child, "codex");

  if (exitCode !== 0) {
    const detail = stderrLines.slice(-20).join("\n") || rawStdoutLines.slice(-20).join("\n");
    throw new Error(`codex exit ${exitCode}\n${detail}`.trim());
  }

  if (!finalText) {
    finalText = rawStdoutLines.join("\n").trim() || "No message returned by Codex.";
  }
  return { threadId, text: finalText };
}

function buildClaudeArgs(session, prompt) {
  const args = ["-p", "--output-format", "json"];
  if (CONFIG.claudeModel) args.push("--model", CONFIG.claudeModel);
  if (CONFIG.claudePermissionMode) args.push("--permission-mode", CONFIG.claudePermissionMode);
  if (session.threadId) args.push("--resume", session.threadId);
  args.push(prompt);
  return args;
}

function extractClaudeTextFromJson(parsed, fallbackText) {
  if (!parsed || typeof parsed !== "object") return fallbackText;
  if (typeof parsed.result === "string" && parsed.result.trim()) return parsed.result;
  if (parsed.message && Array.isArray(parsed.message.content)) {
    const text = parsed.message.content
      .filter((part) => part && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return fallbackText;
}

async function runClaude(session, prompt, extraEnv) {
  const args = buildClaudeArgs(session, prompt);
  const env =
    extraEnv && typeof extraEnv === "object" ? { ...process.env, ...extraEnv } : process.env;
  const child = spawn(CONFIG.claudeBin, args, {
    cwd: session.workdir || CONFIG.defaultWorkdir,
    env,
  });

  let stdout = "";
  const stderrLines = [];
  const stderrRl = readline.createInterface({ input: child.stderr });
  stderrRl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    stderrLines.push(trimmed);
    if (stderrLines.length > 80) stderrLines.shift();
  });
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk || "");
    if (stdout.length > 1024 * 1024) stdout = stdout.slice(-1024 * 1024);
  });

  const exitCode = await waitForChildExit(child, "claude");

  const stdoutTrimmed = stdout.trim();
  if (exitCode !== 0) {
    const detail = stderrLines.slice(-20).join("\n") || stdoutTrimmed.slice(-4000);
    throw new Error(`claude exit ${exitCode}\n${detail}`.trim());
  }

  let parsed = null;
  if (stdoutTrimmed) {
    const lines = stdoutTrimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        parsed = JSON.parse(lines[i]);
        break;
      } catch {}
    }
    if (!parsed) {
      try {
        parsed = JSON.parse(stdoutTrimmed);
      } catch {}
    }
  }

  const fallbackText = stdoutTrimmed || "No message returned by Claude.";
  const text = extractClaudeTextFromJson(parsed, fallbackText);
  const threadId =
    parsed && typeof parsed.session_id === "string" && parsed.session_id
      ? parsed.session_id
      : session.threadId || null;
  return { threadId, text };
}

async function runAgent(session, prompt, extraEnv) {
  if (CONFIG.agentProvider === "claude") {
    return runClaude(session, prompt, extraEnv);
  }
  return runCodex(session, prompt, extraEnv);
}

function isStaleThreadResumeError(err) {
  const msg = String((err && err.message) || err || "");
  if (!msg) return false;
  return (
    msg.includes("failed to parse thread ID from rollout file") ||
    msg.includes("state db missing rollout path for thread") ||
    msg.includes("No conversation found with session ID")
  );
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

async function handleCommand(message, session, command, conversationKey) {
  if (command.name === "help") {
    await message.reply(
      [
        "Commands:",
        `\`/status\` - show current ${AGENT_LABEL} session + workdir`,
        `\`/reset\` - reset ${AGENT_LABEL} conversation for this Discord context`,
        "`/workdir <absolute_path>` - set workdir (resets thread)",
        `\`/attach <session_id>\` - attach this Discord context to an existing ${AGENT_LABEL} session (DM-only by default)`,
        "`/upload <path>` - upload an image from this conversation's upload directory",
      ].join("\n")
    );
    return true;
  }

  if (command.name === "status") {
    const key = conversationKey || getConversationKey(message);
    const uploadDir = getConversationUploadDir(key);
    await message.reply(
      [
        `${AGENT_SESSION_LABEL}: ${session.threadId || "none"}`,
        `workdir: ${session.workdir || CONFIG.defaultWorkdir}`,
        `upload_dir: ${uploadDir}`,
      ].join("\n")
    );
    return true;
  }

  if (command.name === "reset") {
    session.threadId = null;
    session.updatedAt = new Date().toISOString();
    await queueSaveState();
    await message.reply(`Session reset. Next message starts a new ${AGENT_LABEL} session.`);
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
      await message.reply("Usage: `/attach <session_id>`");
      return true;
    }
    if (message.guildId && !CONFIG.allowAttachInGuilds) {
      await message.reply("For safety, `/attach` is DM-only. DM me with `/attach <session_id>`.");
      return true;
    }
    const id = command.arg.split(/\s+/)[0];
    if (!/^[0-9a-zA-Z_-][0-9a-zA-Z_.:-]{5,127}$/.test(id)) {
      await message.reply(`That doesn't look like a valid ${AGENT_LABEL} session id.`);
      return true;
    }
    session.threadId = id;
    session.updatedAt = new Date().toISOString();
    await queueSaveState();
    await message.reply(`Attached. ${AGENT_SESSION_LABEL} is now: \`${id}\``);
    return true;
  }

  if (command.name === "upload") {
    if (!CONFIG.uploadEnabled) {
      await message.reply("Uploads are disabled on this relay.");
      return true;
    }
    if (!command.arg) {
      await message.reply("Usage: `/upload <path>` (relative to this conversation's upload_dir, or absolute within it)");
      return true;
    }
    const key = conversationKey || getConversationKey(message);
    const { conversationDir, files, errors } = await resolveAndValidateUploads(key, [command.arg]);
    if (files.length === 0) {
      const detail = errors.length > 0 ? `\n${errors.map((e) => `- ${e}`).join("\n")}` : "";
      await message.reply(`No valid image to upload.\nupload_dir: \`${conversationDir}\`${detail}`);
      return true;
    }

    const names = files.map((f) => `\`${f.name}\``).join(", ");
    await message.reply({ content: `Uploaded: ${names}`, files });
    if (errors.length > 0) {
      await message.channel.send(`Upload notes:\n${errors.map((e) => `- ${e}`).join("\n")}`);
    }
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
    console.log(`codex-discord-relay (${CONFIG.agentProvider}) connected as ${client.user.tag}`);
  });

  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;
      const isDm = !message.guildId;
      const isThread = Boolean(message.channel && message.channel.isThread && message.channel.isThread());
      const threadParentId = isThread && message.channel && typeof message.channel.parentId === "string" ? message.channel.parentId : null;

      if (!isDm && CONFIG.allowedGuilds.size > 0 && !CONFIG.allowedGuilds.has(message.guildId)) {
        return;
      }
      // Channel allowlist is intended for guild channels. Threads have their own ids, so
      // allow threads under an allowed parent channel as well.
      if (!isDm && CONFIG.allowedChannels.size > 0) {
        const allowed =
          CONFIG.allowedChannels.has(message.channelId) ||
          (threadParentId && CONFIG.allowedChannels.has(threadParentId));
        if (!allowed) return;
      }

      if (!isDm) {
        const mentioned = message.mentions.has(client.user.id);
        if (!mentioned && !(isThread && CONFIG.threadAutoRespond)) return;
      }

      const prompt = extractPrompt(message, client.user.id);
      if (!prompt) {
        await message.reply(
          isDm || (isThread && CONFIG.threadAutoRespond)
            ? "Send a prompt, or use `/help`."
            : "Send a prompt after mentioning me, or use `/help`."
        );
        return;
      }

      // Make sure the bot is joined to threads before trying to type/reply.
      if (!isDm && isThread && message.channel && typeof message.channel.join === "function" && message.channel.joinable) {
        message.channel.join().catch(() => {});
      }

      const key = getConversationKey(message);
      const session = getSession(key);

      const command = parseCommand(prompt);
      if (command) {
        await enqueueConversation(key, async () => handleCommand(message, session, command, key));
        return;
      }

      const pendingMsg = await message.reply(`Running ${AGENT_LABEL}...`);
      await enqueueConversation(key, async () => {
        try {
          await message.channel.sendTyping();
          const uploadDir = getConversationUploadDir(key);
          if (CONFIG.uploadEnabled) {
            await fsp.mkdir(uploadDir, { recursive: true });
          }
          let result;
          try {
            result = await runAgent(
              session,
              prompt,
              CONFIG.uploadEnabled ? { RELAY_UPLOAD_DIR: uploadDir } : null
            );
          } catch (runErr) {
            if (!session.threadId || !isStaleThreadResumeError(runErr)) throw runErr;
            const staleThreadId = session.threadId;
            session.threadId = null;
            session.updatedAt = new Date().toISOString();
            await queueSaveState();
            result = await runAgent(
              session,
              prompt,
              CONFIG.uploadEnabled ? { RELAY_UPLOAD_DIR: uploadDir } : null
            );
            result.text =
              `Note: previous ${AGENT_LABEL} session \`${staleThreadId}\` could not be resumed, so I started a new session.\n\n` +
              (result.text || "");
          }
          session.threadId = result.threadId || session.threadId;
          session.updatedAt = new Date().toISOString();
          await queueSaveState();

          let answer = result.text || "No response.";
          let uploadPaths = [];
          if (CONFIG.uploadEnabled) {
            const parsed = extractUploadMarkers(answer);
            answer = parsed.text;
            uploadPaths = parsed.rawPaths || [];
          }

          const chunks = splitMessage(answer, Math.max(300, CONFIG.maxReplyChars));
          await pendingMsg.edit(chunks[0]);
          for (let i = 1; i < chunks.length; i += 1) {
            await message.channel.send(chunks[i]);
          }

          if (CONFIG.uploadEnabled && uploadPaths.length > 0) {
            const { files, errors } = await resolveAndValidateUploads(key, uploadPaths);
            if (files.length > 0) {
              for (let i = 0; i < files.length; i += 10) {
                const batch = files.slice(i, i + 10);
                const names = batch.map((f) => `\`${f.name}\``).join(", ");
                await message.channel.send({ content: `Uploaded: ${names}`, files: batch });
              }
            }
            if (errors.length > 0) {
              await message.channel.send(`Upload notes:\n${errors.map((e) => `- ${e}`).join("\n")}`);
            }
          }
        } catch (err) {
          const detail = String(err.message || err).slice(0, 1800);
          await pendingMsg.edit(`${AGENT_LABEL} error:\n\`\`\`\n${detail}\n\`\`\``);
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
