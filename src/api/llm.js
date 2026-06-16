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
  const res = await fetch(PROXY_URL, {
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

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      `HAVEN proxy error ${res.status}: ${JSON.stringify(detail.error || detail)}`
    );
  }

  const data = await res.json();
  return extractText(data);
}
