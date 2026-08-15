import { motion } from "framer-motion";

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
}

export default function MessageBubble({ message, isUser }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"} px-3 my-1.5`}
    >
      <div className={`flex flex-col max-w-[80%] sm:max-w-[70%]`}>
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
            isUser
              ? "bg-blue-600 text-white rounded-br-md"
              : "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-md"
          }`}
        >
          {message.content}
        </div>
        <span
          className={`text-[10px] mt-1 px-1 text-gray-400 ${
            isUser ? "text-left" : "text-right"
          }`}
        >
          {formatTime(message.timestamp)}
        </span>
      </div>
    </motion.div>
  );
}
