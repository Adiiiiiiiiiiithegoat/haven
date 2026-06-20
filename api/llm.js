const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = process.env.HAVEN_MODEL || "llama-3.3-70b-versatile";

const API_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY,
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryAfterSeconds(res, bodyText) {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header;
  const m = (bodyText || "").match(/try again in ([\d.]+)s/i);
  return m ? Number(m[1]) : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (API_KEYS.length === 0)
    return res.status(500).json({ error: "Server has no API keys configured." });

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

    // ponytail: sleep here may brush Vercel Hobby's 10s limit; upgrade to Pro (60s) if all keys are rate-limited simultaneously
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

        if (upstream.ok) break;

        const rotate =
          upstream.status === 429 ||
          upstream.status === 401 ||
          upstream.status === 403 ||
          upstream.status >= 500;
        if (!rotate) break;

        if (upstream.status === 429) {
          const wait = retryAfterSeconds(upstream, await upstream.clone().text());
          if (wait != null && (shortestWait == null || wait < shortestWait)) shortestWait = wait;
        }
      }

      if (upstream.ok || !(upstream.status === 429 || upstream.status >= 500)) break;
      if (round === MAX_ROUNDS - 1 || shortestWait == null || shortestWait > SHORT_WAIT) break;
      await sleep((shortestWait + 0.5) * 1000);
    }

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(upstream.status).json({ error: data });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed." });
  }
}
