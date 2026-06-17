// HAVEN — minimal backend proxy (Path 2).
// Reads GROQ_API_KEY from .env and forwards chat calls to Groq's OpenAI-compatible API.
// The key NEVER reaches the browser. The frontend calls POST /api/llm.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8787;
const DEFAULT_MODEL = process.env.HAVEN_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Collect all configured keys: GROQ_API_KEY_1..4, then GROQ_API_KEY as fallback.
const API_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY,
].filter(Boolean);

if (API_KEYS.length === 0) {
  console.error(
    "\n[HAVEN] No API keys found. Set GROQ_API_KEY or GROQ_API_KEY_1..4 in .env.\n"
  );
} else {
  console.log(`[HAVEN] ${API_KEYS.length} API key(s) configured.`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How many seconds Groq asks us to wait on a 429, from header or body message.
function retryAfterSeconds(res, bodyText) {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header;
  const m = (bodyText || "").match(/try again in ([\d.]+)s/i);
  return m ? Number(m[1]) : null;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, keysConfigured: API_KEYS.length, provider: "groq" });
});

// Neutral request shape: { system, messages:[{role,content}], model?, max_tokens?, json? }
// Mapped to Groq/OpenAI: system becomes the first message; json -> response_format.
app.post("/api/llm", async (req, res) => {
  if (API_KEYS.length === 0) {
    return res.status(500).json({ error: "Server has no API keys configured." });
  }
  try {
    const { system, messages, model, max_tokens, json } = req.body || {};
    const chatMessages = [];
    if (system) chatMessages.push({ role: "system", content: system });
    if (Array.isArray(messages)) chatMessages.push(...messages);

    const body = {
      model: model || DEFAULT_MODEL,
      max_tokens: max_tokens || 1500,
      messages: chatMessages,
    };
    if (json !== false) body.response_format = { type: "json_object" };

    // Try each key in order. On 429 or 5xx, move to the next key immediately —
    // no sleep needed since a fresh key has its own quota. A hard error (e.g. 400
    // bad request, 401 bad key) is surfaced at once rather than burning every key.
    // If EVERY key is rate-limited with a short suggested wait, wait once and run
    // the rotation a second time before giving up.
    const SHORT_WAIT = 8;
    const MAX_ROUNDS = 2;
    let upstream;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      let shortestWait = null;

      for (let i = 0; i < API_KEYS.length; i++) {
        upstream = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${API_KEYS[i]}`,
          },
          body: JSON.stringify(body),
        });

        if (upstream.ok) break; // success

        const retryable = upstream.status === 429 || upstream.status >= 500;
        if (!retryable) break; // hard error — surface it, don't waste other keys

        if (upstream.status === 429) {
          const wait = retryAfterSeconds(upstream, await upstream.clone().text());
          if (wait != null && (shortestWait == null || wait < shortestWait)) shortestWait = wait;
        }
        console.log(`[HAVEN] Key ${i + 1} returned ${upstream.status} — trying the next key`);
      }

      // Success, or a hard error we should surface immediately → stop rotating.
      if (upstream.ok || !(upstream.status === 429 || upstream.status >= 500)) break;
      // Every key was limited. Only wait+retry if the suggested wait is short.
      if (round === MAX_ROUNDS - 1 || shortestWait == null || shortestWait > SHORT_WAIT) break;
      console.log(`[HAVEN] All keys limited — waiting ${shortestWait}s, then retrying`);
      await sleep((shortestWait + 0.5) * 1000);
    }

    // Read the final response body exactly once (success or failure).
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("[HAVEN] Upstream failed after all keys. Status:", upstream.status, data?.error);
      return res.status(upstream.status).json({ error: data });
    }
    res.json(data);
  } catch (err) {
    console.error("[HAVEN] Proxy failure:", err);
    res.status(502).json({ error: "Upstream request failed." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[HAVEN] Proxy listening on http://0.0.0.0:${PORT} (reachable on the local network, provider: groq)`);
});
