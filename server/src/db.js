// Reliable JSON file-based storage with:
// - Atomic writes (write to temp then rename) to prevent corruption
// - Debounced saves with a small delay between concurrent ops
// - Automatic hourly backups (kept for 24h)
// - Automatic cleanup of sessions older than 7 days
// - Robust error handling for read/write operations

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "fs";
import { dirname, join, basename } from "path";

const dbPath = process.env.DB_PATH || "./data/chat.json";
const backupDir = join(dirname(dbPath), "backups");
const MAX_MESSAGE_LENGTH = 5000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BACKUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let data = { sessions: {}, messages: {}, _msgIdCounter: 0 };
let saveTimer = null;
let isWriting = false;
let writeQueue = false;
let maintenanceTimers = [];

// ---------- Directory setup ----------
function ensureDirs() {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
    mkdirSync(backupDir, { recursive: true });
  } catch (e) {
    console.error("[DB] ensureDirs error:", e.message);
  }
}

// ---------- Atomic write ----------
function atomicWrite(path, content) {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, "utf-8");
  // Atomic rename — on Windows, rename fails if target exists, so try/catch
  try {
    renameSync(tmp, path);
  } catch {
    try {
      unlinkSync(path);
    } catch {}
    renameSync(tmp, path);
  }
}

// ---------- Load with error recovery ----------
function load() {
  ensureDirs();
  try {
    if (existsSync(dbPath)) {
      const raw = readFileSync(dbPath, "utf-8");
      const parsed = JSON.parse(raw);
      data = {
        sessions: parsed.sessions || {},
        messages: parsed.messages || {},
        _msgIdCounter: parsed._msgIdCounter || 0,
      };
      console.log(
        `[DB] Loaded ${Object.keys(data.sessions).length} sessions, ` +
          `${Object.values(data.messages).reduce((a, m) => a + m.length, 0)} messages`
      );
    } else {
      // Try to recover from latest backup
      const latest = getLatestBackup();
      if (latest) {
        console.warn(`[DB] Main DB missing. Restoring from backup: ${latest}`);
        const raw = readFileSync(latest, "utf-8");
        const parsed = JSON.parse(raw);
        data = {
          sessions: parsed.sessions || {},
          messages: parsed.messages || {},
          _msgIdCounter: parsed._msgIdCounter || 0,
        };
        save();
      } else {
        console.log("[DB] No existing DB. Starting fresh.");
      }
    }
  } catch (e) {
    console.error("[DB] Load error:", e.message);
    // Attempt recovery from backup
    const latest = getLatestBackup();
    if (latest) {
      try {
        console.warn(`[DB] Recovering from backup: ${latest}`);
        const raw = readFileSync(latest, "utf-8");
        const parsed = JSON.parse(raw);
        data = {
          sessions: parsed.sessions || {},
          messages: parsed.messages || {},
          _msgIdCounter: parsed._msgIdCounter || 0,
        };
      } catch (e2) {
        console.error("[DB] Backup recovery also failed:", e2.message);
        data = { sessions: {}, messages: {}, _msgIdCounter: 0 };
      }
    } else {
      data = { sessions: {}, messages: {}, _msgIdCounter: 0 };
    }
  }
}

// ---------- Save (debounced + serialized) ----------
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 150);
}

function doSave() {
  if (isWriting) {
    writeQueue = true;
    return;
  }
  isWriting = true;
  try {
    const content = JSON.stringify(data, null, 2);
    atomicWrite(dbPath, content);
  } catch (e) {
    console.error("[DB] Save error:", e.message);
  } finally {
    isWriting = false;
    if (writeQueue) {
      writeQueue = false;
      // Small delay to prevent rapid concurrent writes
      setTimeout(doSave, 50);
    }
  }
}

// Force immediate flush (used on shutdown)
export function flushDB() {
  clearTimeout(saveTimer);
  try {
    const content = JSON.stringify(data, null, 2);
    atomicWrite(dbPath, content);
    console.log("[DB] Flushed to disk.");
  } catch (e) {
    console.error("[DB] Flush error:", e.message);
  }
}

// ---------- Backups ----------
function getLatestBackup() {
  try {
    const files = readdirSync(backupDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, mtime: statSync(join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length ? join(backupDir, files[0].f) : null;
  } catch {
    return null;
  }
}

function createBackup() {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDir, `chat_${stamp}.json`);
    const content = JSON.stringify(data, null, 2);
    writeFileSync(backupPath, content, "utf-8");
    console.log(`[DB] Backup created: ${basename(backupPath)}`);
  } catch (e) {
    console.error("[DB] Backup error:", e.message);
  }
}

function cleanOldBackups() {
  try {
    const now = Date.now();
    for (const f of readdirSync(backupDir)) {
      if (!f.endsWith(".json")) continue;
      const fp = join(backupDir, f);
      const stat = statSync(fp);
      if (now - stat.mtimeMs > BACKUP_TTL_MS) {
        unlinkSync(fp);
        console.log(`[DB] Removed old backup: ${f}`);
      }
    }
  } catch (e) {
    console.error("[DB] Backup cleanup error:", e.message);
  }
}

// ---------- Session cleanup (older than 7 days) ----------
function cleanOldSessions() {
  const now = Date.now();
  let removed = 0;
  for (const sid of Object.keys(data.sessions)) {
    const s = data.sessions[sid];
    const lastActivity =
      (data.messages[sid] && data.messages[sid].length
        ? data.messages[sid][data.messages[sid].length - 1].timestamp
        : s.createdAt) || s.createdAt;
    if (now - lastActivity > SESSION_TTL_MS) {
      delete data.sessions[sid];
      delete data.messages[sid];
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[DB] Cleaned ${removed} old sessions.`);
    save();
  }
}

// ---------- Maintenance scheduler ----------
export function startMaintenance() {
  // Initial run shortly after start
  setTimeout(() => {
    cleanOldSessions();
    createBackup();
    cleanOldBackups();
  }, 5000);

  // Hourly backup
  const backupTimer = setInterval(() => {
    createBackup();
    cleanOldBackups();
  }, BACKUP_INTERVAL_MS);
  maintenanceTimers.push(backupTimer);

  // Periodic cleanup
  const cleanupTimer = setInterval(() => {
    cleanOldSessions();
  }, CLEANUP_INTERVAL_MS);
  maintenanceTimers.push(cleanupTimer);

  // Unref so timers don't keep process alive during shutdown
  backupTimer.unref();
  cleanupTimer.unref();
}

export function stopMaintenance() {
  for (const t of maintenanceTimers) clearInterval(t);
  maintenanceTimers = [];
}

// ---------- Initialize ----------
load();

// ---------- Public API ----------
export function createSession(sessionId, userAgent) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("Invalid sessionId");
  }
  if (!data.sessions[sessionId]) {
    data.sessions[sessionId] = {
      sessionId,
      userAgent: String(userAgent || "").slice(0, 500),
      createdAt: Date.now(),
      endedAt: null,
      status: "active",
    };
    data.messages[sessionId] = [];
    save();
  }
  return getSession(sessionId);
}

export function getSession(sessionId) {
  return data.sessions[sessionId] || null;
}

export function getActiveSessions() {
  return Object.values(data.sessions).filter((s) => s.status === "active");
}

export function endSession(sessionId) {
  if (data.sessions[sessionId]) {
    data.sessions[sessionId].status = "ended";
    data.sessions[sessionId].endedAt = Date.now();
    save();
  }
}

export function clearMessages(sessionId) {
  data.messages[sessionId] = [];
  save();
}

export function addMessage(sessionId, sender, content) {
  if (!sessionId || !sender || !content) return null;
  if (!data.messages[sessionId]) data.messages[sessionId] = [];
  if (!data.sessions[sessionId]) {
    // Auto-create session if message arrives for unknown session
    createSession(sessionId, "");
  }
  const msg = {
    id: ++data._msgIdCounter,
    sessionId,
    sender: sender === "admin" ? "admin" : "user",
    content: String(content).slice(0, MAX_MESSAGE_LENGTH),
    timestamp: Date.now(),
    isRead: false,
  };
  data.messages[sessionId].push(msg);
  save();
  return msg;
}

export function getMessages(sessionId) {
  return (data.messages[sessionId] || [])
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function markMessagesRead(sessionId, sender) {
  (data.messages[sessionId] || []).forEach((m) => {
    if (m.sender === sender) m.isRead = true;
  });
  save();
}

export function getUnreadCount(sessionId, sender) {
  return (data.messages[sessionId] || []).filter(
    (m) => m.sender === sender && !m.isRead
  ).length;
}

export function getLastMessage(sessionId) {
  const arr = data.messages[sessionId] || [];
  return arr.length ? arr[arr.length - 1] : null;
}
