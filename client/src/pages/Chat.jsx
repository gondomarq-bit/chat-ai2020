import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Moon, Sun, LogOut, Trash2, WifiOff, RefreshCw } from "lucide-react";
import axios from "axios";
import toast from "react-hot-toast";
import { useSocket } from "../context/SocketContext.jsx";
import { apiUrl } from "../config.js";
import Logo from "../components/Logo.jsx";
import MessageBubble from "../components/MessageBubble.jsx";
import TypingIndicator from "../components/TypingIndicator.jsx";

const SESSION_KEY = "chat_session_id";

// Generate a unique session ID using crypto.randomUUID when available
function generateSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `s_${crypto.randomUUID()}`;
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function Chat() {
  const socket = useSocket();
  const [sessionId, setSessionId] = useState(
    () => sessionStorage.getItem(SESSION_KEY) || ""
  );
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("theme") !== "light");
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [ended, setEnded] = useState(false);

  const messagesEnd = useRef(null);
  const typingTimer = useRef(null);
  const inputRef = useRef(null);

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  // Initialize session - always create a NEW unique session per browser tab
  useEffect(() => {
    (async () => {
      try {
        // Always request a brand new session from the backend
        // Do NOT send the old sessionId - each user gets their own
        const { data } = await axios.post(apiUrl("/api/session"), {});
        const sid = data.sessionId;
        sessionStorage.setItem(SESSION_KEY, sid);
        setSessionId(sid);
        const m = await axios.get(apiUrl(`/api/messages/${sid}`));
        setMessages(m.data);
        if (data.session?.status === "ended") setEnded(true);
      } catch {
        toast.error("تعذر الاتصال بالخادم");
      }
    })();
  }, []);

  // Socket events
  useEffect(() => {
    if (!socket || !sessionId) return;
    socket.emit("user_join", { sessionId });

    const onConnect = () => {
      setConnected(true);
      setReconnecting(false);
      // Re-join room after reconnection
      socket.emit("user_join", { sessionId });
    };
    const onDisconnect = () => {
      setConnected(false);
      setReconnecting(true);
    };
    const onReconnectAttempt = () => setReconnecting(true);
    const onReconnect = () => {
      setReconnecting(false);
      setConnected(true);
      toast.success("تم إعادة الاتصال");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("reconnect_attempt", onReconnectAttempt);
    socket.on("reconnect", onReconnect);

    socket.on("message", (msg) => {
      if (msg.sessionId === sessionId) {
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
        );
        if (msg.sender === "admin") setTyping(false);
      }
    });

    socket.on("typing", ({ role }) => role === "admin" && setTyping(true));
    socket.on("stop_typing", ({ role }) => role === "admin" && setTyping(false));

    socket.on("session_ended", () => setEnded(true));
    socket.on("messages_cleared", () => setMessages([]));

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("reconnect_attempt", onReconnectAttempt);
      socket.off("reconnect", onReconnect);
      socket.off("message");
      socket.off("typing");
      socket.off("stop_typing");
      socket.off("session_ended");
      socket.off("messages_cleared");
    };
  }, [socket, sessionId]);

  // Auto scroll
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  const send = useCallback(() => {
    const content = input.trim();
    if (!content || !socket || !sessionId || ended) return;
    socket.emit("user_message", { sessionId, content });
    setInput("");
    socket.emit("stop_typing", { sessionId, role: "user" });
    inputRef.current?.focus();
  }, [input, socket, sessionId, ended]);

  const handleInput = (e) => {
    setInput(e.target.value);
    if (!socket || !sessionId) return;
    socket.emit("typing", { sessionId, role: "user" });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit("stop_typing", { sessionId, role: "user" });
    }, 1500);
  };

  const endChat = async () => {
    if (!sessionId) return;
    if (!confirm("هل تريد إنهاء المحادثة وحفظ السجل؟")) return;
    try {
      await axios.post(apiUrl(`/api/messages/${sessionId}/end`));
      setEnded(true);
      toast.success("تم إنهاء المحادثة");
    } catch {
      toast.error("تعذر إنهاء المحادثة");
    }
  };

  const newChat = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setSessionId("");
    setMessages([]);
    setEnded(false);
    window.location.reload();
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Logo size={40} withText />
          <div>
            <h1 className="font-bold text-sm sm:text-base">ZedAI Assistant</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? "bg-green-500" : reconnecting ? "bg-yellow-500 animate-pulse" : "bg-gray-400"
                }`}
              />
              {connected ? "متصل" : reconnecting ? "جارٍ إعادة الاتصال..." : "غير متصل"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDark((d) => !d)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            title="تبديل المظهر"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {ended ? (
            <button
              onClick={newChat}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              title="محادثة جديدة"
            >
              <Trash2 size={18} />
            </button>
          ) : (
            <button
              onClick={endChat}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition text-red-500"
              title="إنهاء المحادثة"
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>

      {/* Reconnecting banner */}
      <AnimatePresence>
        {reconnecting && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-yellow-500/90 text-white text-xs text-center py-1.5 flex items-center justify-center gap-2"
          >
            <RefreshCw size={12} className="animate-spin" />
            جارٍ إعادة الاتصال بالخادم...
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-3">
        {messages.length === 0 && !typing && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mb-4"
            >
              <Logo size={100} />
            </motion.div>
            <h2 className="text-xl font-bold mb-2">
              مرحباً! أنا ZedAI - كيف يمكنني مساعدتك اليوم؟
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm max-w-md">
              اكتب رسالتك بالأسفل وسيقوم فريقنا بالرد عليك مباشرة.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} isUser={m.sender === "user"} />
        ))}

        <AnimatePresence>{typing && <TypingIndicator label="المساعد يكتب" />}</AnimatePresence>

        {ended && (
          <div className="text-center text-xs text-gray-400 my-3">
            — انتهت المحادثة —
          </div>
        )}

        <div ref={messagesEnd} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-900">
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            disabled={ended || reconnecting}
            placeholder={ended ? "انتهت المحادثة" : reconnecting ? "جارٍ إعادة الاتصال..." : "اكتب رسالتك..."}
            className="flex-1 resize-none bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 max-h-32 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || ended || reconnecting}
            className="w-11 h-11 shrink-0 rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white flex items-center justify-center transition shadow-lg"
          >
            <Send size={18} className="rtl:rotate-180" />
          </button>
        </div>
        <p className="text-[10px] text-center text-gray-400 mt-2">
          قد يتم تسجيل المحادثة لأغراض الجودة
        </p>
      </div>
    </div>
  );
}
