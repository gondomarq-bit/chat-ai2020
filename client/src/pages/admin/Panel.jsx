import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  LogOut,
  Trash2,
  MessageSquare,
  Users,
  Volume2,
  VolumeX,
  X,
  Circle,
  RefreshCw,
  Bot,
  User,
  Zap,
  Hand,
} from "lucide-react";
import axios from "axios";
import toast from "react-hot-toast";
import { useSocket } from "../../context/SocketContext.jsx";
import { apiUrl } from "../../config.js";
import MessageBubble from "../../components/MessageBubble.jsx";
import TypingIndicator from "../../components/TypingIndicator.jsx";

const TOKEN_KEY = "admin_token";

// Axios instance with auth interceptor
const api = axios.create({});
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = "/admin/login";
    }
    return Promise.reject(err);
  }
);

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "الآن";
  if (s < 3600) return `${Math.floor(s / 60)} د`;
  if (s < 86400) return `${Math.floor(s / 3600)} س`;
  return new Date(ts).toLocaleDateString("ar");
}

export default function AdminPanel() {
  const socket = useSocket();
  const navigate = useNavigate();

  const [authed, setAuthed] = useState(() => !!localStorage.getItem(TOKEN_KEY));
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState({});
  const [input, setInput] = useState("");
  const [typingMap, setTypingMap] = useState({});
  const [soundOn, setSoundOn] = useState(
    () => localStorage.getItem("admin_sound") !== "off"
  );
  const [totalUnread, setTotalUnread] = useState(0);
  const [openTabs, setOpenTabs] = useState([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [aiStatus, setAiStatus] = useState({ enabled: false, mode: "human" });
  const [sessionModes, setSessionModes] = useState({}); // per-session AI mode
  const [aiReplying, setAiReplying] = useState({}); // sessions where AI is currently replying

  const audioCtx = useRef(null);
  const messagesEnd = useRef(null);
  const typingTimers = useRef({});

  // Auth guard
  useEffect(() => {
    if (!authed) navigate("/admin/login");
  }, [authed, navigate]);

  // Beep
  const beep = useCallback(() => {
    if (!soundOn) return;
    try {
      audioCtx.current =
        audioCtx.current || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx.current;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      o.start();
      o.stop(ctx.currentTime + 0.4);
    } catch {}
  }, [soundOn]);

  useEffect(() => {
    localStorage.setItem("admin_sound", soundOn ? "on" : "off");
  }, [soundOn]);

  // Load AI status
  useEffect(() => {
    if (!authed) return;
    api
      .get(apiUrl("/api/ai/status"))
      .then(({ data }) => setAiStatus(data))
      .catch(() => {});
  }, [authed]);

  // Load AI mode when opening a session
  const loadSessionMode = useCallback(async (sid) => {
    try {
      const { data } = await api.get(apiUrl(`/api/admin/ai/${sid}/mode`));
      setSessionModes((prev) => ({ ...prev, [sid]: data.mode }));
    } catch {}
  }, []);

  // Change AI mode for a session
  const changeSessionMode = useCallback(
    async (sid, mode) => {
      try {
        await api.post(apiUrl(`/api/admin/ai/${sid}/mode`), { mode });
        setSessionModes((prev) => ({ ...prev, [sid]: mode }));
        toast.success(
          mode === "ai" ? "وضع AI مفعّل" : mode === "human" ? "وضع بشري مفعّل" : "وضع هجين مفعّل"
        );
      } catch {
        toast.error("تعذر تغيير الوضع");
      }
    },
    []
  );

  // Take over a session (pause AI)
  const takeOverSession = useCallback(async (sid) => {
    try {
      await api.post(apiUrl(`/api/admin/ai/${sid}/takeover`));
      setSessionModes((prev) => ({ ...prev, [sid]: "human" }));
      toast.success("تم الاستيلاء على المحادثة - AI متوقف");
    } catch {
      toast.error("تعذر الاستيلاء");
    }
  }, []);

  // Release AI takeover
  const releaseSession = useCallback(async (sid) => {
    try {
      await api.post(apiUrl(`/api/admin/ai/${sid}/release`));
      setSessionModes((prev) => ({ ...prev, [sid]: "hybrid" }));
      toast.success("تم إعادة تفعيل AI");
    } catch {
      toast.error("تعذر إعادة AI");
    }
  }, []);

  // Load sessions
  const loadSessions = useCallback(async () => {
    if (!authed) return;
    try {
      const { data } = await api.get(apiUrl("/api/admin/sessions"));
      setSessions(data);
      setTotalUnread(data.reduce((a, s) => a + (s.unreadCount || 0), 0));
    } catch (err) {
      if (err.response?.status === 401) {
        setAuthed(false);
      }
    }
  }, [authed]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    loadSessions();
    const t = setInterval(loadSessions, 30000);
    return () => clearInterval(t);
  }, [loadSessions]);

  // Socket
  useEffect(() => {
    if (!socket || !authed) return;
    socket.emit("admin_join");

    const onConnect = () => {
      setReconnecting(false);
      socket.emit("admin_join");
    };
    const onDisconnect = () => setReconnecting(true);
    const onReconnect = () => {
      setReconnecting(false);
      socket.emit("admin_join");
      // Re-join all open session rooms
      openTabs.forEach((sid) => socket.emit("admin_open_session", { sessionId: sid }));
      loadSessions();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("reconnect", onReconnect);

    socket.on("admin_message", (msg) => {
      beep();
      setMessages((prev) => ({
        ...prev,
        [msg.sessionId]: prev[msg.sessionId]
          ? [...prev[msg.sessionId], msg]
          : [msg],
      }));
      setSessions((prev) =>
        prev.map((s) =>
          s.sessionId === msg.sessionId
            ? { ...s, lastMessage: msg.content, lastActivity: msg.timestamp }
            : s
        )
      );
      loadSessions();
    });

    socket.on("message", (msg) => {
      setMessages((prev) => ({
        ...prev,
        [msg.sessionId]: prev[msg.sessionId]
          ? [...prev[msg.sessionId], msg]
          : [msg],
      }));
    });

    socket.on("user_connected", () => loadSessions());
    socket.on("user_disconnected", () => loadSessions());
    socket.on("messages_read", () => loadSessions());

    socket.on("typing", ({ sessionId, role }) => {
      if (role !== "user") return;
      setTypingMap((p) => ({ ...p, [sessionId]: true }));
      clearTimeout(typingTimers.current[sessionId]);
      typingTimers.current[sessionId] = setTimeout(() => {
        setTypingMap((p) => ({ ...p, [sessionId]: false }));
      }, 3000);
    });

    socket.on("stop_typing", ({ sessionId, role }) => {
      if (role !== "user") return;
      setTypingMap((p) => ({ ...p, [sessionId]: false }));
    });

    socket.on("session_ended", ({ sessionId }) => {
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      setOpenTabs((prev) => prev.filter((id) => id !== sessionId));
      if (activeId === sessionId) setActiveId(null);
      toast("انتهت محادثة من المستخدم");
    });

    socket.on("messages_cleared", ({ sessionId }) => {
      setMessages((prev) => ({ ...prev, [sessionId]: [] }));
    });

    // AI events
    socket.on("ai_replying", ({ sessionId }) => {
      setAiReplying((prev) => ({ ...prev, [sessionId]: true }));
    });

    socket.on("ai_replying_stopped", ({ sessionId }) => {
      setAiReplying((prev) => ({ ...prev, [sessionId]: false }));
    });

    socket.on("ai_mode_changed", ({ sessionId, mode }) => {
      setSessionModes((prev) => ({ ...prev, [sessionId]: mode }));
    });

    socket.on("ai_failed", ({ sessionId, error }) => {
      setAiReplying((prev) => ({ ...prev, [sessionId]: false }));
      toast.error(`فشل AI في ${sessionId.slice(-6)}: ${error}`);
    });

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("reconnect", onReconnect);
      socket.off("admin_message");
      socket.off("message");
      socket.off("user_connected");
      socket.off("user_disconnected");
      socket.off("messages_read");
      socket.off("typing");
      socket.off("stop_typing");
      socket.off("session_ended");
      socket.off("messages_cleared");
      socket.off("ai_replying");
      socket.off("ai_replying_stopped");
      socket.off("ai_mode_changed");
      socket.off("ai_failed");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, authed, beep, loadSessions]);

  // Open a session
  const openSession = useCallback(
    async (sid) => {
      setActiveId(sid);
      setOpenTabs((prev) => (prev.includes(sid) ? prev : [...prev, sid]));
      socket?.emit("admin_open_session", { sessionId: sid });
      try {
        const { data } = await api.get(apiUrl(`/api/admin/messages/${sid}`));
        setMessages((prev) => ({ ...prev, [sid]: data }));
        loadSessions();
        loadSessionMode(sid);
      } catch {
        toast.error("تعذر تحميل الرسائل");
      }
    },
    [socket, loadSessions, loadSessionMode]
  );

  // Auto scroll
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeId, typingMap]);

  const send = useCallback(() => {
    const content = input.trim();
    if (!content || !socket || !activeId) return;
    socket.emit("admin_message", { sessionId: activeId, content });
    setInput("");
  }, [input, socket, activeId]);

  const closeTab = (sid) => {
    setOpenTabs((prev) => prev.filter((id) => id !== sid));
    if (activeId === sid) {
      const remaining = openTabs.filter((id) => id !== sid);
      setActiveId(remaining[remaining.length - 1] || null);
    }
  };

  const endChat = async () => {
    if (!activeId) return;
    if (!confirm("إنهاء هذه المحادثة؟")) return;
    try {
      await api.post(apiUrl(`/api/admin/sessions/${activeId}/end`));
      setSessions((prev) => prev.filter((s) => s.sessionId !== activeId));
      setOpenTabs((prev) => prev.filter((id) => id !== activeId));
      setActiveId(null);
      toast.success("تم إنهاء المحادثة");
    } catch {
      toast.error("تعذر إنهاء المحادثة");
    }
  };

  const clearHistory = async () => {
    if (!activeId) return;
    if (!confirm("مسح سجل هذه المحادثة؟")) return;
    try {
      await api.post(apiUrl(`/api/admin/messages/${activeId}/clear`));
      setMessages((prev) => ({ ...prev, [activeId]: [] }));
      toast.success("تم مسح السجل");
    } catch {
      toast.error("تعذر مسح السجل");
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthed(false);
    navigate("/admin/login");
  };

  if (!authed) return null;

  const activeMessages = activeId ? messages[activeId] || [] : [];

  return (
    <div className="flex h-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 border-l border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-800">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-blue-500" />
            <h2 className="font-bold text-sm">المحادثات النشطة</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={loadSessions}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              title="تحديث"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={() => setSoundOn((s) => !s)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              title={soundOn ? "كتم الصوت" : "تشغيل الصوت"}
            >
              {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>
        </div>

        {reconnecting && (
          <div className="bg-yellow-500/90 text-white text-[11px] text-center py-1 flex items-center justify-center gap-1">
            <RefreshCw size={10} className="animate-spin" />
            إعادة الاتصال...
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-400">
              لا توجد محادثات نشطة
            </div>
          )}
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              onClick={() => openSession(s.sessionId)}
              className={`w-full text-right px-4 py-3 border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition flex items-start gap-2 ${
                activeId === s.sessionId ? "bg-blue-50 dark:bg-blue-900/30" : ""
              }`}
            >
              <div className="relative shrink-0 mt-1">
                <MessageSquare size={16} className="text-gray-400" />
                {s.unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center">
                    {s.unreadCount > 9 ? "9+" : s.unreadCount}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-gray-500 truncate">
                  #{s.sessionId.slice(-6)}
                </p>
                <p className="text-sm truncate text-gray-700 dark:text-gray-200">
                  {s.lastMessage || "بدون رسائل"}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {timeAgo(s.lastActivity)}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 py-2 rounded-lg transition"
          >
            <LogOut size={16} className="rtl:rotate-180" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        {openTabs.length > 0 && (
          <div className="flex items-center gap-1 px-2 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto">
            {openTabs.map((sid) => (
              <div
                key={sid}
                onClick={() => setActiveId(sid)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs cursor-pointer whitespace-nowrap ${
                  activeId === sid
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                }`}
              >
                <span>#{sid.slice(-6)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(sid);
                  }}
                  className="hover:text-red-300"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!activeId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <MessageSquare size={48} className="mb-3 opacity-50" />
            <p className="text-sm">اختر محادثة من القائمة للبدء</p>
            {totalUnread > 0 && (
              <p className="text-xs mt-2 text-red-500">
                {totalUnread} رسالة غير مقروءة
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Circle size={8} className="text-green-500 fill-green-500" />
                <span className="text-sm font-mono">#{activeId.slice(-6)}</span>
                {aiReplying[activeId] && (
                  <span className="flex items-center gap-1 text-[10px] bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 px-2 py-0.5 rounded-full">
                    <Bot size={10} className="animate-pulse" />
                    AI يرد...
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {/* AI mode controls */}
                {aiStatus.enabled && (
                  <div className="flex items-center gap-1 ml-2 pl-2 border-l border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => changeSessionMode(activeId, "ai")}
                      className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition ${
                        sessionModes[activeId] === "ai"
                          ? "bg-purple-600 text-white"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/30"
                      }`}
                      title="AI يرد تلقائياً"
                    >
                      <Bot size={12} />
                      AI
                    </button>
                    <button
                      onClick={() => changeSessionMode(activeId, "hybrid")}
                      className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition ${
                        sessionModes[activeId] === "hybrid"
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                      }`}
                      title="هجين: AI + تدخل بشري"
                    >
                      <Zap size={12} />
                      هجين
                    </button>
                    <button
                      onClick={() => changeSessionMode(activeId, "human")}
                      className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition ${
                        sessionModes[activeId] === "human"
                          ? "bg-green-600 text-white"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-green-100 dark:hover:bg-green-900/30"
                      }`}
                      title="بشري فقط"
                    >
                      <User size={12} />
                      بشري
                    </button>
                  </div>
                )}
                {/* Take over button */}
                {aiStatus.enabled && sessionModes[activeId] !== "human" && (
                  <button
                    onClick={() => takeOverSession(activeId)}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/50 transition"
                    title="استيلاء بشري - إيقاف AI"
                  >
                    <Hand size={12} />
                    استيلاء
                  </button>
                )}
                {/* Release button */}
                {aiStatus.enabled && sessionModes[activeId] === "human" && (
                  <button
                    onClick={() => releaseSession(activeId)}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition"
                    title="إعادة تفعيل AI"
                  >
                    <Bot size={12} />
                    إعادة AI
                  </button>
                )}
                <button
                  onClick={clearHistory}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                  title="مسح السجل"
                >
                  <Trash2 size={16} />
                </button>
                <button
                  onClick={endChat}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-red-500"
                  title="إنهاء المحادثة"
                >
                  <LogOut size={16} className="rtl:rotate-180" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto py-3">
              {activeMessages.length === 0 && !typingMap[activeId] && (
                <div className="h-full flex items-center justify-center text-sm text-gray-400">
                  لا توجد رسائل بعد
                </div>
              )}
              {activeMessages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  isUser={m.sender === "user"}
                />
              ))}
              <AnimatePresence>
                {typingMap[activeId] && <TypingIndicator label="المستخدم يكتب" />}
              </AnimatePresence>
              <div ref={messagesEnd} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder="اكتب ردك..."
                  className="flex-1 resize-none bg-gray-100 dark:bg-gray-700 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 max-h-32 text-gray-900 dark:text-white"
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || reconnecting}
                  className="w-11 h-11 shrink-0 rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white flex items-center justify-center transition"
                >
                  <Send size={18} className="rtl:rotate-180" />
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
