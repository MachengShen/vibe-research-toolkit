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

function parseContextSpecEntry(rawEntry) {
  const raw = String(rawEntry || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(headtail|head|tail):(.*)$/i);
  if (!match) {
    return { mode: "head", specPath: raw, rawSpec: raw };
  }
  const specPath = String(match[2] || "").trim();
  if (!specPath) return null;
  return {
    mode: String(match[1] || "head").toLowerCase(),
    specPath,
    rawSpec: raw,
  };
}

function parseContextSpecs(rawValue) {
  const raw = String(rawValue || "");
  if (!raw.trim()) return [];
  return raw
    .split(";")
    .map((entry) => parseContextSpecEntry(entry))
    .filter((entry) => Boolean(entry));
}

function parseToolList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeAgentProvider(value) {
  const v = String(value || "codex").trim().toLowerCase();
  return v === "claude" ? "claude" : "codex";
}

function resolveClaudePermissionMode() {
  const explicit = (process.env.CLAUDE_PERMISSION_MODE || "").trim();
  if (explicit) return explicit;
  // Claude's "bypassPermissions" mode maps to a dangerous flag that is blocked under root.
  // Default to acceptEdits when relay runs as root to avoid silent hangs/failures.
  if (typeof process.getuid === "function" && process.getuid() === 0) return "acceptEdits";
  return "";
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
  claudePermissionMode: resolveClaudePermissionMode(),
  claudeAllowedTools: parseToolList(process.env.CLAUDE_ALLOWED_TOOLS || ""),
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

  contextEnabled: boolEnv("RELAY_CONTEXT_ENABLED", true),
  contextEveryTurn: boolEnv("RELAY_CONTEXT_EVERY_TURN", false),
  contextVersion: Math.max(1, intEnv("RELAY_CONTEXT_VERSION", 1)),
  contextMaxChars: Math.max(200, intEnv("RELAY_CONTEXT_MAX_CHARS", 6000)),
  contextMaxCharsPerFile: Math.max(
    200,
    intEnv("RELAY_CONTEXT_MAX_CHARS_PER_FILE", intEnv("RELAY_CONTEXT_MAX_CHARS", 6000))
  ),
  contextSpecs: parseContextSpecs(process.env.RELAY_CONTEXT_FILE || ""),

  progressEnabled: boolEnv("RELAY_PROGRESS", true),
  progressMinEditMs: Math.max(500, intEnv("RELAY_PROGRESS_MIN_EDIT_MS", 5000)),
  progressHeartbeatMs: Math.max(1000, intEnv("RELAY_PROGRESS_HEARTBEAT_MS", 20000)),
  progressMaxLines: Math.max(1, intEnv("RELAY_PROGRESS_MAX_LINES", 6)),
  progressShowCommands: boolEnv("RELAY_PROGRESS_SHOW_COMMANDS", false),
};

const AGENT_LABEL = CONFIG.agentProvider === "claude" ? "Claude" : "Codex";
const AGENT_SESSION_LABEL = CONFIG.agentProvider === "claude" ? "session_id" : "thread_id";

if (
  CONFIG.agentProvider === "claude" &&
  !process.env.CLAUDE_PERMISSION_MODE &&
  CONFIG.claudePermissionMode === "acceptEdits"
) {
  console.warn(
    "CLAUDE_PERMISSION_MODE not set; defaulting to acceptEdits because relay is running as root."
  );
}

if (!CONFIG.token) {
  console.error("DISCORD_BOT_TOKEN is required.");
  process.exit(1);
}

if (!process.env.RELAY_UPLOAD_ROOT_DIR) process.env.RELAY_UPLOAD_ROOT_DIR = CONFIG.uploadRootDir;

function logRelayEvent(event, meta = {}) {
  try {
    console.log(
      JSON.stringify({
        subsystem: "relay-runtime",
        event,
        at: new Date().toISOString(),
        ...meta,
      })
    );
  } catch {
    try {
      console.log(`[relay-runtime] ${event}`);
    } catch {}
  }
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

function summarizeContextDiagnostic(diag) {
  const spec = diag && diag.rawSpec ? diag.rawSpec : "(unknown)";
  const resolved = diag && diag.resolvedPath ? diag.resolvedPath : "(unresolved)";
  if (!diag || !diag.exists) {
    const err = diag && diag.error ? ` error=${diag.error}` : "";
    return `- ${spec} -> ${resolved} [missing${err}]`;
  }
  if (!diag.isFile) {
    return `- ${spec} -> ${resolved} [not-file]`;
  }
  const parts = [
    `size=${diag.size}`,
    diag.mtimeIso ? `mtime=${diag.mtimeIso}` : null,
    `loaded=${diag.loadedChars}`,
    `injected=${diag.injectedChars || 0}`,
    diag.truncated ? "truncated" : null,
  ].filter(Boolean);
  return `- ${spec} -> ${resolved} [${parts.join(" ")}]`;
}

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function cleanProgressText(value, maxChars = 160) {
  let text = String(value || "");
  if (!text) return "";
  text = text.replace(/\r?\n+/g, " ");
  text = text.replace(/`+/g, "");
  text = text.replace(/\*\*/g, "");
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function humanizeStepType(value) {
  const raw = cleanProgressText(value, 80).toLowerCase();
  if (!raw) return "step";
  return raw.replace(/[_-]+/g, " ");
}

function commandPreview(command) {
  const raw = cleanProgressText(command, 140);
  if (!raw) return "";
  if (CONFIG.progressShowCommands) return raw;
  const firstToken = raw.split(/\s+/)[0] || "";
  return path.basename(firstToken) || "";
}

function emitProgress(onProgress, text) {
  if (typeof onProgress !== "function") return;
  const cleaned = cleanProgressText(text, 180);
  if (!cleaned) return;
  try {
    onProgress(cleaned);
  } catch {}
}

function summarizeCodexItemProgress(item, phase) {
  if (!item || typeof item !== "object") return null;
  const kind = String(item.type || "")
    .trim()
    .toLowerCase();
  if (!kind || kind === "agent_message") return null;

  if (kind === "reasoning") {
    if (phase === "completed" && typeof item.text === "string") {
      const thought = cleanProgressText(item.text, 140);
      if (thought) return `Thinking: ${thought}`;
    }
    return phase === "started" ? "Thinking" : null;
  }

  if (kind === "command_execution") {
    const preview = commandPreview(item.command);
    if (phase === "started" || item.status === "in_progress") {
      if (CONFIG.progressShowCommands && preview) return `Running shell command: ${preview}`;
      if (preview) return `Running shell command (${preview})`;
      return "Running shell command";
    }
    const exitCode =
      item.exit_code == null || item.exit_code === "" ? "" : ` (exit ${String(item.exit_code)})`;
    return `Shell command finished${exitCode}`;
  }

  if (kind === "file_change") {
    return phase === "started" ? "Updating files" : "Finished updating files";
  }

  const label = humanizeStepType(kind);
  return phase === "started" ? `Working on ${label}` : `Completed ${label}`;
}

function summarizeCodexProgressEvent(evt) {
  if (!evt || typeof evt !== "object") return null;
  if (evt.type === "thread.started") {
    if (typeof evt.thread_id === "string" && evt.thread_id) {
      return `Session started (${evt.thread_id})`;
    }
    return "Session started";
  }
  if (evt.type === "turn.started") return "Analyzing request";
  if (evt.type === "turn.completed") return "Preparing final response";
  if (evt.type === "item.started") return summarizeCodexItemProgress(evt.item, "started");
  if (evt.type === "item.completed") return summarizeCodexItemProgress(evt.item, "completed");
  return null;
}

function summarizeClaudeProgressEvent(evt, toolNamesById) {
  if (!evt || typeof evt !== "object") return null;
  const type = String(evt.type || "").toLowerCase();

  if (type === "system" && evt.subtype === "init") {
    if (typeof evt.session_id === "string" && evt.session_id) {
      return `Session started (${evt.session_id})`;
    }
    return "Session started";
  }

  if (type === "assistant") {
    const msg = evt.message && typeof evt.message === "object" ? evt.message : null;
    const content = msg && Array.isArray(msg.content) ? msg.content : [];
    let thinkingLine = null;

    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "tool_use") {
        const toolName = cleanProgressText(part.name || "tool", 40) || "tool";
        if (typeof part.id === "string" && part.id) {
          toolNamesById.set(part.id, toolName);
        }
        if (
          CONFIG.progressShowCommands &&
          toolName.toLowerCase() === "bash" &&
          part.input &&
          typeof part.input.command === "string"
        ) {
          const cmd = cleanProgressText(part.input.command, 120);
          if (cmd) return `Running tool: ${toolName} (${cmd})`;
        }
        if (part.input && typeof part.input.description === "string") {
          const desc = cleanProgressText(part.input.description, 90);
          if (desc) return `Running tool: ${toolName} (${desc})`;
        }
        return `Running tool: ${toolName}`;
      }
      if (part.type === "text" && !thinkingLine && typeof part.text === "string") {
        const text = cleanProgressText(part.text, 140);
        if (text && text.length >= 16 && !/^(ok|done|yes|no)$/i.test(text)) {
          thinkingLine = `Thinking: ${text}`;
        }
      }
    }

    return thinkingLine;
  }

  if (type === "user") {
    const msg = evt.message && typeof evt.message === "object" ? evt.message : null;
    const content = msg && Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (!part || typeof part !== "object" || part.type !== "tool_result") continue;
      const toolId = typeof part.tool_use_id === "string" ? part.tool_use_id : "";
      const toolName = cleanProgressText(toolNamesById.get(toolId) || "tool", 40) || "tool";
      return part.is_error ? `Tool failed: ${toolName}` : `Tool finished: ${toolName}`;
    }
    return null;
  }

  if (type === "result") return "Preparing final response";
  return null;
}

function createProgressReporter(pendingMsg, conversationKey) {
  if (!CONFIG.progressEnabled || !pendingMsg || typeof pendingMsg.edit !== "function") {
    return {
      note() {},
      async stop() {},
    };
  }

  const startedAt = Date.now();
  const maxLines = Math.max(1, CONFIG.progressMaxLines);
  const keepLines = Math.max(maxLines * 3, maxLines);
  const minEditMs = Math.max(500, CONFIG.progressMinEditMs);
  const heartbeatMs = Math.max(minEditMs, CONFIG.progressHeartbeatMs);
  const lines = [];

  let dirty = true;
  let stopped = false;
  let lastEditAt = 0;
  let lastRendered = "";
  let delayedFlushTimer = null;
  let editChain = Promise.resolve();

  function render() {
    const elapsed = formatElapsed(Date.now() - startedAt);
    const header = `Running ${AGENT_LABEL}... (elapsed ${elapsed})`;
    const visible = lines.slice(-maxLines);
    if (visible.length === 0) return header;
    return `${header}\n${visible.map((line) => `- ${line}`).join("\n")}`;
  }

  function queueFlush(force = false) {
    if (stopped) return;
    editChain = editChain
      .catch(() => {})
      .then(async () => {
        if (stopped) return;
        const now = Date.now();
        const since = now - lastEditAt;
        const dueHeartbeat = since >= heartbeatMs;
        const dueDirty = dirty && since >= minEditMs;
        if (!force && !dueHeartbeat && !dueDirty) return;

        const content = render();
        if (content === lastRendered && !dueHeartbeat && !force) return;

        try {
          await pendingMsg.edit(content);
          lastRendered = content;
          lastEditAt = Date.now();
          dirty = false;
        } catch (err) {
          logRelayEvent("progress.edit.error", {
            conversationKey,
            provider: CONFIG.agentProvider,
            error: String(err && err.message ? err.message : err).slice(0, 240),
          });
        }
      });
  }

  function scheduleDelayedFlush() {
    if (stopped || delayedFlushTimer) return;
    const waitMs = Math.max(0, minEditMs - (Date.now() - lastEditAt));
    delayedFlushTimer = setTimeout(() => {
      delayedFlushTimer = null;
      queueFlush(false);
    }, waitMs);
  }

  function note(text) {
    if (stopped) return;
    const cleaned = cleanProgressText(text, 180);
    if (!cleaned) return;
    if (lines[lines.length - 1] === cleaned) return;
    lines.push(cleaned);
    if (lines.length > keepLines) lines.splice(0, lines.length - keepLines);
    dirty = true;

    if (Date.now() - lastEditAt >= minEditMs) queueFlush(false);
    else scheduleDelayedFlush();
  }

  const heartbeatTick = setInterval(() => {
    queueFlush(false);
  }, Math.max(1000, Math.min(minEditMs, 5000)));

  note("Queued request");
  queueFlush(true);

  return {
    note,
    stop: async () => {
      stopped = true;
      if (delayedFlushTimer) clearTimeout(delayedFlushTimer);
      clearInterval(heartbeatTick);
      try {
        await editChain;
      } catch {}
    },
  };
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
    contextVersion: 0,
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
  const match = prompt.match(/^\/(help|status|reset|workdir|attach|upload|context)\b(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  return {
    name: match[1].toLowerCase(),
    arg: (match[2] || "").trim(),
  };
}

function getSessionContextVersion(session) {
  if (!session || typeof session !== "object") return 0;
  const n = Number(session.contextVersion || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function shouldInjectRelayContext(session) {
  if (!CONFIG.contextEnabled) return false;
  if (CONFIG.contextEveryTurn) return true;
  return getSessionContextVersion(session) < CONFIG.contextVersion;
}

function resolveContextSpecPath(specPath, session) {
  const baseWorkdir = session && session.workdir ? session.workdir : CONFIG.defaultWorkdir;
  if (path.isAbsolute(specPath)) return path.resolve(specPath);
  return path.resolve(baseWorkdir, specPath);
}

function truncateContextByMode(rawText, mode, maxChars) {
  const text = String(rawText || "");
  if (!text) return { text: "", truncated: false };
  if (maxChars <= 0) return { text: "", truncated: text.length > 0 };
  if (text.length <= maxChars) return { text, truncated: false };

  const truncSuffix = "\n...[context truncated]";
  const truncPrefix = "...[context truncated]\n";
  const truncMiddleSuffix = "\n...[context truncated middle]";
  const headTailJoiner = "\n...[snip]...\n";

  // Keep oldest content for head mode and append a marker.
  const truncateHead = () => {
    if (truncSuffix.length >= maxChars) return truncSuffix.slice(0, maxChars);
    const keep = Math.max(0, maxChars - truncSuffix.length);
    return `${text.slice(0, keep)}${truncSuffix}`;
  };

  // Keep newest content for tail mode and prefix a marker.
  const truncateTail = () => {
    if (truncPrefix.length >= maxChars) return truncPrefix.slice(0, maxChars);
    const keep = Math.max(0, maxChars - truncPrefix.length);
    return `${truncPrefix}${text.slice(-keep)}`;
  };

  const truncateHeadTail = () => {
    if (truncMiddleSuffix.length >= maxChars) return truncMiddleSuffix.slice(0, maxChars);
    const bodyBudget = Math.max(0, maxChars - truncMiddleSuffix.length);
    if (bodyBudget <= 0) return truncMiddleSuffix.slice(0, maxChars);

    let body = "";
    if (headTailJoiner.length >= bodyBudget) {
      body = text.slice(0, bodyBudget);
    } else {
      const splitBudget = bodyBudget - headTailJoiner.length;
      const headLen = Math.max(1, Math.floor(splitBudget / 2));
      const tailLen = Math.max(1, splitBudget - headLen);
      const head = text.slice(0, headLen);
      const tail = text.slice(-tailLen);
      body = `${head}${headTailJoiner}${tail}`;
    }
    if (body.length > bodyBudget) body = body.slice(0, bodyBudget);
    return `${body}${truncMiddleSuffix}`;
  };

  if (mode === "tail") {
    return {
      text: truncateTail(),
      truncated: true,
    };
  }

  if (mode === "headtail") {
    return {
      text: truncateHeadTail(),
      truncated: true,
    };
  }

  return {
    text: truncateHead(),
    truncated: true,
  };
}

async function buildRelayContextArtifacts(session) {
  const diagnostics = [];
  if (!CONFIG.contextSpecs.length) {
    return { text: "", diagnostics, injectedChars: 0, includedFiles: 0 };
  }

  for (const spec of CONFIG.contextSpecs) {
    const resolvedPath = resolveContextSpecPath(spec.specPath, session);
    const diag = {
      rawSpec: spec.rawSpec,
      mode: spec.mode,
      configuredPath: spec.specPath,
      resolvedPath,
      exists: false,
      isFile: false,
      size: 0,
      mtimeIso: "",
      loadedChars: 0,
      injectedChars: 0,
      truncated: false,
      error: "",
      _text: "",
    };
    try {
      const st = await fsp.stat(resolvedPath);
      diag.exists = true;
      diag.isFile = st.isFile();
      diag.size = Number(st.size || 0);
      diag.mtimeIso = st.mtime ? st.mtime.toISOString() : "";
      if (!diag.isFile) {
        diag.error = "not a file";
        diagnostics.push(diag);
        continue;
      }
      const raw = await fsp.readFile(resolvedPath, "utf8");
      const trimmed = String(raw || "").trim();
      diag.loadedChars = trimmed.length;
      diag._text = trimmed;
    } catch (err) {
      diag.error = String(err && err.code ? err.code : err && err.message ? err.message : "read failed");
    }
    diagnostics.push(diag);
  }

  const withText = diagnostics.filter((diag) => diag._text && diag._text.length > 0);
  const includeLabels = withText.length > 1;
  const pieces = [];
  let remaining = CONFIG.contextMaxChars;
  let includedFiles = 0;

  for (const diag of diagnostics) {
    if (!diag._text) continue;
    if (remaining <= 0) break;

    const separator = pieces.length > 0 ? "\n\n" : "";
    const separatorCost = separator.length;
    if (remaining <= separatorCost) break;

    const perFileBudget = Math.min(CONFIG.contextMaxCharsPerFile, remaining - separatorCost);
    if (perFileBudget <= 0) break;

    const label = includeLabels
      ? `### Context file: ${diag.rawSpec} (resolved: ${diag.resolvedPath})\n`
      : "";
    const textBudget = Math.max(0, perFileBudget - label.length);
    if (textBudget <= 0) continue;

    const truncated = truncateContextByMode(diag._text, diag.mode, textBudget);
    if (!truncated.text) continue;

    const chunk = `${label}${truncated.text}`;
    diag.truncated = truncated.truncated;
    diag.injectedChars = chunk.length;
    pieces.push(`${separator}${chunk}`);
    remaining -= separatorCost + chunk.length;
    includedFiles += 1;
  }

  for (const diag of diagnostics) delete diag._text;
  const text = pieces.join("");
  return {
    text,
    diagnostics,
    injectedChars: text.length,
    includedFiles,
  };
}

function buildRelayRuntimeContext(meta) {
  const scope = meta && meta.isDm ? "dm" : meta && meta.isThread ? "guild-thread" : "guild-channel";
  const uploadDir = meta && meta.uploadDir ? meta.uploadDir : CONFIG.uploadRootDir;
  const workdir = meta && meta.session && meta.session.workdir ? meta.session.workdir : CONFIG.defaultWorkdir;
  const lines = [
    `You are running through a Discord relay (provider=${CONFIG.agentProvider}, scope=${scope}).`,
    "Your response is posted back to Discord.",
    `Conversation key: ${meta && meta.conversationKey ? meta.conversationKey : "unknown"}`,
    `Current workdir: ${workdir}`,
    "",
    "Relay capabilities:",
    "- Slash commands exist for the user: /status, /reset, /workdir, /attach, /upload, /context.",
    "- You cannot execute slash commands directly; ask the user to run them when needed.",
  ];
  if (CONFIG.uploadEnabled) {
    lines.push(
      "- File attachment bridge is enabled.",
      `- Preferred upload base dir: ${uploadDir}`,
      "- To attach an image file, include markers like [[upload:relative/or/absolute/path]] in your final response.",
      "- Do not claim uploads are unsupported unless an actual error occurred."
    );
  } else {
    lines.push("- File attachment bridge is disabled in this relay instance.");
  }
  lines.push(
    "",
    "Respond to the user normally; this context only describes runtime behavior."
  );
  return lines.join("\n");
}

async function buildAgentPrompt(session, userPrompt, meta) {
  if (!shouldInjectRelayContext(session)) {
    return { prompt: userPrompt, contextInjected: false, contextMeta: null };
  }
  const runtimeContext = buildRelayRuntimeContext({ ...meta, session });
  const contextArtifacts = await buildRelayContextArtifacts(session);
  const extraContext = contextArtifacts.text;
  const contextBlock = extraContext
    ? `${runtimeContext}\n\nInstance-specific context:\n${extraContext}`
    : runtimeContext;
  const prompt = ["[Relay Runtime Context]", contextBlock, "", "[User Message]", userPrompt].join("\n");
  return { prompt, contextInjected: true, contextMeta: contextArtifacts };
}

function buildCodexArgs(session, prompt) {
  const args = ["exec"];

  const appendSharedFlags = () => {
    if (CONFIG.approvalPolicy) {
      // Codex CLI doesn't expose an approval flag; set it through config.
      args.push("-c", `approval_policy=${JSON.stringify(CONFIG.approvalPolicy)}`);
    }
    if (CONFIG.model) args.push("--model", CONFIG.model);
    // Newer codex-cli builds no longer expose `--search` for `exec`.
    // Keep CODEX_ENABLE_SEARCH behavior via config override instead.
    if (CONFIG.enableSearch) args.push("-c", "features.web_search_request=true");
    for (const override of CONFIG.configOverrides) {
      args.push("-c", override);
    }
  };

  if (session.threadId) {
    // For nested `exec resume`, `--sandbox` must be bound to `exec` (before `resume`).
    if (CONFIG.sandbox) args.push("--sandbox", CONFIG.sandbox);
    args.push("resume", session.threadId);
    if (CONFIG.skipGitRepoCheck) args.push("--skip-git-repo-check");
    appendSharedFlags();
    args.push("--json", prompt);
  } else {
    if (CONFIG.skipGitRepoCheck) args.push("--skip-git-repo-check");
    args.push("--cd", session.workdir || CONFIG.defaultWorkdir);
    if (CONFIG.sandbox) args.push("--sandbox", CONFIG.sandbox);
    appendSharedFlags();
    args.push("--json", prompt);
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

async function runCodex(session, prompt, extraEnv, onProgress) {
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
      const summary = summarizeCodexProgressEvent(evt);
      if (summary) emitProgress(onProgress, summary);
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
  // stream-json gives us tool and thinking events so we can relay human-friendly progress updates.
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (CONFIG.claudeModel) args.push("--model", CONFIG.claudeModel);
  if (CONFIG.claudePermissionMode) args.push("--permission-mode", CONFIG.claudePermissionMode);
  if (CONFIG.claudeAllowedTools.length) args.push("--allowedTools", ...CONFIG.claudeAllowedTools);
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

async function runClaude(session, prompt, extraEnv, onProgress) {
  const args = buildClaudeArgs(session, prompt);
  const env =
    extraEnv && typeof extraEnv === "object" ? { ...process.env, ...extraEnv } : process.env;
  const child = spawn(CONFIG.claudeBin, args, {
    cwd: session.workdir || CONFIG.defaultWorkdir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let threadId = session.threadId || null;
  let parsedResult = null;
  let lastAssistantEvent = null;
  const toolNamesById = new Map();
  const rawStdoutLines = [];
  const stderrLines = [];

  const stdoutRl = readline.createInterface({ input: child.stdout });
  stdoutRl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    rawStdoutLines.push(trimmed);
    if (rawStdoutLines.length > 400) rawStdoutLines.shift();

    let evt = null;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!evt || typeof evt !== "object") return;

    if (typeof evt.session_id === "string" && evt.session_id) {
      threadId = evt.session_id;
    }
    if (evt.type === "assistant") lastAssistantEvent = evt;
    if (evt.type === "result") parsedResult = evt;

    const summary = summarizeClaudeProgressEvent(evt, toolNamesById);
    if (summary) emitProgress(onProgress, summary);
  });

  const stderrRl = readline.createInterface({ input: child.stderr });
  stderrRl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    stderrLines.push(trimmed);
    if (stderrLines.length > 80) stderrLines.shift();
  });

  const exitCode = await waitForChildExit(child, "claude");

  const stdoutTrimmed = rawStdoutLines.join("\n").trim();
  if (exitCode !== 0) {
    const detail = stderrLines.slice(-20).join("\n") || rawStdoutLines.slice(-40).join("\n");
    throw new Error(`claude exit ${exitCode}\n${detail}`.trim());
  }

  const parsed = parsedResult || lastAssistantEvent;
  const fallbackText =
    extractClaudeTextFromJson(lastAssistantEvent, "").trim() ||
    stdoutTrimmed ||
    "No message returned by Claude.";
  const text = extractClaudeTextFromJson(parsed, fallbackText);
  return { threadId: threadId || session.threadId || null, text };
}

async function runAgent(session, prompt, extraEnv, onProgress) {
  if (CONFIG.agentProvider === "claude") {
    return runClaude(session, prompt, extraEnv, onProgress);
  }
  return runCodex(session, prompt, extraEnv, onProgress);
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
        "`/context` - show context bootstrap diagnostics for this conversation",
        "`/context reload` - force context re-bootstrap on next message",
      ].join("\n")
    );
    return true;
  }

  if (command.name === "status") {
    const key = conversationKey || getConversationKey(message);
    const uploadDir = getConversationUploadDir(key);
    const sessionContextVersion = getSessionContextVersion(session);
    await message.reply(
      [
        `${AGENT_SESSION_LABEL}: ${session.threadId || "none"}`,
        `workdir: ${session.workdir || CONFIG.defaultWorkdir}`,
        `upload_dir: ${uploadDir}`,
        `context_bootstrap: enabled=${CONFIG.contextEnabled} every_turn=${CONFIG.contextEveryTurn} target_version=${CONFIG.contextVersion} session_version=${sessionContextVersion}`,
      ].join("\n")
    );
    return true;
  }

  if (command.name === "context") {
    const sub = command.arg.toLowerCase();
    if (sub === "reload") {
      session.contextVersion = 0;
      session.updatedAt = new Date().toISOString();
      await queueSaveState();
      await message.reply("Context reload queued. Next message will re-inject context.");
      return true;
    }
    if (sub) {
      await message.reply("Usage: `/context` or `/context reload`");
      return true;
    }

    const artifacts = await buildRelayContextArtifacts(session);
    const specList = CONFIG.contextSpecs.map((spec) => spec.rawSpec).join("; ");
    const lines = [
      `context_bootstrap: enabled=${CONFIG.contextEnabled} every_turn=${CONFIG.contextEveryTurn} target_version=${CONFIG.contextVersion} session_version=${getSessionContextVersion(session)}`,
      `context_limits: total=${CONFIG.contextMaxChars} per_file=${CONFIG.contextMaxCharsPerFile}`,
      `workdir: ${session.workdir || CONFIG.defaultWorkdir}`,
      `configured_specs: ${specList || "(none)"}`,
      `injection_preview: chars=${artifacts.injectedChars} files=${artifacts.includedFiles}`,
    ];
    if (artifacts.diagnostics.length === 0) {
      lines.push("- no context file specs configured");
    } else {
      for (const diag of artifacts.diagnostics) {
        lines.push(summarizeContextDiagnostic(diag));
      }
    }
    await sendLongReply(message, lines.join("\n"));
    return true;
  }

  if (command.name === "reset") {
    session.threadId = null;
    session.contextVersion = 0;
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
    session.contextVersion = 0;
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
    // Force one bootstrap injection after attach so relay capabilities are re-established.
    session.contextVersion = 0;
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
      const wasAlreadyQueued = queueByConversation.has(key);
      const progress = createProgressReporter(pendingMsg, key);
      if (wasAlreadyQueued) {
        progress.note("Waiting for an earlier request in this conversation");
      }
      logRelayEvent("message.queued", {
        conversationKey: key,
        provider: CONFIG.agentProvider,
        promptChars: prompt.length,
        sessionId: session.threadId || null,
      });
      await enqueueConversation(key, async () => {
        const startedAt = Date.now();
        try {
          progress.note(`Starting ${AGENT_LABEL} run`);
          void message.channel
            .sendTyping()
            .catch((err) =>
              logRelayEvent("discord.sendTyping.error", {
                conversationKey: key,
                error: String(err && err.message ? err.message : err).slice(0, 240),
              })
            );
          const uploadDir = getConversationUploadDir(key);
          if (CONFIG.uploadEnabled) {
            await fsp.mkdir(uploadDir, { recursive: true });
          }
          logRelayEvent("agent.run.start", {
            conversationKey: key,
            provider: CONFIG.agentProvider,
            sessionId: session.threadId || null,
            workdir: session.workdir || CONFIG.defaultWorkdir,
          });
          let contextInjected = false;
          let result;
          try {
            const firstPrompt = await buildAgentPrompt(session, prompt, {
              conversationKey: key,
              uploadDir,
              isDm,
              isThread,
            });
            contextInjected = firstPrompt.contextInjected;
            if (firstPrompt.contextInjected) {
              const injectedChars =
                firstPrompt.contextMeta && typeof firstPrompt.contextMeta.injectedChars === "number"
                  ? firstPrompt.contextMeta.injectedChars
                  : 0;
              const includedFiles =
                firstPrompt.contextMeta && typeof firstPrompt.contextMeta.includedFiles === "number"
                  ? firstPrompt.contextMeta.includedFiles
                  : 0;
              logRelayEvent("agent.run.context_injected", {
                conversationKey: key,
                provider: CONFIG.agentProvider,
                sessionId: session.threadId || null,
                contextVersion: CONFIG.contextVersion,
                contextChars: injectedChars,
                contextFiles: includedFiles,
              });
              progress.note(
                includedFiles > 0
                  ? `Loaded relay runtime context (+${includedFiles} context file${includedFiles === 1 ? "" : "s"})`
                  : "Loaded relay runtime context"
              );
            }
            result = await runAgent(
              session,
              firstPrompt.prompt,
              CONFIG.uploadEnabled ? { RELAY_UPLOAD_DIR: uploadDir } : null,
              (line) => progress.note(line)
            );
          } catch (runErr) {
            if (!session.threadId || !isStaleThreadResumeError(runErr)) throw runErr;
            const staleThreadId = session.threadId;
            session.threadId = null;
            session.updatedAt = new Date().toISOString();
            await queueSaveState();
            logRelayEvent("agent.run.retry_stale_session", {
              conversationKey: key,
              provider: CONFIG.agentProvider,
              staleSessionId: staleThreadId,
            });
            progress.note(`Session ${staleThreadId} could not be resumed; retrying in a new session`);
            const retryPrompt = await buildAgentPrompt(session, prompt, {
              conversationKey: key,
              uploadDir,
              isDm,
              isThread,
            });
            contextInjected = contextInjected || retryPrompt.contextInjected;
            result = await runAgent(
              session,
              retryPrompt.prompt,
              CONFIG.uploadEnabled ? { RELAY_UPLOAD_DIR: uploadDir } : null,
              (line) => progress.note(line)
            );
            result.text =
              `Note: previous ${AGENT_LABEL} session \`${staleThreadId}\` could not be resumed, so I started a new session.\n\n` +
              (result.text || "");
          }
          session.threadId = result.threadId || session.threadId;
          if (contextInjected) session.contextVersion = CONFIG.contextVersion;
          session.updatedAt = new Date().toISOString();
          await queueSaveState();
          logRelayEvent("agent.run.done", {
            conversationKey: key,
            provider: CONFIG.agentProvider,
            durationMs: Date.now() - startedAt,
            sessionId: session.threadId || null,
            resultChars: (result.text || "").length,
          });

          let answer = result.text || "No response.";
          let uploadPaths = [];
          if (CONFIG.uploadEnabled) {
            const parsed = extractUploadMarkers(answer);
            answer = parsed.text;
            uploadPaths = parsed.rawPaths || [];
          }

          await progress.stop();
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
          await progress.stop();
          const detail = String(err.message || err).slice(0, 1800);
          logRelayEvent("message.failed", {
            conversationKey: key,
            provider: CONFIG.agentProvider,
            durationMs: Date.now() - startedAt,
            sessionId: session.threadId || null,
            error: detail.slice(0, 240),
          });
          const errorBody = `${AGENT_LABEL} error:\n\`\`\`\n${detail}\n\`\`\``;
          try {
            await pendingMsg.edit(errorBody);
          } catch (editErr) {
            logRelayEvent("message.error_edit_failed", {
              conversationKey: key,
              error: String(editErr && editErr.message ? editErr.message : editErr).slice(0, 240),
            });
            try {
              await sendLongReply(message, errorBody);
            } catch {}
          }
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
