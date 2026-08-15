import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import helmet from "helmet";
import compression from "compression";
import { createServer } from "http";
import { Server } from "socket.io";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  createSession,
  getSession,
  getActiveSessions,
  endSession,
  clearMessages,
  addMessage,
  getMessages,
  markMessagesRead,
  getUnreadCount,
  getLastMessage,
  startMaintenance,
  stopMaintenance,
  flushDB,
} from "./db.js";
import { AI_CONFIG } from "./config/aiConfig.js";
import { generateResponse, getAIStatus } from "./services/aiService.js";

dotenv.config();

// ---------- AI mode management (per session) ----------
// sessionModes: { [sessionId]: "hybrid" | "ai" | "human" }
// humanTakeover: { [sessionId]: true } - admin took over, AI paused
const sessionModes = {};
const humanTakeover = {};

function getSessionMode(sessionId) {
  return sessionModes[sessionId] || AI_CONFIG.defaultMode;
}

function setSessionMode(sessionId, mode) {
  sessionModes[sessionId] = mode;
  if (mode === "human") {
    humanTakeover[sessionId] = true;
  } else {
    delete humanTakeover[sessionId];
  }
}

function isAITurn(sessionId) {
  const mode = getSessionMode(sessionId);
  if (mode === "human") return false;
  if (humanTakeover[sessionId]) return false;
  if (!AI_CONFIG.enabled) return false;
  return true; // hybrid or ai mode
}

const isProduction = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 5000;

// CORS: في الإنتاج نسمح بأي مصدر، في التطوير نحدد CLIENT_URL
const corsOrigin = isProduction
  ? true // يسمح بمصدر الطلب نفسه (credentials مع same-origin)
  : process.env.CLIENT_URL || "*";

const app = express();
const httpServer = createServer(app);

// ---------- Security & performance middleware ----------
app.use(
  helmet({
    contentSecurityPolicy: false, // Socket.io يحتاج اتصالات مفتوحة
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

// Trust proxy (Railway يمرر عبر proxy)
app.set("trust proxy", 1);

// ---------- Request logging (lightweight) ----------
app.use((req, _res, next) => {
  if (!isProduction || req.path === "/health") {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ---------- Health check ----------
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
    env: process.env.NODE_ENV || "development",
  });
});

// ---------- Auth ----------
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

if (isProduction && JWT_SECRET === "dev_secret_change_me") {
  console.warn(
    "[WARNING] JWT_SECRET is using default value! Set a strong secret in Railway env vars."
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "لم يتم تقديم رمز المصادقة" });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "رمز المصادقة غير صالح أو منتهي" });
  }
}

app.post("/api/admin/login", (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (
      !username ||
      !password ||
      username !== ADMIN_USERNAME ||
      !bcrypt.compareSync(password, passwordHash)
    ) {
      return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
    }
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ token, username });
  } catch (err) {
    next(err);
  }
});

// ---------- Public chat API ----------
// Always generate a NEW unique session ID for each request.
// This ensures every user gets their own isolated chat session.
app.post("/api/session", (req, res, next) => {
  try {
    // Generate a unique session ID using crypto.randomUUID
    const sessionId = `s_${crypto.randomUUID()}`;
    const ua = req.headers["user-agent"] || "";
    const session = createSession(sessionId, ua);
    res.json({ sessionId, session });
  } catch (err) {
    next(err);
  }
});

app.get("/api/messages/:sessionId", (req, res, next) => {
  try {
    res.json(getMessages(req.params.sessionId));
  } catch (err) {
    next(err);
  }
});

app.post("/api/messages/:sessionId/end", (req, res, next) => {
  try {
    endSession(req.params.sessionId);
    io.to(`session_${req.params.sessionId}`).emit("session_ended", {
      sessionId: req.params.sessionId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- AI API endpoints ----------
// Get AI status (public, for frontend display)
app.get("/api/ai/status", (_req, res) => {
  res.json(getAIStatus());
});

// Admin: get AI mode for a session
app.get("/api/admin/ai/:sessionId/mode", authMiddleware, (req, res) => {
  res.json({
    sessionId: req.params.sessionId,
    mode: getSessionMode(req.params.sessionId),
    humanTakeover: !!humanTakeover[req.params.sessionId],
  });
});

// Admin: set AI mode for a session
app.post("/api/admin/ai/:sessionId/mode", authMiddleware, (req, res, next) => {
  try {
    const { mode } = req.body || {};
    if (!["hybrid", "ai", "human"].includes(mode)) {
      return res.status(400).json({ error: "Invalid mode. Use: hybrid, ai, or human" });
    }
    setSessionMode(req.params.sessionId, mode);
    // Notify the user's room about mode change
    io.to(`session_${req.params.sessionId}`).emit("ai_mode_changed", {
      sessionId: req.params.sessionId,
      mode,
    });
    io.to("admin").emit("ai_mode_changed", {
      sessionId: req.params.sessionId,
      mode,
    });
    res.json({ ok: true, mode });
  } catch (err) {
    next(err);
  }
});

// Admin: take over a session (pause AI, admin will reply)
app.post("/api/admin/ai/:sessionId/takeover", authMiddleware, (req, res, next) => {
  try {
    humanTakeover[req.params.sessionId] = true;
    io.to(`session_${req.params.sessionId}`).emit("ai_mode_changed", {
      sessionId: req.params.sessionId,
      mode: "human",
    });
    io.to("admin").emit("ai_mode_changed", {
      sessionId: req.params.sessionId,
      mode: "human",
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Admin: release takeover (let AI resume)
app.post("/api/admin/ai/:sessionId/release", authMiddleware, (req, res, next) => {
  try {
    delete humanTakeover[req.params.sessionId];
    const mode = getSessionMode(req.params.sessionId);
    io.to(`session_${req.params.sessionId}`).emit("ai_mode_changed", {
      sessionId: req.params.sessionId,
      mode,
    });
    io.to("admin").emit("ai_mode_changed", {
      sessionId: req.params.sessionId,
      mode,
    });
    res.json({ ok: true, mode });
  } catch (err) {
    next(err);
  }
});

// ---------- Admin API ----------
app.get("/api/admin/sessions", authMiddleware, (req, res, next) => {
  try {
    const sessions = getActiveSessions().map((s) => {
      const last = getLastMessage(s.sessionId);
      return {
        ...s,
        lastMessage: last ? last.content : "",
        lastActivity: last ? last.timestamp : s.createdAt,
        unreadCount: getUnreadCount(s.sessionId, "user"),
      };
    });
    sessions.sort((a, b) => b.lastActivity - a.lastActivity);
    res.json(sessions);
  } catch (err) {
    next(err);
  }
});

app.get("/api/admin/messages/:sessionId", authMiddleware, (req, res, next) => {
  try {
    markMessagesRead(req.params.sessionId, "user");
    io.to("admin").emit("messages_read", { sessionId: req.params.sessionId });
    res.json(getMessages(req.params.sessionId));
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/messages/:sessionId/clear", authMiddleware, (req, res, next) => {
  try {
    clearMessages(req.params.sessionId);
    io.to(`session_${req.params.sessionId}`).emit("messages_cleared", {
      sessionId: req.params.sessionId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post("/api/admin/sessions/:sessionId/end", authMiddleware, (req, res, next) => {
  try {
    endSession(req.params.sessionId);
    io.to(`session_${req.params.sessionId}`).emit("session_ended", {
      sessionId: req.params.sessionId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Serve built frontend (production) ----------
const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "..", "public");
if (isProduction && existsSync(clientDist)) {
  app.use(express.static(clientDist, { maxAge: "1h", index: false }));
  // SPA fallback: serve index.html for non-API routes
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
      return next();
    }
    res.sendFile(join(clientDist, "index.html"));
  });
  console.log(`[Static] Serving frontend from ${clientDist}`);
}

// ---------- 404 handler ----------
app.use((req, res) => {
  res.status(404).json({ error: "المسار غير موجود", path: req.path });
});

// ---------- Global error handler ----------
app.use((err, req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(err.status || 500).json({
    error: isProduction ? "خطأ داخلي في الخادم" : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
});

// ---------- Socket.io ----------
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    credentials: true,
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 1e6, // 1MB
  pingInterval: 25000,
  pingTimeout: 20000,
});

// Make io accessible to route handlers if needed
app.set("io", io);

io.on("connection", (socket) => {
  console.log(`[Socket] connected: ${socket.id}`);

  socket.on("user_join", ({ sessionId }) => {
    if (!sessionId) return;
    socket.join(`session_${sessionId}`);
    socket.data.sessionId = sessionId;
    socket.data.role = "user";
    io.to("admin").emit("user_connected", { sessionId });
  });

  socket.on("admin_join", () => {
    socket.join("admin");
    socket.data.role = "admin";
  });

  socket.on("admin_open_session", ({ sessionId }) => {
    if (sessionId) socket.join(`session_${sessionId}`);
  });

  socket.on("user_message", ({ sessionId, content }) => {
    if (!sessionId || !content || typeof content !== "string") return;
    const safe = content.slice(0, 5000);
    const msg = addMessage(sessionId, "user", safe);
    io.to(`session_${sessionId}`).emit("message", msg);
    io.to("admin").emit("admin_message", { ...msg, unread: true });

    // ---------- AI auto-reply (hybrid/ai mode) ----------
    if (isAITurn(sessionId)) {
      // Show typing indicator to user
      io.to(`session_${sessionId}`).emit("typing", { sessionId, role: "admin" });
      io.to("admin").emit("ai_replying", { sessionId });

      // Generate AI response asynchronously
      (async () => {
        try {
          const result = await generateResponse(sessionId);

          // Stop typing indicator
          io.to(`session_${sessionId}`).emit("stop_typing", { sessionId, role: "admin" });
          io.to("admin").emit("ai_replying_stopped", { sessionId });

          if (result.success && result.response) {
            // Check if admin took over while AI was generating
            if (humanTakeover[sessionId]) {
              console.log(`[AI] Admin took over during generation for ${sessionId.slice(-6)}, discarding AI reply`);
              return;
            }
            // Save and send AI response
            const aiMsg = addMessage(sessionId, "admin", result.response);
            io.to(`session_${sessionId}`).emit("message", aiMsg);
            io.to("admin").emit("message", { ...aiMsg, isAI: true });
            console.log(`[AI] Reply sent for session ${sessionId.slice(-6)}`);
          } else {
            // AI failed - notify admin to take over
            console.warn(`[AI] Fallback for session ${sessionId.slice(-6)}: ${result.error}`);
            io.to("admin").emit("ai_failed", {
              sessionId,
              error: result.error,
              fallbackToHuman: result.fallbackToHuman,
            });
            // Notify user that a human will respond
            if (result.fallbackToHuman) {
              const fallbackMsg = addMessage(
                sessionId,
                "admin",
                "عذراً، المساعد الآلي غير متاح حالياً. سيقوم فريقنا بالرد عليك قريباً."
              );
              io.to(`session_${sessionId}`).emit("message", fallbackMsg);
              io.to("admin").emit("admin_message", { ...fallbackMsg, unread: true });
            }
          }
        } catch (err) {
          console.error("[AI] Unexpected error in auto-reply:", err);
          io.to(`session_${sessionId}`).emit("stop_typing", { sessionId, role: "admin" });
          io.to("admin").emit("ai_replying_stopped", { sessionId });
          io.to("admin").emit("ai_failed", {
            sessionId,
            error: "Unexpected AI error",
            fallbackToHuman: true,
          });
        }
      })();
    }
  });

  socket.on("admin_message", ({ sessionId, content }) => {
    if (!sessionId || !content || typeof content !== "string") return;
    const safe = content.slice(0, 5000);
    const msg = addMessage(sessionId, "admin", safe);
    io.to(`session_${sessionId}`).emit("message", msg);
    io.to("admin").emit("message", msg);
  });

  socket.on("typing", ({ sessionId, role }) => {
    const target = role === "user" ? "admin" : `session_${sessionId}`;
    io.to(target).emit("typing", { sessionId, role });
  });

  socket.on("stop_typing", ({ sessionId, role }) => {
    const target = role === "user" ? "admin" : `session_${sessionId}`;
    io.to(target).emit("stop_typing", { sessionId, role });
  });

  socket.on("disconnect", (reason) => {
    console.log(`[Socket] disconnected: ${socket.id} (${reason})`);
    if (socket.data.role === "user" && socket.data.sessionId) {
      io.to("admin").emit("user_disconnected", { sessionId: socket.data.sessionId });
    }
  });
});

// ---------- Start maintenance tasks (backup + cleanup) ----------
startMaintenance();

// ---------- Graceful shutdown ----------
let isShuttingDown = false;
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Shutdown] Received ${signal}. Closing gracefully...`);

  // Stop accepting new connections
  httpServer.close(() => {
    console.log("[Shutdown] HTTP server closed.");
  });

  // Close all socket connections
  io.close(() => {
    console.log("[Shutdown] Socket.io closed.");
  });

  // Flush DB and stop maintenance
  stopMaintenance();
  flushDB();

  // Force exit after 10s if still hanging
  setTimeout(() => {
    console.log("[Shutdown] Forcing exit.");
    process.exit(0);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err);
  gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection:", reason);
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || "development"})`);
});
