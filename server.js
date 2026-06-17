// HAVEN — minimal backend proxy (Path 2).
// Reads GROQ_API_KEY from .env and forwards chat calls to Groq's OpenAI-compatible API.
// The key NEVER reaches the browser. The frontend calls POST /api/llm.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.GROQ_API_KEY;
const DEFAULT_MODEL = process.env.HAVEN_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

if (!API_KEY) {
  console.error(
    "\n[HAVEN] GROQ_API_KEY is missing. Copy .env.example to .env and add your key.\n"
  );
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
  res.json({ ok: true, keyConfigured: Boolean(API_KEY), provider: "groq" });
});

// Neutral request shape: { system, messages:[{role,content}], model?, max_tokens?, json? }
// Mapped to Groq/OpenAI: system becomes the first message; json -> response_format.
app.post("/api/llm", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "Server missing GROQ_API_KEY." });
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
    // JSON mode forces strictly-valid JSON output (object top-level).
    if (json !== false) body.response_format = { type: "json_object" };

    // Up to 2 automatic retries, but ONLY when Groq's suggested wait is short
    // (transient per-minute limit). Long waits (daily cap) return promptly so the
    // UI can show a friendly "try again later" instead of hanging.
    const SHORT_WAIT = 8;
    let upstream;
    for (let attempt = 0; attempt <= 2; attempt++) {
      upstream = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (upstream.status !== 429 || attempt === 2) break;
      const txt = await upstream.clone().text();
      const wait = retryAfterSeconds(upstream, txt);
      if (wait == null || wait > SHORT_WAIT) break; // don't hang on long/daily limits
      console.log(`[HAVEN] 429 — retrying in ${wait}s (attempt ${attempt + 1})`);
      await sleep((wait + 0.5) * 1000);
    }

    const data = await upstream.json();
    if (!upstream.ok) {
      console.error("[HAVEN] Groq error:", upstream.status, data && data.error);
      return res.status(upstream.status).json({ error: data });
    }
    res.json(data);
  } catch (err) {
    console.error("[HAVEN] Proxy failure:", err);
    res.status(502).json({ error: "Upstream request failed." });
  }
});

app.listen(PORT, () => {
  console.log(`[HAVEN] Proxy listening on http://localhost:${PORT} (provider: groq)`);
});
