// AI Service - Google Gemini integration
// Modular: swap this file to switch providers (OpenAI, Anthropic, etc.)

import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG, SYSTEM_PROMPT, SAFETY_SETTINGS } from "../config/aiConfig.js";
import { getMessages } from "../db.js";

// ---------- Rate limiter (sliding window) ----------
const requestTimestamps = [];

function checkRateLimit() {
  const now = Date.now();
  const windowStart = now - AI_CONFIG.rateLimit.requestWindowMs;
  // Remove timestamps outside the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < windowStart) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= AI_CONFIG.rateLimit.maxRequestsPerMinute) {
    return false;
  }
  requestTimestamps.push(now);
  return true;
}

// ---------- Gemini client (lazy init) ----------
let genAI = null;
let model = null;

function getModel() {
  if (!AI_CONFIG.apiKey) return null;
  if (!genAI) {
    genAI = new GoogleGenerativeAI(AI_CONFIG.apiKey);
    model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: AI_CONFIG.generationConfig,
      safetySettings: SAFETY_SETTINGS,
    });
  }
  return model;
}

// ---------- Build conversation context ----------
function buildContext(sessionId) {
  const allMessages = getMessages(sessionId);
  // Take last N messages for context
  const recent = allMessages.slice(-AI_CONFIG.contextWindowSize);

  // Convert to Gemini chat format
  const history = recent.map((m) => ({
    role: m.sender === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  // Gemini requires alternating roles starting with "user"
  // Clean up any consecutive same-role messages
  const cleaned = [];
  for (const msg of history) {
    const last = cleaned[cleaned.length - 1];
    if (last && last.role === msg.role) {
      // Merge into same role
      last.parts[0].text += "\n" + msg.parts[0].text;
    } else {
      cleaned.push({ ...msg });
    }
  }

  // Ensure starts with "user" role
  if (cleaned.length > 0 && cleaned[0].role !== "user") {
    cleaned.unshift({
      role: "user",
      parts: [{ text: "(بداية المحادثة)" }],
    });
  }

  return cleaned;
}

// ---------- Retry helper with exponential backoff ----------
async function withRetry(fn, maxRetries = 2, baseDelayMs = 1000) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const is503 = err.message?.includes("503") || err.message?.includes("Service Unavailable");
      const is429 = err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED");
      if ((is503 || is429) && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[AI] Retry ${attempt + 1}/${maxRetries} after ${delay}ms (${is503 ? "503" : "429"})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ---------- Generate AI response ----------
/**
 * Generate an AI response for a chat session.
 * @param {string} sessionId - The chat session ID
 * @returns {Promise<{success: boolean, response?: string, error?: string}>}
 */
export async function generateResponse(sessionId) {
  // Check if AI is enabled
  if (!AI_CONFIG.enabled) {
    return { success: false, error: "AI is not enabled (no API key)" };
  }

  // Check rate limit
  if (!checkRateLimit()) {
    console.warn("[AI] Rate limit exceeded, falling back to human");
    return {
      success: false,
      error: "Rate limit exceeded",
      fallbackToHuman: true,
    };
  }

  const modelInstance = getModel();
  if (!modelInstance) {
    return { success: false, error: "AI model not initialized" };
  }

  try {
    const history = buildContext(sessionId);

    // Get the last user message as the prompt
    const lastUserMsg = [...history].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      return { success: false, error: "No user message found" };
    }

    // Start a chat session with history
    const chat = modelInstance.startChat({
      history: history.slice(0, -1), // all but last
      generationConfig: AI_CONFIG.generationConfig,
      safetySettings: SAFETY_SETTINGS,
    });

    // Send the last message (with retry for 503/429)
    const lastMessageText = history[history.length - 1].parts[0].text;
    let result = await withRetry(() => chat.sendMessage(lastMessageText));
    let response = result.response;
    let text = response.text();
    let finishReason = response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason;

    // Handle MAX_TOKENS: continue generating until the response is complete
    let continuations = 0;
    while (
      finishReason === "MAX_TOKENS" &&
      continuations < AI_CONFIG.maxContinuations &&
      text.length > 0
    ) {
      continuations++;
      console.log(
        `[AI] Response truncated (MAX_TOKENS) for session ${sessionId.slice(-6)}, continuing... (${continuations}/${AI_CONFIG.maxContinuations})`
      );
      try {
        // Send a continuation prompt with retry
        const contResult = await withRetry(() => chat.sendMessage("تابع من حيث توقفت"));
        const contResponse = contResult.response;
        const continuationText = contResponse.text();
        finishReason = contResponse.candidates?.[0]?.finishReason;
        if (continuationText && continuationText.trim().length > 0) {
          text += continuationText;
        } else {
          break;
        }
      } catch (contErr) {
        // Continuation failed (e.g. 503 high demand) - return what we have so far
        console.warn(
          `[AI] Continuation ${continuations} failed for session ${sessionId.slice(-6)}: ${contErr.message}. Returning partial response (${text.length} chars).`
        );
        text += "\n\n*(تعذّر إكمال الرد بسبب ضغط على الخادم. يمكنك إعادة المحاولة)*";
        break;
      }
    }

    if (continuations > 0) {
      console.log(
        `[AI] Response completed after ${continuations} continuation(s) for session ${sessionId.slice(-6)} (${text.length} chars total)`
      );
    }

    if (!text || text.trim().length === 0) {
      console.warn("[AI] Empty response from Gemini");
      return { success: false, error: "Empty AI response", fallbackToHuman: true };
    }

    console.log(`[AI] Response generated for session ${sessionId.slice(-6)} (${text.length} chars)`);
    return { success: true, response: text.trim() };
  } catch (error) {
    console.error("[AI] Gemini API error:", error.message);

    // Categorize errors
    if (error.message?.includes("API_KEY") || error.message?.includes("API key")) {
      return { success: false, error: "Invalid API key", fallbackToHuman: true };
    }
    if (error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      return { success: false, error: "Quota exceeded", fallbackToHuman: true };
    }
    if (error.message?.includes("safety") || error.message?.includes("blocked")) {
      return {
        success: false,
        error: "Content blocked by safety filter",
        fallbackToHuman: true,
      };
    }
    if (error.message?.includes("fetch") || error.code === "ECONNREFUSED") {
      return { success: false, error: "Network error", fallbackToHuman: true };
    }

    return { success: false, error: error.message, fallbackToHuman: true };
  }
}

// ---------- Health check for AI ----------
export function getAIStatus() {
  return {
    enabled: AI_CONFIG.enabled,
    mode: AI_CONFIG.defaultMode,
    model: AI_CONFIG.model,
    hasApiKey: !!AI_CONFIG.apiKey,
  };
}
