// RUNTIME WIRING (§2) — Path 2.
// callLLM points at the LOCAL PROXY (/api/llm). The proxy attaches the key
// (GROQ_API_KEY from .env) and forwards to Groq's OpenAI-compatible API.
// No key ever lives in frontend code.

import { extractText } from "./parseModelJSON.js";

const PROXY_URL = "/api/llm";

// messages: [{ role: "user"|"assistant", content: string }]
// system:   string (built via buildSystemPrompt)
// options:  { model?, maxTokens?, json? }  — json defaults to true (strict JSON mode)
// Returns the raw concatenated text of the assistant reply.
export async function callLLM(messages, systemPrompt, options = {}) {
  let res;
  try {
    res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system: systemPrompt,
        messages,
        model: options.model, // undefined → proxy default
        max_tokens: options.maxTokens || 1500,
        json: options.json !== false,
      }),
    });
  } catch {
    throw new Error("Can't reach HAVEN's server. Make sure it's running, then try again.");
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("The free AI rate limit was hit. Wait a few seconds, then try again.");
    }
    // The proxy forwards errors as { error: <value> }, where <value> is either a
    // plain string (our own messages) or the provider's error object
    // ({ error: { message } } from Groq). Dig out the most specific human-readable
    // message so the real cause (e.g. a decommissioned model) reaches the user.
    const detail = await res.json().catch(() => ({}));
    const e = detail && detail.error;
    const friendly =
      (typeof e === "string" && e) ||
      (e && (e.message || (e.error && e.error.message))) ||
      "Something went wrong reaching the AI. Please try again in a moment.";
    throw new Error(friendly);
  }

  const data = await res.json();
  return extractText(data);
}
