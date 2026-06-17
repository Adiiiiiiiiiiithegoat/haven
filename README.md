# HAVEN — Housing Advice, Validation & Eviction Navigator

Calm, plain-English help for renters in **England** facing eviction or housing instability,
based on the law **as it stands post-1-May-2026** (Renters' Rights Act 2025). HAVEN
explains your situation, checks your notice, maps the timeline and the 56-day council-help
window, and gives a focused 48-hour plan — then hands you to real human help.

> HAVEN is not legal advice. It explains pathways and routes you to free expert help
> (Shelter, Citizens Advice, your council). It never decides whether you should stay or go,
> and it never contacts anyone on your behalf.

## Setup (Path 2 — standalone with a backend proxy)

This is a standalone app, so the API key lives only in a local proxy — **never** in the
browser or in git. The proxy talks to **Groq** (OpenAI-compatible API); the default model
is `llama-3.3-70b-versatile`.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Add your key:
   ```bash
   cp .env.example .env
   # then edit .env and set GROQ_API_KEY=gsk_...
   ```
   `.env` is gitignored. Do not commit it.
3. Run both the proxy and the web app:
   ```bash
   npm run dev
   ```
   - Web app: http://localhost:5173
   - Proxy:   http://localhost:8787 (the web app proxies `/api/*` to it automatically)

## Self-test (the §9 scenarios)

```bash
npm run selftest
```
Runs the Tier-1 acceptance scenarios (notice validity, 56-day clock, safety routing)
against the real prompts. Needs `GROQ_API_KEY` in `.env`. Exits non-zero on failure.

## Architecture

- `server.js` — minimal Express proxy. Reads `GROQ_API_KEY`, forwards to Groq's
  OpenAI-compatible API (`/v1/chat/completions`), with JSON mode for structured outputs.
- `src/api/` — `callLLM` (calls the local proxy `/api/llm`) + defensive JSON parsing.
- `src/domain/` — the single source of truth:
  - `knowledgeBase.js` — current law (post-1-May-2026), embedded verbatim.
  - `systemPrompt.js` — the era-override + knowledge base + tone/confidence/safety rules.
  - `situation.js` — the shared `situation` object every feature reads from.
  - `prompts.js` — one focused call per output (notice check, timeline, action plan).
  - `handoff.js` — context-aware human handoff selection.
- `src/components/` — calm, mobile-first UI.

## Status

All three tiers are built and self-tested:

- **Tier 1 — core:** conversational intake, notice validity check, timeline + 56-day clock,
  48-hour action plan, persistent context-aware handoff, confidence framing, "what we
  won't decide".
- **Tier 2 — reasoning depth:** options ladder (closed routes crossed off), jargon decoder,
  CRF eligibility pre-check, landlord message drafter.
- **Tier 3 — council-duty letter suite:** gated generation (won't draft until all 5 facts
  are supplied), honest strength meter, the letter (with the verbatim "threatened with
  homelessness within 56 days" trigger phrase and the rights-based anti-gatekeeping line),
  the packet (documents / phone phrase / if knocked back), multi-channel (phone script +
  in-person talking points), and a "what happens next" simulator.

The 56-day clock is computed in code (`daysUntil`) and handed to the model, so date logic
never depends on the LLM's arithmetic.
