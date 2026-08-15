import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Lock, User, ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import axios from "axios";
import toast from "react-hot-toast";
import { apiUrl } from "../../config.js";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    if (!username || !password) {
      setErrorMsg("يرجى إدخال اسم المستخدم وكلمة المرور");
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.post(apiUrl("/api/admin/login"), {
        username,
        password,
      });
      localStorage.setItem("admin_token", data.token);
      toast.success("تم تسجيل الدخول بنجاح");
      navigate("/admin");
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        (err.code === "ERR_NETWORK"
          ? "تعذر الاتصال بالخادم. تحقق من الاتصال."
          : "فشل تسجيل الدخول. حاول مرة أخرى.");
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-blue-900 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8"
      >
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg mb-3">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            لوحة تحكم المدير
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            تسجيل الدخول لإدارة المحادثات
          </p>
        </div>

        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mb-4 flex items-center gap-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm rounded-lg px-3 py-2"
          >
            <AlertCircle size={16} className="shrink-0" />
            <span>{errorMsg}</span>
          </motion.div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <User
              size={18}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="اسم المستخدم"
              autoComplete="username"
              className="w-full bg-gray-100 dark:bg-gray-700 rounded-xl py-3 pr-10 pl-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
              required
            />
          </div>
          <div className="relative">
            <Lock
              size={18}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="كلمة المرور"
              autoComplete="current-password"
              className="w-full bg-gray-100 dark:bg-gray-700 rounded-xl py-3 pr-10 pl-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl py-3 font-semibold transition flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {loading ? "جارٍ الدخول..." : "دخول"}
          </button>
        </form>

        <p className="text-[11px] text-center text-gray-400 mt-5">
          افتراضي: admin / admin123
        </p>
      </motion.div>
    </div>
  );
}
