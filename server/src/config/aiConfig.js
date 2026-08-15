// AI Configuration - Gemini API settings
// Modular design: change provider here without touching the rest of the code.

export const AI_CONFIG = {
  // Google Gemini settings
  apiKey: process.env.GEMINI_API_KEY || "",
  model: process.env.GEMINI_MODEL || "gemini-1.5-flash",

  // Generation parameters
  generationConfig: {
    temperature: parseFloat(process.env.AI_TEMPERATURE || "0.7"),
    maxOutputTokens: parseInt(process.env.AI_MAX_TOKENS || "500", 10),
    topP: 0.95,
    topK: 40,
  },

  // Rate limiting (Gemini free tier: 15 RPM)
  rateLimit: {
    maxRequestsPerMinute: parseInt(process.env.AI_RATE_LIMIT || "15", 10),
    requestWindowMs: 60 * 1000,
  },

  // Context window: how many recent messages to send to the AI
  contextWindowSize: 10,

  // Mode: "hybrid" | "ai" | "human"
  // - hybrid: AI replies automatically, admin can take over
  // - ai: AI replies to everything, admin read-only
  // - human: only admin replies (AI disabled)
  defaultMode: process.env.AI_MODE || "human",

  // Whether AI is enabled at all (master switch)
  enabled: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_key_here"),
};

// System prompt - defines the AI assistant personality and behavior
// Supports Arabic natively
export const SYSTEM_PROMPT = `أنت مساعد ذكي يُدعى "ZedAI" من شركة "AI YEMEN".

قواعد الرد:
- أجب بالعربية دائماً ما لم يطلب المستخدم لغة أخرى
- كن مفيداً ومهذباً ومختصراً
- إذا لم تعرف الإجابة، اعترف بذلك بصراحة
- لا تخترع معلومات أو حقائق
- استخدم تنسيقاً واضحاً (نقاط، فقرات) عند الحاجة
- إذا كان السؤال عن موضوع تقني، قدم إجابة دقيقة ومفيدة

أنت تمثل فريق دعم فني ذكي. ساعد المستخدمين بكل احترافية.`;

// Safety settings for Gemini
export const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
];
