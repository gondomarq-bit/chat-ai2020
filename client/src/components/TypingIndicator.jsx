export default function TypingIndicator({ label = "يكتب" }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 my-1">
      <div className="bg-gray-200 dark:bg-gray-700 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-1">
        <span className="typing-dot w-2 h-2 bg-gray-500 dark:bg-gray-300 rounded-full inline-block" />
        <span className="typing-dot w-2 h-2 bg-gray-500 dark:bg-gray-300 rounded-full inline-block" />
        <span className="typing-dot w-2 h-2 bg-gray-500 dark:bg-gray-300 rounded-full inline-block" />
      </div>
      <span className="text-xs text-gray-400">{label}...</span>
    </div>
  );
}
