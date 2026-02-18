#!/usr/bin/env node
"use strict";

const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
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

function parseSemiList(value) {
  if (!value) return [];
  return String(value)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
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

const CODEX_ALLOWED_WORKDIR_ROOTS = (() => {
  const roots = parseCsv(process.env.CODEX_ALLOWED_WORKDIR_ROOTS || "/root");
  return Array.from(roots).map((root) => path.resolve(root));
})();

const RAW_RELAY_WORKTREE_ROOT_DIR = (process.env.RELAY_WORKTREE_ROOT_DIR || "").trim();
const RELAY_WORKTREE_ROOT_DIR = path.resolve(
  RAW_RELAY_WORKTREE_ROOT_DIR || path.join(RELAY_STATE_DIR, "worktrees")
);
const RELAY_WORKTREE_ROOT_DIR_ERROR = (() => {
  if (RAW_RELAY_WORKTREE_ROOT_DIR && !path.isAbsolute(RAW_RELAY_WORKTREE_ROOT_DIR)) {
    return "RELAY_WORKTREE_ROOT_DIR must be an absolute path";
  }
  const allowed = CODEX_ALLOWED_WORKDIR_ROOTS.some((root) => {
    const relative = path.relative(root, RELAY_WORKTREE_ROOT_DIR);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (!allowed) {
    return `RELAY_WORKTREE_ROOT_DIR is outside CODEX_ALLOWED_WORKDIR_ROOTS (${CODEX_ALLOWED_WORKDIR_ROOTS.join(", ")})`;
  }
  return "";
})();

const CONFIG = {
  token: (process.env.DISCORD_BOT_TOKEN || "").trim(),
  agentProvider: normalizeAgentProvider(process.env.RELAY_AGENT_PROVIDER || process.env.AGENT_PROVIDER),
  codexBin: (process.env.CODEX_BIN || "codex").trim(),
  claudeBin: (process.env.CLAUDE_BIN || "claude").trim(),
  defaultWorkdir: path.resolve(process.env.CODEX_WORKDIR || "/root"),
  allowedWorkdirRoots: CODEX_ALLOWED_WORKDIR_ROOTS,
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

  discordAttachmentsEnabled: boolEnv("RELAY_DISCORD_ATTACHMENTS_ENABLED", true),
  discordAttachmentsMaxFiles: Math.max(0, intEnv("RELAY_DISCORD_ATTACHMENTS_MAX_FILES", 3)),
  discordAttachmentsMaxBytes: Math.max(0, intEnv("RELAY_DISCORD_ATTACHMENTS_MAX_BYTES", 256 * 1024)),
  discordAttachmentsMaxChars: Math.max(200, intEnv("RELAY_DISCORD_ATTACHMENTS_MAX_CHARS", 20000)),
  discordAttachmentsMaxCharsPerFile: Math.max(
    200,
    intEnv("RELAY_DISCORD_ATTACHMENTS_MAX_CHARS_PER_FILE", 8000)
  ),
  discordAttachmentsDownloadTimeoutMs: Math.max(
    1000,
    intEnv("RELAY_DISCORD_ATTACHMENTS_DOWNLOAD_TIMEOUT_MS", 15000)
  ),

  contextEnabled: boolEnv("RELAY_CONTEXT_ENABLED", true),
  contextEveryTurn: boolEnv("RELAY_CONTEXT_EVERY_TURN", false),
  contextVersion: Math.max(1, intEnv("RELAY_CONTEXT_VERSION", 1)),
  contextMaxChars: Math.max(200, intEnv("RELAY_CONTEXT_MAX_CHARS", 40000)),
  contextMaxCharsPerFile: Math.max(
    200,
    intEnv("RELAY_CONTEXT_MAX_CHARS_PER_FILE", intEnv("RELAY_CONTEXT_MAX_CHARS", 40000))
  ),
  contextSpecs: parseContextSpecs(process.env.RELAY_CONTEXT_FILE || ""),

  tasksEnabled: boolEnv("RELAY_TASKS_ENABLED", true),
  tasksMaxPending: Math.max(1, intEnv("RELAY_TASKS_MAX_PENDING", 50)),
  tasksStopOnError: boolEnv("RELAY_TASKS_STOP_ON_ERROR", false),
  tasksPostFullOutput: boolEnv("RELAY_TASKS_POST_FULL_OUTPUT", true),
  tasksSummaryAfterRun: boolEnv("RELAY_TASKS_SUMMARY_AFTER_RUN", true),

  worktreeRootDir: RELAY_WORKTREE_ROOT_DIR,
  worktreeRootDirError: RELAY_WORKTREE_ROOT_DIR_ERROR,

  plansEnabled: boolEnv("RELAY_PLANS_ENABLED", true),
  plansMaxHistory: Math.max(1, intEnv("RELAY_PLANS_MAX_HISTORY", 20)),
  planApplyRequireConfirmInGuilds: boolEnv("RELAY_PLAN_APPLY_REQUIRE_CONFIRM_IN_GUILDS", true),

  handoffEnabled: boolEnv("RELAY_HANDOFF_ENABLED", true),
  handoffAutoEnabled: boolEnv("RELAY_HANDOFF_AUTO_ENABLED", false),
  handoffAutoAfterTaskRun: (() => {
    if (process.env.RELAY_AUTO_HANDOFF_AFTER_TASK_RUN != null) {
      return boolEnv("RELAY_AUTO_HANDOFF_AFTER_TASK_RUN", false);
    }
    return boolEnv("RELAY_HANDOFF_AUTO_ENABLED", false);
  })(),
  handoffAutoAfterPlanApply: (() => {
    if (process.env.RELAY_AUTO_HANDOFF_AFTER_PLAN_APPLY != null) {
      return boolEnv("RELAY_AUTO_HANDOFF_AFTER_PLAN_APPLY", false);
    }
    return boolEnv("RELAY_HANDOFF_AUTO_ENABLED", false);
  })(),
  handoffFiles: (() => {
    const raw = (process.env.RELAY_HANDOFF_FILES || "").trim();
    const files = raw ? parseSemiList(raw) : ["HANDOFF_LOG.md", "docs/WORKING_MEMORY.md"];
    return files.map((p) => String(p || "").trim()).filter(Boolean);
  })(),
  handoffGitAutoCommit: boolEnv("RELAY_HANDOFF_GIT_AUTO_COMMIT", false),
  handoffGitAutoPush: boolEnv("RELAY_HANDOFF_GIT_AUTO_PUSH", false),
  handoffGitCommitMessage: (process.env.RELAY_HANDOFF_GIT_COMMIT_MESSAGE || "chore: relay handoff").trim(),

  gitAutoCommitEnabled: boolEnv("RELAY_GIT_AUTO_COMMIT", false),
  gitAutoCommitScope: (process.env.RELAY_GIT_AUTO_COMMIT_SCOPE || "both").trim().toLowerCase(),
  gitCommitPrefix: (process.env.RELAY_GIT_COMMIT_PREFIX || "ai:").trim() || "ai:",

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
const activeChildByConversation = new Map();
const taskRunnerByConversation = new Map();

function isSubPath(parentDir, childDir) {
  const relative = path.relative(parentDir, childDir);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isAllowedWorkdir(workdir) {
  return CONFIG.allowedWorkdirRoots.some((root) => isSubPath(root, workdir));
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const TEXT_EXTS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
  ".tsv",
  ".log",
  ".env",
  ".ini",
  ".cfg",
  ".conf",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
  ".patch",
  ".diff",
]);

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

function listDiscordAttachments(message) {
  if (!message || !message.attachments || typeof message.attachments.values !== "function") return [];
  return Array.from(message.attachments.values());
}

function isProbablyTextAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return false;
  const name = String(attachment.name || "").trim();
  const contentType = String(attachment.contentType || "").trim().toLowerCase();
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTS.has(ext)) return true;
  if (contentType.startsWith("text/")) return true;
  if (
    contentType.includes("json") ||
    contentType.includes("yaml") ||
    contentType.includes("toml") ||
    contentType.includes("xml") ||
    contentType.includes("csv")
  ) {
    return true;
  }
  return false;
}

function hasProbablyTextAttachments(message) {
  if (!CONFIG.discordAttachmentsEnabled) return false;
  const atts = listDiscordAttachments(message);
  return atts.some((att) => isProbablyTextAttachment(att));
}

function sanitizeAttachmentFilename(rawName) {
  let name = String(rawName || "").trim();
  if (!name) name = "attachment.txt";
  name = path.basename(name);
  name = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!name) name = "attachment.txt";
  if (name.length > 160) {
    const ext = path.extname(name);
    const keep = Math.max(1, 160 - ext.length);
    name = `${name.slice(0, keep)}${ext}`;
  }
  return name;
}

function looksBinaryBytes(buf) {
  if (!buf || typeof buf.length !== "number") return true;
  if (buf.length === 0) return false;
  const sampleLen = Math.min(buf.length, 8192);
  let ctrl = 0;
  for (let i = 0; i < sampleLen; i += 1) {
    const b = buf[i];
    if (b === 0) return true;
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b === 127) ctrl += 1;
  }
  return ctrl / sampleLen > 0.3;
}

function guessAttachmentTruncMode(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (ext === ".log") return "tail";
  return "headtail";
}

function truncateAttachmentByMode(rawText, mode, maxChars) {
  const text = String(rawText || "");
  if (!text) return { text: "", truncated: false };
  if (maxChars <= 0) return { text: "", truncated: text.length > 0 };
  if (text.length <= maxChars) return { text, truncated: false };

  const truncSuffix = "\n...[attachment truncated]";
  const truncPrefix = "...[attachment truncated]\n";
  const truncMiddleSuffix = "\n...[attachment truncated middle]";
  const headTailJoiner = "\n...[snip]...\n";

  const truncateHead = () => {
    if (truncSuffix.length >= maxChars) return truncSuffix.slice(0, maxChars);
    const keep = Math.max(0, maxChars - truncSuffix.length);
    return `${text.slice(0, keep)}${truncSuffix}`;
  };

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

  if (mode === "tail") return { text: truncateTail(), truncated: true };
  if (mode === "headtail") return { text: truncateHeadTail(), truncated: true };
  return { text: truncateHead(), truncated: true };
}

async function fetchDiscordAttachmentBytes(url, timeoutMs) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) return { ok: false, error: "missing url", buf: Buffer.alloc(0) };

  const controller = new AbortController();
  const timer =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const res = await fetch(rawUrl, {
      signal: controller.signal,
      ...(DISCORD_REST_AGENT ? { dispatcher: DISCORD_REST_AGENT } : {}),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, buf: Buffer.alloc(0) };
    }
    const ab = await res.arrayBuffer();
    return { ok: true, error: "", buf: Buffer.from(ab) };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), buf: Buffer.alloc(0) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ingestDiscordTextAttachments(message, conversationKey, uploadDir, onProgress) {
  const out = {
    ok: true,
    injectedText: "",
    includedFiles: 0,
    totalCandidates: 0,
    savedPaths: [],
    errors: [],
  };

  if (!CONFIG.discordAttachmentsEnabled) return out;
  const candidates = listDiscordAttachments(message).filter((att) => isProbablyTextAttachment(att));
  out.totalCandidates = candidates.length;
  if (candidates.length === 0) return out;

  const maxFiles = Math.max(0, CONFIG.discordAttachmentsMaxFiles);
  const selected = maxFiles > 0 ? candidates.slice(0, maxFiles) : [];
  if (selected.length === 0) return out;

  const attachmentsDir = path.join(uploadDir, "attachments");
  try {
    await fsp.mkdir(attachmentsDir, { recursive: true });
  } catch (err) {
    out.ok = false;
    out.errors.push(`failed creating attachments dir: ${String(err.message || err)}`);
    return out;
  }

  let remaining = Math.max(0, CONFIG.discordAttachmentsMaxChars);
  const pieces = [];

  for (const att of selected) {
    const originalName = String(att.name || "attachment");
    const safeName = sanitizeAttachmentFilename(originalName);
    const url = String(att.url || "").trim();
    const claimedBytes = Number(att.size || 0) || 0;
    const contentType = String(att.contentType || "").trim() || "unknown";

    if (!url) {
      out.errors.push(`missing url for attachment: ${originalName}`);
      continue;
    }
    if (CONFIG.discordAttachmentsMaxBytes > 0 && claimedBytes > CONFIG.discordAttachmentsMaxBytes) {
      out.errors.push(
        `attachment too large (claimed ${claimedBytes} bytes > max ${CONFIG.discordAttachmentsMaxBytes}): ${originalName}`
      );
      continue;
    }

    try {
      if (typeof onProgress === "function") {
        onProgress(`Downloading attachment: ${safeName} (${claimedBytes} bytes)`);
      }
      const fetched = await fetchDiscordAttachmentBytes(url, CONFIG.discordAttachmentsDownloadTimeoutMs);
      if (!fetched.ok) {
        out.errors.push(`failed downloading ${originalName}: ${fetched.error}`);
        continue;
      }
      if (CONFIG.discordAttachmentsMaxBytes > 0 && fetched.buf.length > CONFIG.discordAttachmentsMaxBytes) {
        out.errors.push(
          `attachment too large (downloaded ${fetched.buf.length} bytes > max ${CONFIG.discordAttachmentsMaxBytes}): ${originalName}`
        );
        continue;
      }
      if (looksBinaryBytes(fetched.buf)) {
        out.errors.push(`attachment appears non-text (skipped): ${originalName}`);
        continue;
      }

      const uniquePrefix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const savedPath = path.join(attachmentsDir, `${uniquePrefix}_${safeName}`);
      await fsp.writeFile(savedPath, fetched.buf);
      out.savedPaths.push(savedPath);

      const sep = pieces.length > 0 ? "\n\n" : "";
      const sepCost = sep.length;
      if (remaining <= sepCost) continue;

      const perFileBudget = Math.min(CONFIG.discordAttachmentsMaxCharsPerFile, remaining - sepCost);
      if (perFileBudget <= 0) continue;

      const header = [
        `[Discord attachment: ${originalName}]`,
        `saved_to: ${savedPath}`,
        `size_bytes: ${fetched.buf.length}`,
        `content_type: ${contentType}`,
        "",
      ].join("\n");
      const bodyBudget = Math.max(0, perFileBudget - header.length);
      if (bodyBudget <= 0) continue;

      const decoded = fetched.buf.toString("utf8");
      const mode = guessAttachmentTruncMode(originalName);
      const truncated = truncateAttachmentByMode(decoded, mode, bodyBudget);
      const chunk = `${header}${truncated.text}`;
      pieces.push(`${sep}${chunk}`);
      remaining -= sepCost + chunk.length;
      out.includedFiles += 1;
    } catch (err) {
      out.errors.push(`attachment ingest error (${originalName}): ${String(err && err.message ? err.message : err)}`);
      continue;
    }
  }

  out.injectedText = pieces.join("");
  if (out.errors.length > 0) {
    logRelayEvent("discord.attachments.ingest.warn", {
      conversationKey,
      candidates: out.totalCandidates,
      saved: out.savedPaths.length,
      injectedFiles: out.includedFiles,
      errors: out.errors.slice(0, 5),
    });
  } else {
    logRelayEvent("discord.attachments.ingest.ok", {
      conversationKey,
      candidates: out.totalCandidates,
      saved: out.savedPaths.length,
      injectedFiles: out.includedFiles,
    });
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureTaskLoopShape(session) {
  if (!session || typeof session !== "object") return false;
  let changed = false;
  if (!session.taskLoop || typeof session.taskLoop !== "object") {
    session.taskLoop = { running: false, stopRequested: false, currentTaskId: null };
    return true;
  }
  if (typeof session.taskLoop.running !== "boolean") {
    session.taskLoop.running = false;
    changed = true;
  }
  if (typeof session.taskLoop.stopRequested !== "boolean") {
    session.taskLoop.stopRequested = false;
    changed = true;
  }
  if (session.taskLoop.currentTaskId != null && typeof session.taskLoop.currentTaskId !== "string") {
    session.taskLoop.currentTaskId = null;
    changed = true;
  }
  return changed;
}

function normalizeTaskObject(task, fallbackId) {
  if (!task || typeof task !== "object") return false;
  let changed = false;
  const validStatuses = new Set(["pending", "running", "done", "failed", "blocked", "canceled"]);

  if (typeof task.id !== "string" || !task.id.trim()) {
    task.id = String(fallbackId || `t-${Date.now()}`);
    changed = true;
  }
  if (typeof task.text !== "string") {
    task.text = String(task.text || "");
    changed = true;
  }
  const status = String(task.status || "pending").toLowerCase();
  if (!validStatuses.has(status)) {
    task.status = "pending";
    changed = true;
  } else if (task.status !== status) {
    task.status = status;
    changed = true;
  }

  if (typeof task.createdAt !== "string" || !task.createdAt) {
    task.createdAt = nowIso();
    changed = true;
  }
  if (task.startedAt != null && typeof task.startedAt !== "string") {
    task.startedAt = null;
    changed = true;
  }
  if (task.finishedAt != null && typeof task.finishedAt !== "string") {
    task.finishedAt = null;
    changed = true;
  }
  if (typeof task.attempts !== "number" || !Number.isFinite(task.attempts) || task.attempts < 0) {
    task.attempts = 0;
    changed = true;
  }
  if (task.lastError != null && typeof task.lastError !== "string") {
    task.lastError = String(task.lastError || "");
    changed = true;
  }
  if (task.lastResultPreview != null && typeof task.lastResultPreview !== "string") {
    task.lastResultPreview = String(task.lastResultPreview || "");
    changed = true;
  }
  return changed;
}

function ensureTasksShape(session) {
  if (!session || typeof session !== "object") return false;
  let changed = false;
  if (!Array.isArray(session.tasks)) {
    session.tasks = [];
    changed = true;
  }
  for (let i = 0; i < session.tasks.length; i += 1) {
    const task = session.tasks[i];
    changed = normalizeTaskObject(task, `t-${String(i + 1).padStart(4, "0")}`) || changed;
  }
  return changed;
}

function normalizePlanObject(plan, fallbackId) {
  if (!plan || typeof plan !== "object") return false;
  let changed = false;

  if (typeof plan.id !== "string" || !plan.id.trim()) {
    plan.id = String(fallbackId || `p-${Date.now()}`);
    changed = true;
  }
  if (typeof plan.createdAt !== "string" || !plan.createdAt) {
    plan.createdAt = nowIso();
    changed = true;
  }
  if (plan.title != null && typeof plan.title !== "string") {
    plan.title = String(plan.title || "");
    changed = true;
  }
  if (!plan.title || !String(plan.title).trim()) {
    const derived = plan.request ? taskTextPreview(plan.request, 72) : "";
    if (derived) {
      plan.title = derived;
      changed = true;
    }
  }
  if (plan.workdir != null && typeof plan.workdir !== "string") {
    plan.workdir = String(plan.workdir || "");
    changed = true;
  }
  if (plan.path != null && typeof plan.path !== "string") {
    plan.path = String(plan.path || "");
    changed = true;
  }
  if (plan.request != null && typeof plan.request !== "string") {
    plan.request = String(plan.request || "");
    changed = true;
  }
  if (plan.text != null && typeof plan.text !== "string") {
    plan.text = String(plan.text || "");
    changed = true;
  }
  return changed;
}

function ensurePlansShape(session) {
  if (!session || typeof session !== "object") return false;
  let changed = false;
  if (!Array.isArray(session.plans)) {
    session.plans = [];
    changed = true;
  }
  for (let i = 0; i < session.plans.length; i += 1) {
    const plan = session.plans[i];
    changed = normalizePlanObject(plan, `p-${String(i + 1).padStart(4, "0")}`) || changed;
  }
  // Keep the most recent plans.
  const maxHistory = Math.max(1, Number(CONFIG.plansMaxHistory || 20));
  if (session.plans.length > maxHistory) {
    session.plans = session.plans.slice(-maxHistory);
    changed = true;
  }
  return changed;
}

function normalizeSessionAfterLoad(session) {
  if (!session || typeof session !== "object") return false;
  let changed = false;
  changed = ensureTasksShape(session) || changed;
  changed = ensureTaskLoopShape(session) || changed;
  changed = ensurePlansShape(session) || changed;

  // After a relay restart, there is no running in-memory runner/child. Reset any
  // in-flight task state so `/task list` doesn't show stuck tasks.
  if (Array.isArray(session.tasks)) {
    for (const task of session.tasks) {
      if (!task || typeof task !== "object") continue;
      if (task.status === "running") {
        task.status = "pending";
        task.startedAt = null;
        task.finishedAt = null;
        task.lastError = task.lastError || "interrupted by relay restart";
        changed = true;
      }
    }
  }
  if (session.taskLoop && typeof session.taskLoop === "object") {
    if (session.taskLoop.running) {
      session.taskLoop.running = false;
      changed = true;
    }
    if (session.taskLoop.stopRequested) {
      session.taskLoop.stopRequested = false;
      changed = true;
    }
    if (session.taskLoop.currentTaskId) {
      session.taskLoop.currentTaskId = null;
      changed = true;
    }
  }
  return changed;
}

async function ensureStateLoaded() {
  await fsp.mkdir(CONFIG.stateDir, { recursive: true });
  if (CONFIG.uploadEnabled || CONFIG.discordAttachmentsEnabled) {
    await fsp.mkdir(CONFIG.uploadRootDir, { recursive: true });
  }
  try {
    const raw = await fsp.readFile(CONFIG.stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object") {
      state.version = Number(parsed.version || 1);
      state.sessions = parsed.sessions;
      let mutated = false;
      for (const session of Object.values(state.sessions)) {
        mutated = normalizeSessionAfterLoad(session) || mutated;
      }
      if (mutated) await queueSaveState();
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
  if (existing && typeof existing === "object") {
    ensureTasksShape(existing);
    ensureTaskLoopShape(existing);
    ensurePlansShape(existing);
    return existing;
  }
  const created = {
    threadId: null,
    workdir: CONFIG.defaultWorkdir,
    contextVersion: 0,
    updatedAt: nowIso(),
    tasks: [],
    taskLoop: { running: false, stopRequested: false, currentTaskId: null },
    plans: [],
  };
  state.sessions[key] = created;
  return created;
}

function isTaskRunnerActive(conversationKey, session) {
  if (!conversationKey) return Boolean(session && session.taskLoop && session.taskLoop.running);
  if (taskRunnerByConversation.has(conversationKey)) return true;
  return Boolean(session && session.taskLoop && session.taskLoop.running);
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
  const match = prompt.match(
    /^\/(help|status|reset|workdir|attach|upload|context|task|worktree|plan|handoff)\b(?:\s+([\s\S]+))?$/i
  );
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
    "- Slash commands exist for the user: /status, /reset, /workdir, /attach, /upload, /context, /task, /worktree, /plan, /handoff.",
    "- You cannot execute slash commands directly; ask the user to run them when needed.",
  ];
  if (CONFIG.discordAttachmentsEnabled) {
    lines.push(
      `- Incoming Discord text attachments: the relay downloads small text attachments to ${path.join(
        uploadDir,
        "attachments"
      )} and appends their contents to the prompt.`
    );
  }
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

  const appendSharedFlags = () => appendCodexSharedFlags(args);

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

function appendCodexSharedFlags(args) {
  if (!Array.isArray(args)) return;
  if (CONFIG.approvalPolicy) {
    // Codex CLI doesn't expose an approval flag for exec; set it through config override.
    args.push("-c", `approval_policy=${JSON.stringify(CONFIG.approvalPolicy)}`);
  }
  if (CONFIG.model) args.push("--model", CONFIG.model);
  // Newer codex-cli builds no longer expose `--search` for `exec`.
  // Keep CODEX_ENABLE_SEARCH behavior via config override instead.
  if (CONFIG.enableSearch) args.push("-c", "features.web_search_request=true");
  for (const override of CONFIG.configOverrides) {
    args.push("-c", override);
  }
}

function buildCodexArgsStateless(workdir, prompt, { sandboxMode = "read-only" } = {}) {
  const args = ["exec"];
  if (CONFIG.skipGitRepoCheck) args.push("--skip-git-repo-check");
  args.push("--cd", workdir || CONFIG.defaultWorkdir);
  args.push("--sandbox", sandboxMode);
  appendCodexSharedFlags(args);
  args.push("--ephemeral");
  args.push("--json", prompt);
  return args;
}

async function runCodexWithArgs(args, { cwd, extraEnv, onProgress, conversationKey, label }) {
  const env =
    extraEnv && typeof extraEnv === "object" ? { ...process.env, ...extraEnv } : process.env;
  const child = spawn(CONFIG.codexBin, args, { cwd, env });
  if (conversationKey) activeChildByConversation.set(conversationKey, child);

  let threadId = null;
  let finalText = "";
  const stderrLines = [];
  const rawStdoutLines = [];

  const stdoutRl = readline.createInterface({ input: child.stdout });
  const stderrRl = readline.createInterface({ input: child.stderr });
  try {
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
      if (rawStdoutLines.length > 80) rawStdoutLines.shift();
    });

    stderrRl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      stderrLines.push(trimmed);
      if (stderrLines.length > 80) stderrLines.shift();
    });

    const exitCode = await waitForChildExit(child, label || "codex");
    if (exitCode !== 0) {
      const detail = stderrLines.slice(-20).join("\n") || rawStdoutLines.slice(-20).join("\n");
      throw new Error(`codex exit ${exitCode}\n${detail}`.trim());
    }
    if (!finalText) {
      finalText = rawStdoutLines.join("\n").trim() || "No message returned by Codex.";
    }
    return { threadId, text: finalText };
  } finally {
    try {
      stdoutRl.close();
    } catch {}
    try {
      stderrRl.close();
    } catch {}
    if (conversationKey && activeChildByConversation.get(conversationKey) === child) {
      activeChildByConversation.delete(conversationKey);
    }
  }
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

async function runCodex(session, prompt, extraEnv, onProgress, conversationKey) {
  const args = buildCodexArgs(session, prompt);
  const env =
    extraEnv && typeof extraEnv === "object" ? { ...process.env, ...extraEnv } : process.env;
  const child = spawn(CONFIG.codexBin, args, {
    cwd: session.workdir || CONFIG.defaultWorkdir,
    env,
  });
  if (conversationKey) activeChildByConversation.set(conversationKey, child);

  let threadId = session.threadId || null;
  let finalText = "";
  const stderrLines = [];
  const rawStdoutLines = [];

  const stdoutRl = readline.createInterface({ input: child.stdout });
  const stderrRl = readline.createInterface({ input: child.stderr });
  try {
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
  } finally {
    try {
      stdoutRl.close();
    } catch {}
    try {
      stderrRl.close();
    } catch {}
    if (conversationKey && activeChildByConversation.get(conversationKey) === child) {
      activeChildByConversation.delete(conversationKey);
    }
  }
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

async function runClaude(session, prompt, extraEnv, onProgress, conversationKey) {
  const args = buildClaudeArgs(session, prompt);
  const env =
    extraEnv && typeof extraEnv === "object" ? { ...process.env, ...extraEnv } : process.env;
  const child = spawn(CONFIG.claudeBin, args, {
    cwd: session.workdir || CONFIG.defaultWorkdir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (conversationKey) activeChildByConversation.set(conversationKey, child);

  let threadId = session.threadId || null;
  let parsedResult = null;
  let lastAssistantEvent = null;
  const toolNamesById = new Map();
  const rawStdoutLines = [];
  const stderrLines = [];

  const stdoutRl = readline.createInterface({ input: child.stdout });
  const stderrRl = readline.createInterface({ input: child.stderr });
  try {
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
  } finally {
    try {
      stdoutRl.close();
    } catch {}
    try {
      stderrRl.close();
    } catch {}
    if (conversationKey && activeChildByConversation.get(conversationKey) === child) {
      activeChildByConversation.delete(conversationKey);
    }
  }
}

async function runAgent(session, prompt, extraEnv, onProgress, conversationKey) {
  if (CONFIG.agentProvider === "claude") {
    return runClaude(session, prompt, extraEnv, onProgress, conversationKey);
  }
  return runCodex(session, prompt, extraEnv, onProgress, conversationKey);
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

async function sendLongToChannel(channel, text) {
  const chunks = splitMessage(text, Math.max(300, CONFIG.maxReplyChars));
  for (const content of chunks) {
    await channel.send(content);
  }
}

function splitFirstToken(value) {
  const raw = String(value || "").trim();
  if (!raw) return { head: "", rest: "" };
  const m = raw.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  return { head: (m && m[1] ? m[1] : "").trim(), rest: (m && m[2] ? m[2] : "").trim() };
}

function taskTextPreview(text, maxLen = 60) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen - 1)}…`;
}

function safeConversationDirName(conversationKey) {
  const raw = String(conversationKey || "").trim() || "unknown";
  const cleaned = raw.replace(/[\\/]/g, "_").replace(/[^a-zA-Z0-9._:-]/g, "_");
  if (cleaned.length <= 80) return cleaned;
  const hash = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 8);
  return `${cleaned.slice(0, 60)}-${hash}`;
}

function newPlanId() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  const SS = String(d.getSeconds()).padStart(2, "0");
  const rand = crypto.randomBytes(2).toString("hex");
  return `p-${yyyy}${mm}${dd}-${HH}${MM}${SS}-${rand}`;
}

function planTitleFromRequest(request) {
  const t = taskTextPreview(String(request || "").trim(), 72);
  return t || "plan";
}

function planStorageDir(conversationKey) {
  return path.join(CONFIG.stateDir, "plans", safeConversationDirName(conversationKey));
}

function planStoragePath(conversationKey, planId) {
  return path.join(planStorageDir(conversationKey), `${planId}.md`);
}

async function writePlanFile(conversationKey, planId, planText) {
  const dir = planStorageDir(conversationKey);
  await fsp.mkdir(dir, { recursive: true });
  const filePath = planStoragePath(conversationKey, planId);
  await fsp.writeFile(filePath, String(planText || ""), "utf8");
  return filePath;
}

async function loadPlanText(plan) {
  if (!plan || typeof plan !== "object") return "";
  if (typeof plan.path === "string" && plan.path.trim()) {
    try {
      return String(await fsp.readFile(plan.path, "utf8"));
    } catch {
      // Fall back to embedded text if present.
    }
  }
  if (typeof plan.text === "string") return plan.text;
  return "";
}

async function createAndSavePlan(session, conversationKey, workdir, request, planText) {
  const id = newPlanId();
  const createdAt = nowIso();
  const absWorkdir = path.resolve(workdir || CONFIG.defaultWorkdir);
  const title = planTitleFromRequest(request);
  const filePath = await writePlanFile(conversationKey, id, planText);
  const plan = {
    id,
    createdAt,
    title,
    workdir: absWorkdir,
    path: filePath,
    request: String(request || "").trim() || null,
  };
  ensurePlansShape(session);
  session.plans.push(plan);
  ensurePlansShape(session);
  return plan;
}

function findPlan(session, idOrLast) {
  if (!session || !Array.isArray(session.plans) || session.plans.length === 0) return null;
  const needle = String(idOrLast || "").trim().toLowerCase();
  if (!needle || needle === "last" || needle === "latest") return session.plans[session.plans.length - 1];
  return session.plans.find((p) => p && typeof p === "object" && String(p.id || "").toLowerCase() === needle) || null;
}

function parsePlanSteps(planText) {
  const raw = String(planText || "");
  const lines = raw.split(/\r?\n/);
  const steps = [];

  // Preferred: markdown task list.
  for (const line of lines) {
    const m = line.match(/^\s*-\s*\[\s*\]\s+(.+?)\s*$/);
    if (m) steps.push(m[1]);
  }
  if (steps.length > 0) return steps;

  // Fallback: numbered list.
  for (const line of lines) {
    const m = line.match(/^\s*\d{1,3}[\.)]\s+(.+?)\s*$/);
    if (m) steps.push(m[1]);
  }
  if (steps.length > 0) return steps;

  // Last resort: non-empty bullets.
  for (const line of lines) {
    const m = line.match(/^\s*-\s+(.+?)\s*$/);
    if (m) steps.push(m[1]);
  }
  return steps;
}

function nextTaskId(session) {
  const tasks = session && Array.isArray(session.tasks) ? session.tasks : [];
  let max = 0;
  for (const t of tasks) {
    if (!t || typeof t !== "object") continue;
    const m = String(t.id || "").match(/^t-(\d{4})$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `t-${String(max + 1).padStart(4, "0")}`;
}

function createTask(session, text) {
  const id = nextTaskId(session);
  const createdAt = nowIso();
  return {
    id,
    text: String(text || ""),
    status: "pending",
    createdAt,
    startedAt: null,
    finishedAt: null,
    attempts: 0,
    lastError: null,
    lastResultPreview: null,
  };
}

function findNextPendingTask(session) {
  if (!session || !Array.isArray(session.tasks)) return null;
  return session.tasks.find((t) => t && typeof t === "object" && t.status === "pending") || null;
}

function parseTaskMarkers(text) {
  const raw = String(text || "");
  const blocked = /\[\[task:blocked\]\]/i.test(raw);
  const done = /\[\[task:done\]\]/i.test(raw);
  const cleaned = raw.replace(/\[\[task:(?:blocked|done)\]\]/gi, "").trim();
  if (blocked) return { status: "blocked", cleaned };
  if (done) return { status: "done", cleaned };
  return { status: "done", cleaned };
}

function requestStopConversation(conversationKey, session) {
  const runner = taskRunnerByConversation.get(conversationKey);
  if (runner) runner.stopRequested = true;
  const shouldSetTaskStopFlag = Boolean(runner) || Boolean(session && session.taskLoop && session.taskLoop.running);
  if (shouldSetTaskStopFlag && session && typeof session === "object") {
    ensureTaskLoopShape(session);
    session.taskLoop.stopRequested = true;
    session.updatedAt = nowIso();
    void queueSaveState();
  }

  const child = activeChildByConversation.get(conversationKey);
  if (!child) {
    logRelayEvent("task.stop_requested", { conversationKey, hasChild: false });
    return false;
  }
  logRelayEvent("task.stop_requested", { conversationKey, hasChild: true });
  try {
    child.kill("SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      if (!child.killed) child.kill("SIGKILL");
    } catch {}
  }, 5000).unref?.();
  return true;
}

async function runAgentAndPostToDiscord({
  baseMessage,
  channel,
  session,
  conversationKey,
  prompt,
  isDm,
  isThread,
  reasonLabel,
  postFullOutput = true,
}) {
  const runLabel = reasonLabel ? `${reasonLabel}` : "request";
  const pendingMsg = baseMessage && typeof baseMessage.reply === "function"
    ? await baseMessage.reply(`Running ${AGENT_LABEL}...`)
    : await channel.send(`Running ${AGENT_LABEL}... (${runLabel})`);

  const wasAlreadyQueued = queueByConversation.has(conversationKey);
  const progress = createProgressReporter(pendingMsg, conversationKey);
  if (wasAlreadyQueued) {
    progress.note("Waiting for an earlier request in this conversation");
  }

  logRelayEvent("message.queued", {
    conversationKey,
    provider: CONFIG.agentProvider,
    promptChars: String(prompt || "").length,
    sessionId: session.threadId || null,
    reason: runLabel,
  });

  return enqueueConversation(conversationKey, async () => {
    const startedAt = Date.now();
    try {
      progress.note(`Starting ${AGENT_LABEL} run`);
      void channel
        .sendTyping?.()
        ?.catch((err) =>
          logRelayEvent("discord.sendTyping.error", {
            conversationKey,
            error: String(err && err.message ? err.message : err).slice(0, 240),
          })
        );

      const uploadDir = getConversationUploadDir(conversationKey);
      if (CONFIG.uploadEnabled || CONFIG.discordAttachmentsEnabled) {
        await fsp.mkdir(uploadDir, { recursive: true });
      }

      let userPrompt = prompt;
      let attachmentMeta = null;
      if (CONFIG.discordAttachmentsEnabled && baseMessage) {
        const ingested = await ingestDiscordTextAttachments(
          baseMessage,
          conversationKey,
          uploadDir,
          (line) => progress.note(line)
        );
        attachmentMeta = ingested;
        if (ingested && ingested.injectedText) {
          const block = `[Discord Attachments]\n${ingested.injectedText}`;
          userPrompt = userPrompt ? `${userPrompt}\n\n${block}` : block;
          progress.note(`Loaded ${ingested.includedFiles}/${ingested.totalCandidates} attachment(s)`);
        } else if (ingested && ingested.totalCandidates > 0) {
          progress.note(`No attachments injected (saved=${ingested.savedPaths.length}, errors=${ingested.errors.length})`);
        }
      }

      logRelayEvent("agent.run.start", {
        conversationKey,
        provider: CONFIG.agentProvider,
        sessionId: session.threadId || null,
        workdir: session.workdir || CONFIG.defaultWorkdir,
        reason: runLabel,
        discordAttachmentsCandidates: attachmentMeta ? attachmentMeta.totalCandidates : 0,
        discordAttachmentsSaved: attachmentMeta ? attachmentMeta.savedPaths.length : 0,
      });

      let contextInjected = false;
      let result;
      try {
        const firstPrompt = await buildAgentPrompt(session, userPrompt, {
          conversationKey,
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
            conversationKey,
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
          (line) => progress.note(line),
          conversationKey
        );
      } catch (runErr) {
        if (!session.threadId || !isStaleThreadResumeError(runErr)) throw runErr;
        const staleThreadId = session.threadId;
        session.threadId = null;
        session.updatedAt = nowIso();
        await queueSaveState();
        logRelayEvent("agent.run.retry_stale_session", {
          conversationKey,
          provider: CONFIG.agentProvider,
          staleSessionId: staleThreadId,
        });
        progress.note(`Session ${staleThreadId} could not be resumed; retrying in a new session`);
        const retryPrompt = await buildAgentPrompt(session, userPrompt, {
          conversationKey,
          uploadDir,
          isDm,
          isThread,
        });
        contextInjected = contextInjected || retryPrompt.contextInjected;
        result = await runAgent(
          session,
          retryPrompt.prompt,
          CONFIG.uploadEnabled ? { RELAY_UPLOAD_DIR: uploadDir } : null,
          (line) => progress.note(line),
          conversationKey
        );
        result.text =
          `Note: previous ${AGENT_LABEL} session \`${staleThreadId}\` could not be resumed, so I started a new session.\n\n` +
          (result.text || "");
      }

      session.threadId = result.threadId || session.threadId;
      if (contextInjected) session.contextVersion = CONFIG.contextVersion;
      session.updatedAt = nowIso();
      await queueSaveState();

      logRelayEvent("agent.run.done", {
        conversationKey,
        provider: CONFIG.agentProvider,
        durationMs: Date.now() - startedAt,
        sessionId: session.threadId || null,
        resultChars: (result.text || "").length,
        reason: runLabel,
      });

      let answer = result.text || "No response.";
      let uploadPaths = [];
      if (CONFIG.uploadEnabled) {
        const parsed = extractUploadMarkers(answer);
        answer = parsed.text;
        uploadPaths = parsed.rawPaths || [];
      }

      const posted = postFullOutput
        ? answer
        : (() => {
            const max = Math.max(200, Math.min(1800, CONFIG.maxReplyChars));
            if (answer.length <= max) return answer;
            return `${answer.slice(0, Math.max(0, max - 24)).trim()}\n...[output truncated]`;
          })();

      await progress.stop();
      const chunks = splitMessage(posted, Math.max(300, CONFIG.maxReplyChars));
      await pendingMsg.edit(chunks[0]);
      for (let i = 1; i < chunks.length; i += 1) {
        await channel.send(chunks[i]);
      }

      if (CONFIG.uploadEnabled && uploadPaths.length > 0) {
        const { files, errors } = await resolveAndValidateUploads(conversationKey, uploadPaths);
        if (files.length > 0) {
          for (let i = 0; i < files.length; i += 10) {
            const batch = files.slice(i, i + 10);
            const names = batch.map((f) => `\`${f.name}\``).join(", ");
            await channel.send({ content: `Uploaded: ${names}`, files: batch });
          }
        }
        if (errors.length > 0) {
          await channel.send(`Upload notes:\n${errors.map((e) => `- ${e}`).join("\n")}`);
        }
      }

      return { ok: true, threadId: session.threadId || null, text: answer };
    } catch (err) {
      await progress.stop();
      const detail = String(err.message || err).slice(0, 1800);
      logRelayEvent("message.failed", {
        conversationKey,
        provider: CONFIG.agentProvider,
        durationMs: Date.now() - startedAt,
        sessionId: session.threadId || null,
        error: detail.slice(0, 240),
        reason: runLabel,
      });
      const errorBody = `${AGENT_LABEL} error:\n\`\`\`\n${detail}\n\`\`\``;
      try {
        await pendingMsg.edit(errorBody);
      } catch (editErr) {
        logRelayEvent("message.error_edit_failed", {
          conversationKey,
          error: String(editErr && editErr.message ? editErr.message : editErr).slice(0, 240),
        });
        try {
          if (baseMessage) await sendLongReply(baseMessage, errorBody);
          else await sendLongToChannel(channel, errorBody);
        } catch {}
      }
      return { ok: false, error: detail };
    }
  });
}

function sanitizeWorktreeName(raw) {
  const name = String(raw || "").trim();
  if (!name) return "";
  if (name === "." || name === "..") return "";
  // Keep it strict: avoid path traversal and surprising unicode. Users can always pick a simpler name.
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) return "";
  return name;
}

function parseWorktreeNewArgs(tokens) {
  const out = { ok: true, fromRef: "HEAD", use: false };
  const args = Array.isArray(tokens) ? tokens : [];
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (t === "--use") {
      out.use = true;
      continue;
    }
    if (t === "--from") {
      const ref = args[i + 1];
      if (!ref) return { ok: false, error: "Usage: `/worktree new <name> [--from <ref>] [--use]`" };
      out.fromRef = ref;
      i += 1;
      continue;
    }
    return { ok: false, error: `Unknown flag: ${t}` };
  }
  return out;
}

async function execFileCapture(cmd, args, { cwd, timeoutMs } = {}) {
  const finalCwd = cwd || process.cwd();
  const maxBytes = 200 * 1024;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, { cwd: finalCwd, env: process.env });

    const killTimer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            try {
              child.kill("SIGTERM");
            } catch {}
            setTimeout(() => {
              try {
                child.kill("SIGKILL");
              } catch {}
            }, 5000).unref?.();
          }, timeoutMs)
        : null;

    const collect = (chunk, sink) => {
      if (!chunk) return "";
      const s = chunk.toString("utf8");
      if (sink.length >= maxBytes) return sink;
      return (sink + s).slice(0, maxBytes);
    };

    if (child.stdout) {
      child.stdout.on("data", (d) => {
        stdout = collect(d, stdout);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (d) => {
        stderr = collect(d, stderr);
      });
    }

    child.on("error", (err) => {
      if (killTimer) clearTimeout(killTimer);
      resolve({ code: 127, stdout, stderr: `${stderr}\n${String(err.message || err)}`.trim() });
    });
    child.on("close", (code) => {
      if (killTimer) clearTimeout(killTimer);
      resolve({ code: typeof code === "number" ? code : 1, stdout, stderr });
    });
  });
}

async function resolveGitRepoRoot(cwd) {
  const res = await execFileCapture("git", ["rev-parse", "--show-toplevel"], { cwd, timeoutMs: 15000 });
  if (res.code !== 0) {
    return {
      ok: false,
      error: "Not a git repo (run `/workdir` into a git repo first).",
    };
  }
  const root = String(res.stdout || "").trim();
  if (!root) return { ok: false, error: "Not a git repo (no repo root returned)." };
  return { ok: true, root: path.resolve(root) };
}

function repoSlug(repoRoot) {
  const repoName = path.basename(repoRoot);
  const repoHash = crypto.createHash("sha1").update(String(repoRoot)).digest("hex").slice(0, 8);
  return `${repoName}-${repoHash}`;
}

async function gitWorktreeList(repoRoot) {
  const res = await execFileCapture("git", ["-C", repoRoot, "worktree", "list", "--porcelain"], {
    cwd: repoRoot,
    timeoutMs: 20000,
  });
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout || "").trim();
    return { ok: false, error: `git worktree list failed:\n\`\`\`\n${detail.slice(0, 1600)}\n\`\`\`` };
  }
  const lines = String(res.stdout || "").split(/\r?\n/);
  const worktrees = [];
  let cur = null;
  const pushCur = () => {
    if (!cur || !cur.path) return;
    const name = path.basename(cur.path);
    let branch = cur.branch || "";
    if (branch.startsWith("refs/heads/")) branch = branch.slice("refs/heads/".length);
    worktrees.push({ name, path: cur.path, branch, head: cur.head || "" });
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("worktree ")) {
      pushCur();
      cur = { path: line.slice("worktree ".length).trim(), branch: "", head: "" };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("branch ")) cur.branch = line.slice("branch ".length).trim();
    else if (line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length).trim();
  }
  pushCur();
  return { ok: true, worktrees };
}

async function resolveWorktreePath(repoRoot, nameOrPath) {
  const list = await gitWorktreeList(repoRoot);
  if (!list.ok) return list;
  const needle = String(nameOrPath || "").trim();
  if (!needle) return { ok: false, error: "Missing worktree name." };
  if (path.isAbsolute(needle)) {
    const abs = path.resolve(needle);
    const found = list.worktrees.find((wt) => path.resolve(wt.path) === abs);
    if (found) return { ok: true, path: abs, branch: found.branch || "" };
    return { ok: false, error: "Worktree path not found in `git worktree list`." };
  }
  const name = sanitizeWorktreeName(needle);
  if (!name) return { ok: false, error: "Invalid worktree name." };
  const found = list.worktrees.find((wt) => wt.name === name);
  if (!found) return { ok: false, error: `No worktree named \`${name}\` found.` };
  return { ok: true, path: path.resolve(found.path), branch: found.branch || "" };
}

async function gitWorktreeCreate(repoRoot, name, fromRef) {
  const safeName = sanitizeWorktreeName(name);
  if (!safeName) return { ok: false, error: "Invalid worktree name." };
  const parent = path.join(CONFIG.worktreeRootDir, repoSlug(repoRoot));
  const worktreePath = path.join(parent, safeName);
  const branch = `wt/${safeName}`;

  try {
    await fsp.mkdir(parent, { recursive: true });
  } catch (err) {
    return { ok: false, error: `Failed creating worktree parent dir: ${String(err.message || err)}` };
  }
  try {
    const st = await fsp.stat(worktreePath);
    if (st && st.isDirectory()) {
      return { ok: false, error: `Worktree already exists at: ${worktreePath}` };
    }
  } catch {}

  const ref = String(fromRef || "HEAD").trim() || "HEAD";
  const res = await execFileCapture(
    "git",
    ["-C", repoRoot, "worktree", "add", "-b", branch, worktreePath, ref],
    { cwd: repoRoot, timeoutMs: 60000 }
  );
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout || "").trim();
    return { ok: false, error: `git worktree add failed:\n\`\`\`\n${detail.slice(0, 1600)}\n\`\`\`` };
  }
  logRelayEvent("worktree.created", { repoRoot, path: worktreePath, branch });
  return { ok: true, path: path.resolve(worktreePath), branch };
}

async function gitWorktreeRemove(repoRoot, worktreePath, force) {
  const args = ["-C", repoRoot, "worktree", "remove"];
  if (force) args.push("--force");
  args.push(worktreePath);
  const res = await execFileCapture("git", args, { cwd: repoRoot, timeoutMs: 60000 });
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout || "").trim();
    return { ok: false, error: `git worktree remove failed:\n\`\`\`\n${detail.slice(0, 1600)}\n\`\`\`` };
  }
  await execFileCapture("git", ["-C", repoRoot, "worktree", "prune"], { cwd: repoRoot, timeoutMs: 30000 });
  logRelayEvent("worktree.removed", { repoRoot, path: worktreePath, force: Boolean(force) });
  return { ok: true };
}

function gitAutoCommitScopeAllows(scope) {
  const want = String(scope || "").trim().toLowerCase();
  const cfg = String(CONFIG.gitAutoCommitScope || "both").trim().toLowerCase();
  if (!want) return false;
  if (cfg === "both" || cfg === "all" || !cfg) return true;
  if (cfg === "task" || cfg === "tasks") return want === "task";
  if (cfg === "plan" || cfg === "plans") return want === "plan";
  return true;
}

function buildAutoCommitSubject({ id, title }) {
  const prefix = (CONFIG.gitCommitPrefix || "ai:").trim() || "ai:";
  const baseTitle = taskTextPreview(title || "", 64);
  const pieces = [prefix, id, baseTitle].filter(Boolean);
  const raw = pieces.join(" ").replace(/\s+/g, " ").trim();
  if (!raw) return `${prefix} ${id}`.trim();
  if (raw.length <= 72) return raw;
  return raw.slice(0, 71).trim();
}

async function maybeAutoCommitGit({ workdir, scope, id, title, conversationKey }) {
  if (!CONFIG.gitAutoCommitEnabled) return { ok: false, skipped: "disabled" };
  if (!gitAutoCommitScopeAllows(scope)) return { ok: false, skipped: "scope" };

  const repo = await resolveGitRepoRoot(workdir);
  if (!repo.ok) return { ok: false, skipped: "not a git repo" };

  const stRes = await execFileCapture("git", ["-C", repo.root, "status", "--porcelain=v1"], { cwd: repo.root, timeoutMs: 20000 });
  if (stRes.code !== 0) {
    const detail = (stRes.stderr || stRes.stdout || "").trim();
    return { ok: false, error: `git status failed: ${detail.slice(0, 240)}` };
  }
  const status = String(stRes.stdout || "").trim();
  if (!status) return { ok: false, skipped: "clean" };

  const addRes = await execFileCapture("git", ["-C", repo.root, "add", "-A"], { cwd: repo.root, timeoutMs: 30000 });
  if (addRes.code !== 0) {
    const detail = (addRes.stderr || addRes.stdout || "").trim();
    return { ok: false, error: `git add failed: ${detail.slice(0, 240)}` };
  }

  const diffCached = await execFileCapture("git", ["-C", repo.root, "diff", "--cached", "--quiet"], { cwd: repo.root, timeoutMs: 20000 });
  if (diffCached.code === 0) return { ok: false, skipped: "no staged changes" };

  const filesRes = await execFileCapture("git", ["-C", repo.root, "diff", "--cached", "--name-only"], { cwd: repo.root, timeoutMs: 20000 });
  const files = String(filesRes.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 80);
  const body = files.length ? `Changed files:\n${files.map((f) => `- ${f}`).join("\n")}` : "";

  const subject = buildAutoCommitSubject({ id, title });
  const commitArgs = ["-C", repo.root, "commit", "-m", subject];
  if (body) commitArgs.push("-m", body);
  const commitRes = await execFileCapture("git", commitArgs, { cwd: repo.root, timeoutMs: 90000 });
  if (commitRes.code !== 0) {
    const detail = (commitRes.stderr || commitRes.stdout || "").trim();
    return { ok: false, error: `git commit failed:\n${detail.slice(0, 700)}` };
  }

  const shaRes = await execFileCapture("git", ["-C", repo.root, "rev-parse", "HEAD"], { cwd: repo.root, timeoutMs: 15000 });
  const sha = String(shaRes.stdout || "").trim().slice(0, 12);
  logRelayEvent("git.auto_commit", { conversationKey, scope, id, sha, repoRoot: repo.root });
  return { ok: true, sha, repoRoot: repo.root, subject };
}

async function kickTaskRunner(conversationKey, channel, session, meta) {
  const runner = taskRunnerByConversation.get(conversationKey);
  if (!runner || !channel) return;

  ensureTasksShape(session);
  ensureTaskLoopShape(session);

  const summarizeCounts = () => {
    const counts = { pending: 0, running: 0, done: 0, failed: 0, blocked: 0, canceled: 0 };
    for (const t of session.tasks || []) {
      if (!t || typeof t !== "object") continue;
      if (counts[t.status] != null) counts[t.status] += 1;
    }
    return counts;
  };

  try {
    while (true) {
      const r = taskRunnerByConversation.get(conversationKey);
      const stopRequested = (r && r.stopRequested) || (session.taskLoop && session.taskLoop.stopRequested);
      if (stopRequested) break;

      const task = findNextPendingTask(session);
      if (!task) break;

      task.status = "running";
      task.startedAt = nowIso();
      task.finishedAt = null;
      task.attempts = (Number(task.attempts || 0) || 0) + 1;
      task.lastError = null;
      ensureTaskLoopShape(session);
      session.taskLoop.currentTaskId = task.id;
      session.updatedAt = nowIso();
      await queueSaveState();
      logRelayEvent("task.started", { conversationKey, taskId: task.id, attempts: task.attempts });

      const wrapper = [
        `[TASK ${task.id}]`,
        task.text,
        "",
        "When finished:",
        "- briefly summarize outcome",
        "- if blocked, write: [[task:blocked]] and explain what you need",
        "- otherwise end with: [[task:done]]",
      ].join("\n");

      const res = await runAgentAndPostToDiscord({
        baseMessage: null,
        channel,
        session,
        conversationKey,
        prompt: wrapper,
        isDm: Boolean(meta && meta.isDm),
        isThread: Boolean(meta && meta.isThread),
        reasonLabel: `task ${task.id}`,
        postFullOutput: CONFIG.tasksPostFullOutput,
      });

      const finishedAt = nowIso();
      ensureTaskLoopShape(session);
      session.taskLoop.currentTaskId = null;

      if (res.ok) {
        const parsed = parseTaskMarkers(res.text);
        task.status = parsed.status;
        task.finishedAt = finishedAt;
        task.lastResultPreview = taskTextPreview(parsed.cleaned, 200) || null;
        task.lastError = null;
        logRelayEvent("task.finished", { conversationKey, taskId: task.id, status: task.status });
        if (task.status === "done") {
          try {
            const commit = await maybeAutoCommitGit({
              workdir: session.workdir || CONFIG.defaultWorkdir,
              scope: "task",
              id: task.id,
              title: task.text || "",
              conversationKey,
            });
            if (commit && commit.ok) {
              await channel.send(`Auto-commit: ${commit.sha} (${commit.subject})`);
            }
          } catch (err) {
            logRelayEvent("git.auto_commit.error", {
              conversationKey,
              scope: "task",
              id: task.id,
              error: String(err && err.message ? err.message : err).slice(0, 240),
            });
          }
        }
        if (task.status === "blocked") break;
      } else {
        const stopNow =
          (taskRunnerByConversation.get(conversationKey) || {}).stopRequested ||
          (session.taskLoop && session.taskLoop.stopRequested);
        task.status = stopNow ? "canceled" : "failed";
        task.finishedAt = finishedAt;
        task.lastError = stopNow ? "stop requested" : res.error || "task failed";
        task.lastResultPreview = null;
        logRelayEvent("task.finished", { conversationKey, taskId: task.id, status: task.status });
        if (CONFIG.tasksStopOnError) break;
      }

      session.updatedAt = nowIso();
      await queueSaveState();

      // Yield so stop commands can take effect between tasks.
      await new Promise((r) => setTimeout(r, 0));
    }
  } catch (err) {
    logRelayEvent("task.runner.error", {
      conversationKey,
      error: String(err && err.message ? err.message : err).slice(0, 240),
    });
  } finally {
    ensureTaskLoopShape(session);
    session.taskLoop.running = false;
    session.taskLoop.stopRequested = false;
    session.taskLoop.currentTaskId = null;
    session.updatedAt = nowIso();
    await queueSaveState();
    taskRunnerByConversation.delete(conversationKey);
    const counts = summarizeCounts();
    try {
      if (CONFIG.tasksSummaryAfterRun) {
        await channel.send(
          `Task runner stopped. pending=${counts.pending} done=${counts.done} failed=${counts.failed} blocked=${counts.blocked} canceled=${counts.canceled}`
        );
      }
    } catch {}

    if (CONFIG.handoffAutoAfterTaskRun) {
      try {
        const workdir = session.workdir || CONFIG.defaultWorkdir;
        const res = await enqueueConversation(conversationKey, async () =>
          writeHandoffEntry({
            session,
            conversationKey,
            workdir,
            dryRun: false,
            doCommit: CONFIG.handoffGitAutoCommit,
            doPush: CONFIG.handoffGitAutoPush,
          })
        );
        if (res && res.ok) {
          const note = res.commitSummary ? ` (${res.commitSummary})` : "";
          await channel.send(`Auto-handoff written to ${res.files.map((p) => `\`${p}\``).join(", ")}${note}`);
        }
      } catch (err) {
        logRelayEvent("handoff.auto.error", {
          conversationKey,
          error: String(err && err.message ? err.message : err).slice(0, 240),
        });
      }
    }
  }
}

async function writeHandoffEntry({ session, conversationKey, workdir, dryRun, doCommit, doPush }) {
  const repo = await resolveGitRepoRoot(workdir);
  const baseDir = repo.ok ? repo.root : workdir;

  const ensured = [];
  for (const rel of CONFIG.handoffFiles) {
    const resolved = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(baseDir, rel);
    ensured.push(resolved);
    try {
      await fsp.mkdir(path.dirname(resolved), { recursive: true });
    } catch {}
    try {
      await fsp.stat(resolved);
    } catch {
      const header = rel.includes("WORKING_MEMORY")
        ? "# Working Memory (append-only)\n"
        : rel.includes("HANDOFF")
          ? "# Handoff Log (append-only)\n"
          : "# Handoff (append-only)\n";
      if (!dryRun) await fsp.writeFile(resolved, header, "utf8");
    }
  }

  let branch = "";
  let status = "";
  let diffStat = "";
  if (repo.ok) {
    const branchRes = await execFileCapture("git", ["-C", repo.root, "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repo.root,
      timeoutMs: 15000,
    });
    branch = String(branchRes.stdout || "").trim();
    const stRes = await execFileCapture("git", ["-C", repo.root, "status", "--porcelain=v1"], { cwd: repo.root, timeoutMs: 20000 });
    status = String(stRes.stdout || "").trim();
    const diffRes = await execFileCapture("git", ["-C", repo.root, "diff", "--stat"], { cwd: repo.root, timeoutMs: 20000 });
    diffStat = String(diffRes.stdout || "").trim();
  }

  ensureTasksShape(session);
  ensureTaskLoopShape(session);
  ensurePlansShape(session);
  const counts = { pending: 0, running: 0, done: 0, failed: 0, blocked: 0, canceled: 0 };
  for (const t of session.tasks || []) {
    if (t && typeof t === "object" && counts[t.status] != null) counts[t.status] += 1;
  }

  const lastPlan = session.plans && session.plans.length ? session.plans[session.plans.length - 1] : null;
  let planTail = "";
  if (lastPlan) {
    try {
      const lastPlanText = await loadPlanText(lastPlan);
      planTail = lastPlanText ? String(lastPlanText).slice(-1200) : "";
    } catch {}
  }

  const prompt = [
    "Write a handoff entry for future agents. Output MUST be Markdown (no code fences).",
    "",
    "Format:",
    "## <timestamp in ISO 8601>",
    "### Objective",
    "- ...",
    "### Changes",
    "- ...",
    "### Evidence",
    "- paths and commands",
    "### Next steps",
    "- ...",
    "",
    `timestamp: ${nowIso()}`,
    `workdir: ${workdir}`,
    repo.ok ? `repo_root: ${repo.root}` : "repo_root: (not a git repo)",
    branch ? `branch: ${branch}` : null,
    status ? `git status --porcelain=v1:\n${status}` : null,
    diffStat ? `git diff --stat:\n${diffStat}` : null,
    "",
    `task_counts: pending=${counts.pending} running=${counts.running} done=${counts.done} failed=${counts.failed} blocked=${counts.blocked} canceled=${counts.canceled}`,
    planTail ? `last_plan_tail:\n${planTail}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const args = buildCodexArgsStateless(workdir, prompt, { sandboxMode: "read-only" });
  const res = await runCodexWithArgs(args, { cwd: workdir, extraEnv: null, onProgress: null, conversationKey, label: "handoff" });

  const entryText = String(res.text || "").trim();
  const entry = entryText ? `\n\n${entryText}\n` : "\n\n## (empty handoff)\n";
  for (const filePath of ensured) {
    if (!dryRun) await fsp.appendFile(filePath, entry, "utf8");
  }

  let commitSummary = "";
  if (doCommit && repo.ok && !dryRun) {
    const addArgs = ["-C", repo.root, "add", ...ensured.map((p) => path.relative(repo.root, p))];
    await execFileCapture("git", addArgs, { cwd: repo.root, timeoutMs: 30000 });
    const diffCached = await execFileCapture("git", ["-C", repo.root, "diff", "--cached", "--quiet"], { cwd: repo.root, timeoutMs: 20000 });
    if (diffCached.code === 0) {
      commitSummary = "no changes to commit";
    } else {
      const msg = CONFIG.handoffGitCommitMessage || "chore: relay handoff";
      const commitRes = await execFileCapture("git", ["-C", repo.root, "commit", "-m", msg], { cwd: repo.root, timeoutMs: 60000 });
      if (commitRes.code === 0) {
        const shaRes = await execFileCapture("git", ["-C", repo.root, "rev-parse", "HEAD"], { cwd: repo.root, timeoutMs: 15000 });
        const sha = String(shaRes.stdout || "").trim().slice(0, 12);
        commitSummary = `committed ${sha}`;
        if (doPush) {
          const branchNameRes = await execFileCapture("git", ["-C", repo.root, "rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: repo.root,
            timeoutMs: 15000,
          });
          const br = String(branchNameRes.stdout || "").trim() || "main";
          const pushRes = await execFileCapture("git", ["-C", repo.root, "push", "origin", br], { cwd: repo.root, timeoutMs: 120000 });
          if (pushRes.code === 0) commitSummary += " + pushed";
          else commitSummary += " (push failed)";
        }
      } else {
        commitSummary = "git commit failed";
      }
    }
  } else if (doCommit && !repo.ok) {
    commitSummary = "commit skipped (not a git repo)";
  }

  return { ok: true, files: ensured, entryText, commitSummary };
}

async function startPlanApplyFlow({ conversationKey, message, session, plan, planText }) {
  const channel = message && message.channel ? message.channel : null;
  if (!channel) return;

  const isDm = !message.guildId;
  const isThread = Boolean(channel && channel.isThread && channel.isThread());
  const workdir = session.workdir || CONFIG.defaultWorkdir;
  const title = (plan && (plan.title || plan.request)) ? String(plan.title || plan.request) : "";

  const prompt = [
    `[PLAN ${plan && plan.id ? plan.id : "unknown"}]`,
    planText,
    "",
    "Execute this plan now.",
    "",
    "Requirements:",
    "- Make minimal diffs.",
    "- Run the plan's verification steps (commands) and report results.",
    "- Update docs/WORKING_MEMORY.md and HANDOFF_LOG.md as append-only artifacts (create them if missing).",
    "",
    "When finished:",
    "- summarize what changed (file list) and what remains",
    "- if blocked, clearly state what you need from the user",
  ].join("\n");

  let res = null;
  try {
    res = await runAgentAndPostToDiscord({
      baseMessage: message,
      channel,
      session,
      conversationKey,
      prompt,
      isDm,
      isThread,
      reasonLabel: `plan ${plan && plan.id ? plan.id : "unknown"} apply`,
      postFullOutput: true,
    });
  } catch (err) {
    logRelayEvent("plan.apply.error", {
      conversationKey,
      planId: plan && plan.id ? plan.id : null,
      error: String(err && err.message ? err.message : err).slice(0, 240),
    });
    return;
  }

  if (res && res.ok) {
    try {
      const commit = await maybeAutoCommitGit({
        workdir,
        scope: "plan",
        id: plan && plan.id ? plan.id : "plan",
        title,
        conversationKey,
      });
      if (commit && commit.ok) {
        await channel.send(`Auto-commit: ${commit.sha} (${commit.subject})`);
      }
    } catch (err) {
      logRelayEvent("git.auto_commit.error", {
        conversationKey,
        scope: "plan",
        id: plan && plan.id ? plan.id : null,
        error: String(err && err.message ? err.message : err).slice(0, 240),
      });
    }

    if (CONFIG.handoffAutoAfterPlanApply) {
      try {
        const handoffRes = await enqueueConversation(conversationKey, async () =>
          writeHandoffEntry({
            session,
            conversationKey,
            workdir,
            dryRun: false,
            doCommit: CONFIG.handoffGitAutoCommit,
            doPush: CONFIG.handoffGitAutoPush,
          })
        );
        if (handoffRes && handoffRes.ok) {
          const note = handoffRes.commitSummary ? ` (${handoffRes.commitSummary})` : "";
          await channel.send(`Auto-handoff written to ${handoffRes.files.map((p) => `\`${p}\``).join(", ")}${note}`);
        }
      } catch (err) {
        logRelayEvent("handoff.auto.error", {
          conversationKey,
          error: String(err && err.message ? err.message : err).slice(0, 240),
        });
      }
    }
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
        "`/task <subcmd>` - manage per-conversation task queue (add/list/run/stop/clear)",
        "`/worktree <subcmd>` - manage git worktrees (list/new/use/rm/prune)",
        "`/plan <subcmd>` - manage plans (new/list/show/apply)",
        "`/handoff` - write repo handoff/working-memory update (optional git commit/push)",
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

  if (command.name === "plan") {
    if (!CONFIG.plansEnabled) {
      await message.reply("Plans are disabled on this relay (RELAY_PLANS_ENABLED=false).");
      return true;
    }
    ensurePlansShape(session);

    const { head: subRaw, rest } = splitFirstToken(command.arg);
    const sub = subRaw.toLowerCase();

    if (!sub || sub === "list") {
      if (!session.plans.length) {
        await message.reply("No saved plans for this conversation. Use `/plan <request>`.");
        return true;
      }
      const workdir = path.resolve(session.workdir || CONFIG.defaultWorkdir);
      const matching = session.plans.filter(
        (p) => p && typeof p === "object" && typeof p.workdir === "string" && path.resolve(p.workdir) === workdir
      );
      const pool = matching.length ? matching : session.plans;
      const lines = [];
      lines.push(`plans: total=${session.plans.length} showing=${Math.min(10, pool.length)} (max_history=${CONFIG.plansMaxHistory})`);
      lines.push(`workdir: ${workdir}${matching.length ? " (filtered)" : ""}`);
      const show = pool.slice(-10);
      for (const p of show) {
        const title = p && p.title ? taskTextPreview(p.title, 72) : p && p.request ? taskTextPreview(p.request, 72) : "(no title)";
        const wd = p && p.workdir ? path.basename(String(p.workdir)) : "";
        lines.push(`- ${p.id} ${p.createdAt} ${title}${wd ? ` (wd:${wd})` : ""}`);
      }
      if (pool.length > show.length) {
        lines.push(`- ... (${pool.length - show.length} more)`);
      }
      await sendLongReply(message, lines.join("\n"));
      return true;
    }

    if (sub === "show") {
      const id = (rest || "").split(/\s+/)[0] || "last";
      const plan = findPlan(session, id);
      if (!plan) {
        await message.reply("No such plan. Use `/plan list`.");
        return true;
      }
      const text = (await loadPlanText(plan)).trim();
      await sendLongReply(message, [`Plan \`${plan.id}\` (${plan.createdAt})`, plan.path ? `path: \`${plan.path}\`` : null, "", text || "(empty)"].filter(Boolean).join("\n"));
      return true;
    }

    if (sub === "apply") {
      const tokens = (rest || "").split(/\s+/).filter(Boolean);
      const id = tokens[0] || "last";
      const confirm = tokens.includes("--confirm");
      const plan = findPlan(session, id);
      if (!plan) {
        await message.reply("No such plan. Use `/plan list`.");
        return true;
      }
      if (isTaskRunnerActive(conversationKey, session)) {
        await message.reply("Refusing while task runner is active. Run `/task stop` first.");
        return true;
      }
      if (message.guildId && CONFIG.planApplyRequireConfirmInGuilds && !confirm) {
        await message.reply(`Refusing to apply plan in a guild channel without \`--confirm\`. Re-run: \`/plan apply ${plan.id} --confirm\``);
        return true;
      }
      const text = (await loadPlanText(plan)).trim();
      if (!text) {
        await message.reply("Plan text is empty or missing.");
        return true;
      }

      void startPlanApplyFlow({
        conversationKey,
        message,
        session,
        plan,
        planText: text,
      });
      return true;
    }

    // Treat anything else as "new plan" for ergonomics: `/plan <request...>`
    const requestText = sub === "new" ? rest : command.arg;
    if (!requestText) {
      await message.reply("Usage: `/plan <request...>` or `/plan new <request...>`");
      return true;
    }
    const workdir = session.workdir || CONFIG.defaultWorkdir;

      let repoRoot = "";
      let branch = "";
      let status = "";
      let diffStat = "";
      const repo = await resolveGitRepoRoot(workdir);
      if (repo.ok) {
        repoRoot = repo.root;
        const branchRes = await execFileCapture("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: repoRoot,
          timeoutMs: 15000,
        });
        branch = String(branchRes.stdout || "").trim();
        const stRes = await execFileCapture("git", ["-C", repoRoot, "status", "--porcelain=v1"], {
          cwd: repoRoot,
          timeoutMs: 20000,
        });
        status = String(stRes.stdout || "").trim();
        const diffRes = await execFileCapture("git", ["-C", repoRoot, "diff", "--stat"], {
          cwd: repoRoot,
          timeoutMs: 20000,
        });
        diffStat = String(diffRes.stdout || "").trim();
      }

      const prompt = [
        "You are in PLAN MODE.",
        "Do not edit files. Do not run commands that modify the repo.",
        "",
        "Return a Markdown plan with these sections (use these exact headings):",
        "# Goal",
        "# Assumptions",
        "# Proposed changes (file-by-file)",
        "# Risks & mitigations",
        "# Verification steps (commands)",
        "# Rollback plan",
        "# Task breakdown (5–20 atomic tasks)",
        "",
        "Notes:",
        "- Keep tasks small, concrete, and ordered.",
        "- If you need clarification, add a final 'Questions:' section with '-' bullets.",
        "- In 'Task breakdown', include items that can be executed sequentially by an agent.",
        "",
        `Workdir: ${workdir}`,
        repoRoot ? `Repo root: ${repoRoot}` : "Repo root: (not a git repo)",
        branch ? `Branch: ${branch}` : null,
        status ? `git status --porcelain=v1:\n${status}` : null,
        diffStat ? `git diff --stat:\n${diffStat}` : null,
        "",
        `User request: ${requestText}`,
      ]
        .filter(Boolean)
        .join("\n");

      const args = buildCodexArgsStateless(workdir, prompt, { sandboxMode: "read-only" });
      const res = await runCodexWithArgs(args, {
        cwd: workdir,
        extraEnv: null,
        onProgress: null,
        conversationKey,
        label: "plan",
      });

      const planText = String(res.text || "").trim();
      const plan = await createAndSavePlan(session, conversationKey, workdir, requestText, planText);
      ensurePlansShape(session);
      session.updatedAt = nowIso();
      await queueSaveState();

      await sendLongReply(
        message,
        [
          `Plan saved: \`${plan.id}\` (generated with codex sandbox=read-only)`,
          plan.path ? `Saved at: \`${plan.path}\`` : null,
          `Apply: \`/plan apply ${plan.id}${message.guildId && CONFIG.planApplyRequireConfirmInGuilds ? " --confirm" : ""}\``,
          "",
          planText || "(empty plan)",
        ].join("\n")
      );
      return true;
  }

  if (command.name === "handoff") {
    if (!CONFIG.handoffEnabled) {
      await message.reply("Handoff is disabled on this relay (RELAY_HANDOFF_ENABLED=false).");
      return true;
    }

    const tokens = (command.arg || "").split(/\s+/).filter(Boolean);
    const dryRun = tokens.includes("--dry-run");
    const commitFlag = tokens.includes("--commit");
    const noCommitFlag = tokens.includes("--no-commit");
    const pushFlag = tokens.includes("--push");
    const noPushFlag = tokens.includes("--no-push");
    if (tokens.includes("-h") || tokens.includes("--help")) {
      await sendLongReply(
        message,
        [
          "Usage: `/handoff [--dry-run] [--commit|--no-commit] [--push|--no-push]`",
          "",
          "Writes a repo-local handoff entry to files from RELAY_HANDOFF_FILES (default: HANDOFF_LOG.md;docs/WORKING_MEMORY.md).",
          "Generation uses `codex exec --sandbox read-only` and the relay appends the result to files.",
        ].join("\n")
      );
      return true;
    }

    const doCommit = noCommitFlag ? false : commitFlag ? true : CONFIG.handoffGitAutoCommit;
    const doPush = noPushFlag ? false : pushFlag ? true : CONFIG.handoffGitAutoPush;

    if (isTaskRunnerActive(conversationKey, session)) {
      await message.reply("Refusing while task runner is active. Run `/task stop` first.");
      return true;
    }

    const workdir = session.workdir || CONFIG.defaultWorkdir;
    const res = await writeHandoffEntry({ session, conversationKey, workdir, dryRun, doCommit, doPush });
    if (!res || !res.ok) {
      await message.reply("Handoff failed.");
      return true;
    }
    const commitNote = res.commitSummary ? ` (${res.commitSummary})` : "";
    if (dryRun) {
      await sendLongReply(
        message,
        [
          `[dry-run] Handoff entry (not written) would append to ${res.files.map((p) => `\`${p}\``).join(", ")}${commitNote}`,
          "",
          (res.entryText || "").trim() || "(empty handoff)",
        ].join("\n")
      );
    } else {
      await message.reply(
        `Handoff written to ${res.files.map((p) => `\`${p}\``).join(", ")}${commitNote}`
      );
    }
    return true;
  }

  if (command.name === "task") {
    if (!CONFIG.tasksEnabled) {
      await message.reply("Tasks are disabled on this relay (RELAY_TASKS_ENABLED=false).");
      return true;
    }
    ensureTasksShape(session);
    ensureTaskLoopShape(session);

    const { head: subRaw, rest } = splitFirstToken(command.arg);
    const sub = subRaw.toLowerCase();

    if (sub === "add") {
      if (!rest) {
        await message.reply("Usage: `/task add <text...>`");
        return true;
      }
      const pending = session.tasks.filter((t) => t && t.status === "pending").length;
      if (CONFIG.tasksMaxPending > 0 && pending >= CONFIG.tasksMaxPending) {
        await message.reply(`Task queue is full (pending=${pending}, max=${CONFIG.tasksMaxPending}).`);
        return true;
      }
      const task = createTask(session, rest);
      session.tasks.push(task);
      session.updatedAt = nowIso();
      await queueSaveState();
      logRelayEvent("task.added", { conversationKey: conversationKey || null, taskId: task.id });
      await message.reply(`Queued task \`${task.id}\`: ${taskTextPreview(task.text, 80)}`);
      return true;
    }

    if (sub === "list" || !sub) {
      const lines = [];
      lines.push(
        `task_loop: running=${Boolean(session.taskLoop && session.taskLoop.running)} stop_requested=${Boolean(
          session.taskLoop && session.taskLoop.stopRequested
        )} current=${(session.taskLoop && session.taskLoop.currentTaskId) || "none"}`
      );
      if (!session.tasks.length) {
        lines.push("- (no tasks)");
        await sendLongReply(message, lines.join("\n"));
        return true;
      }
      const maxLines = 28;
      const show = session.tasks.slice(0, maxLines);
      for (const t of show) {
        lines.push(`- ${t.id} [${t.status}] ${taskTextPreview(t.text, 80)}`);
      }
      if (session.tasks.length > show.length) {
        lines.push(`- ... (${session.tasks.length - show.length} more)`);
      }
      await sendLongReply(message, lines.join("\n"));
      return true;
    }

    if (sub === "run") {
      if (taskRunnerByConversation.has(conversationKey)) {
        await message.reply("Task runner is already running for this conversation.");
        return true;
      }
      const next = findNextPendingTask(session);
      if (!next) {
        await message.reply("No pending tasks.");
        return true;
      }
      session.taskLoop.running = true;
      session.taskLoop.stopRequested = false;
      session.taskLoop.currentTaskId = null;
      session.updatedAt = nowIso();
      await queueSaveState();

      taskRunnerByConversation.set(conversationKey, { running: true, stopRequested: false });
      await message.reply("Task runner started.");
      void kickTaskRunner(conversationKey, message.channel, session, {
        isDm: !message.guildId,
        isThread: Boolean(message.channel && message.channel.isThread && message.channel.isThread()),
      });
      return true;
    }

    if (sub === "stop") {
      requestStopConversation(conversationKey, session);
      await message.reply("Stop requested.");
      return true;
    }

    if (sub === "clear") {
      const mode = (rest || "done").toLowerCase();
      if (mode !== "done" && mode !== "all") {
        await message.reply("Usage: `/task clear [done|all]`");
        return true;
      }
      const before = session.tasks.length;
      if (mode === "all") {
        session.tasks = [];
      } else {
        session.tasks = session.tasks.filter((t) => !(t && typeof t === "object" && t.status === "done"));
      }
      session.updatedAt = nowIso();
      await queueSaveState();
      await message.reply(`Cleared ${before - session.tasks.length} task(s).`);
      return true;
    }

    await message.reply("Usage: `/task add|list|run|stop|clear`");
    return true;
  }

  if (command.name === "worktree") {
    if (CONFIG.worktreeRootDirError) {
      await message.reply(`Worktrees disabled: ${CONFIG.worktreeRootDirError}`);
      return true;
    }
    if (session.taskLoop && session.taskLoop.running) {
      await message.reply("Refusing while task runner is active. Run `/task stop` first.");
      return true;
    }

    const { head: subRaw, rest } = splitFirstToken(command.arg);
    const sub = subRaw.toLowerCase();
    if (!sub || sub === "list") {
      const repo = await resolveGitRepoRoot(session.workdir || CONFIG.defaultWorkdir);
      if (!repo.ok) {
        await message.reply(repo.error);
        return true;
      }
      const listed = await gitWorktreeList(repo.root);
      if (!listed.ok) {
        await message.reply(listed.error);
        return true;
      }
      const lines = [];
      lines.push(`repo_root: ${repo.root}`);
      if (listed.worktrees.length === 0) {
        lines.push("- (no worktrees?)");
      } else {
        for (const wt of listed.worktrees.slice(0, 30)) {
          lines.push(`- ${wt.name} ${wt.branch ? `[${wt.branch}]` : ""} -> ${wt.path}`);
        }
        if (listed.worktrees.length > 30) lines.push(`- ... (${listed.worktrees.length - 30} more)`);
      }
      await sendLongReply(message, lines.join("\n"));
      return true;
    }

    if (sub === "prune") {
      const repo = await resolveGitRepoRoot(session.workdir || CONFIG.defaultWorkdir);
      if (!repo.ok) {
        await message.reply(repo.error);
        return true;
      }
      const res = await execFileCapture("git", ["-C", repo.root, "worktree", "prune"], { cwd: repo.root });
      if (res.code !== 0) {
        await message.reply(`git worktree prune failed:\n\`\`\`\n${(res.stderr || res.stdout || "").slice(0, 1600)}\n\`\`\``);
        return true;
      }
      await message.reply("Pruned worktrees.");
      return true;
    }

    if (sub === "new") {
      const args = (rest || "").split(/\s+/).filter(Boolean);
      const nameRaw = args[0] || "";
      if (!nameRaw) {
        await message.reply("Usage: `/worktree new <name> [--from <ref>] [--use]`");
        return true;
      }
      const parsed = parseWorktreeNewArgs(args.slice(1));
      if (!parsed.ok) {
        await message.reply(parsed.error);
        return true;
      }
      const name = sanitizeWorktreeName(nameRaw);
      if (!name) {
        await message.reply("Invalid worktree name. Allowed: letters, numbers, '.', '_', '-' (no slashes).");
        return true;
      }
      const repo = await resolveGitRepoRoot(session.workdir || CONFIG.defaultWorkdir);
      if (!repo.ok) {
        await message.reply(repo.error);
        return true;
      }

      const wt = await gitWorktreeCreate(repo.root, name, parsed.fromRef);
      if (!wt.ok) {
        await message.reply(wt.error);
        return true;
      }
      if (parsed.use) {
        if (!isAllowedWorkdir(wt.path)) {
          await message.reply(`Created worktree is outside allowed roots: ${wt.path}`);
          return true;
        }
        session.workdir = wt.path;
        session.threadId = null;
        session.contextVersion = 0;
        session.updatedAt = nowIso();
        await queueSaveState();
      }
      await message.reply(
        parsed.use
          ? `Worktree created and selected: \`${wt.path}\` (branch \`${wt.branch}\`)`
          : `Worktree created: \`${wt.path}\` (branch \`${wt.branch}\`)`
      );
      return true;
    }

    if (sub === "use") {
      const nameRaw = (rest || "").split(/\s+/)[0] || "";
      if (!nameRaw) {
        await message.reply("Usage: `/worktree use <name>`");
        return true;
      }
      const name = sanitizeWorktreeName(nameRaw) || (path.isAbsolute(nameRaw) ? nameRaw : "");
      if (!name) {
        await message.reply("Invalid worktree name/path.");
        return true;
      }
      const repo = await resolveGitRepoRoot(session.workdir || CONFIG.defaultWorkdir);
      if (!repo.ok) {
        await message.reply(repo.error);
        return true;
      }
      const resolved = await resolveWorktreePath(repo.root, nameRaw);
      if (!resolved.ok) {
        await message.reply(resolved.error);
        return true;
      }
      if (!isAllowedWorkdir(resolved.path)) {
        await message.reply(`Workdir not allowed. Allowed roots: ${CONFIG.allowedWorkdirRoots.join(", ")}`);
        return true;
      }
      session.workdir = resolved.path;
      session.threadId = null;
      session.contextVersion = 0;
      session.updatedAt = nowIso();
      await queueSaveState();
      await message.reply(`Workdir set to \`${resolved.path}\`. Session reset.`);
      return true;
    }

    if (sub === "rm") {
      const tokens = (rest || "").split(/\s+/).filter(Boolean);
      const nameRaw = tokens[0] || "";
      const force = tokens.includes("--force");
      if (!nameRaw) {
        await message.reply("Usage: `/worktree rm <name> [--force]`");
        return true;
      }
      const repo = await resolveGitRepoRoot(session.workdir || CONFIG.defaultWorkdir);
      if (!repo.ok) {
        await message.reply(repo.error);
        return true;
      }
      const resolved = await resolveWorktreePath(repo.root, nameRaw);
      if (!resolved.ok) {
        await message.reply(resolved.error);
        return true;
      }
      const listed = await gitWorktreeList(repo.root);
      if (!listed.ok) {
        await message.reply(listed.error);
        return true;
      }
      const sessionWorkdir = session.workdir ? path.resolve(session.workdir) : "";
      const worktreeRoot = path.resolve(resolved.path);
      const containsActiveWorkdir = sessionWorkdir ? isSubPath(worktreeRoot, sessionWorkdir) : false;

      if (!force && containsActiveWorkdir) {
        await message.reply(
          sessionWorkdir && sessionWorkdir !== worktreeRoot
            ? `Refusing to remove a worktree that contains the active workdir: \`${sessionWorkdir}\`. Use \`--force\` if you really want this.`
            : "Refusing to remove the active workdir. Use `--force` if you really want this."
        );
        return true;
      }
      const otherWorktreePath = listed.worktrees
        .map((wt) => path.resolve(wt.path))
        .find((p) => p && p !== worktreeRoot) || "";
      const fallbackWorkdir = otherWorktreePath && isAllowedWorkdir(otherWorktreePath) ? otherWorktreePath : CONFIG.defaultWorkdir;
      const gitCwd = otherWorktreePath || repo.root;

      const removed = await gitWorktreeRemove(gitCwd, resolved.path, force);
      if (!removed.ok) {
        await message.reply(removed.error);
        return true;
      }
      if (containsActiveWorkdir) {
        session.workdir = fallbackWorkdir;
        session.threadId = null;
        session.contextVersion = 0;
        session.updatedAt = nowIso();
        await queueSaveState();
      }
      await message.reply(
        containsActiveWorkdir
          ? `Removed worktree: \`${resolved.path}\` (workdir -> \`${fallbackWorkdir}\`)`
          : `Removed worktree: \`${resolved.path}\``
      );
      return true;
    }

    await message.reply("Usage: `/worktree list|new|use|rm|prune`");
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

      let prompt = extractPrompt(message, client.user.id);
      const hasTextAttachments = hasProbablyTextAttachments(message);
      if (!prompt && !hasTextAttachments) {
        await message.reply(
          isDm || (isThread && CONFIG.threadAutoRespond)
            ? "Send a prompt, or use `/help`."
            : "Send a prompt after mentioning me, or use `/help`."
        );
        return;
      }
      if (!prompt && hasTextAttachments) {
        prompt = "Please read and follow the attached file(s).";
      }

      // Make sure the bot is joined to threads before trying to type/reply.
      if (!isDm && isThread && message.channel && typeof message.channel.join === "function" && message.channel.joinable) {
        message.channel.join().catch(() => {});
      }

      const key = getConversationKey(message);
      const session = getSession(key);

      const command = parseCommand(prompt);
      if (command) {
        // Step 3 robustness: refuse workdir/session control while task runner is active.
        if (isTaskRunnerActive(key, session)) {
          const isDangerous =
            command.name === "workdir" ||
            command.name === "reset" ||
            command.name === "attach" ||
            (command.name === "context" && command.arg.toLowerCase() === "reload");
          if (isDangerous) {
            await message.reply("Refusing while task runner is active. Run `/task stop` first.");
            return;
          }
        }
        // `/task stop` must be responsive; handle it outside the per-conversation queue so
        // it can kill an in-flight child process immediately.
        if (command.name === "task") {
          const { head: subRaw } = splitFirstToken(command.arg);
          if (subRaw && subRaw.toLowerCase() === "stop") {
            requestStopConversation(key, session);
            await message.reply("Stop requested.");
            return;
          }
        }
        await enqueueConversation(key, async () => handleCommand(message, session, command, key));
        return;
      }

      await runAgentAndPostToDiscord({
        baseMessage: message,
        channel: message.channel,
        session,
        conversationKey: key,
        prompt,
        isDm,
        isThread,
        reasonLabel: "user message",
        postFullOutput: true,
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
