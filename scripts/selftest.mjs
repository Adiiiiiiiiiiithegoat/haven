// HAVEN self-test (§9). Runs Tier-1 + Tier-2 scenarios against the REAL prompt
// builders, calling Groq directly with the key from .env. Run: npm run selftest
//
// Exit code 0 = all pass, 1 = a failure. This is the gate before committing a tier.

import "dotenv/config";
import {
  intakeSystemPrompt,
  noticeCheckCall,
  timelineCall,
  actionPlanCall,
  optionsLadderCall,
  jargonDecodeCall,
  crfPrecheckCall,
  landlordDraftCall,
} from "../src/domain/prompts.js";
import { parseModelJSON, extractText } from "../src/api/parseModelJSON.js";
import { createEmptySituation, mergeSituation } from "../src/domain/situation.js";

const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.HAVEN_MODEL || "llama-3.3-70b-versatile";

if (!API_KEY) {
  console.error("\n[selftest] GROQ_API_KEY missing in .env — cannot run.\n");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Calls Groq's OpenAI-compatible endpoint. system -> first message.
// json=true enables JSON mode. Retries on 429 (free-tier TPM limit).
async function groq(system, messages, maxTokens = 1200, json = true, attempt = 0) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, ...messages],
  };
  if (json) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429 && attempt < 6) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const errBody = await res.text();
    const m = errBody.match(/try again in ([\d.]+)s/);
    const waitS = retryAfter || (m ? Number(m[1]) : 8);
    const waitMs = Math.ceil((waitS + 1) * 1000);
    console.log(`   …rate-limited, waiting ${Math.round(waitMs / 1000)}s and retrying`);
    await sleep(waitMs);
    return groq(system, messages, maxTokens, json, attempt + 1);
  }

  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return extractText(data);
}

// Simulate one intake turn (single user message) -> merged situation.
async function intake(description) {
  let situation = mergeSituation(createEmptySituation(), { rawUserDescription: description });
  const text = await groq(intakeSystemPrompt(situation), [
    { role: "user", content: description },
  ]);
  const parsed = parseModelJSON(text);
  if (!parsed) throw new Error("intake returned unparseable JSON: " + text.slice(0, 200));
  situation = mergeSituation(situation, parsed.situationUpdate);
  return { situation, intakeJSON: parsed };
}

// Run a focused JSON call from its builder spec; returns parsed JSON.
async function runSpec(spec) {
  const { system, messages, maxTokens, json } = spec;
  const text = await groq(system, messages, maxTokens, json !== false);
  return parseModelJSON(text);
}
// Backwards-compatible helper for builders that take just `situation`.
async function runOutput(buildCall, situation) {
  return runSpec(buildCall(situation));
}
// Run a prose (json:false) call; returns raw text.
async function runText(spec) {
  const { system, messages, maxTokens, json } = spec;
  return groq(system, messages, maxTokens, json !== false);
}

// ---- assertion helpers ----
let failures = 0;
function check(name, cond, detail = "") {
  const ok = !!cond;
  console.log(`   ${ok ? "✅" : "❌"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
  return ok;
}
function lc(x) {
  return (typeof x === "string" ? x : JSON.stringify(x || "")).toLowerCase();
}

// Forbidden: describing the OLD no-fault system as CURRENTLY valid.
function forbidsOldLaw(text) {
  const t = lc(text);
  // If it talks about S21/no-fault as valid WITHOUT flagging abolition/invalidity, that's a fail.
  const mentionsS21 = t.includes("section 21") || t.includes("no-fault") || t.includes("no fault");
  if (!mentionsS21) return true;
  const flagsReform = t.includes("abolish") || t.includes("invalid") || t.includes("no longer");
  const claimsValidNoReason =
    t.includes("no reason needed") || t.includes("two months' notice, no reason");
  return flagsReform && !claimsValidNoReason;
}

const SCENARIOS = [
  {
    id: 1,
    desc: "My landlord gave me a Section 21 notice dated last week, says I have 2 months to leave.",
    async test(s) {
      check("intake: noticeType = section21", s.situation.noticeType === "section21", s.situation.noticeType);
      const nc = await runOutput(noticeCheckCall, s.situation);
      check("notice check parsed", !!nc);
      if (nc) {
        const blob = lc(nc.verdict) + " " + lc(nc.reasoning);
        check("flags S21 as likely INVALID", blob.includes("invalid"), nc.verdict);
        check("does NOT treat old no-fault as valid", forbidsOldLaw(blob));
        check("reinforces a notice is not an eviction / court order needed", blob.includes("court") || blob.includes("not an eviction"));
        check("routes to verify (Shelter/council)", lc(nc.verifyWith).includes("shelter") || lc(nc.verifyWith).includes("council"));
      }
      // Tier 2.1 — options ladder
      const ladder = await runOutput(optionsLadderCall, s.situation);
      if (check("options ladder parsed", ladder && Array.isArray(ladder.options) && ladder.options.length > 0)) {
        const statusesValid = ladder.options.every((o) => o.status === "available" || o.status === "closed");
        check("ladder statuses are available/closed", statusesValid);
        check("ladder is honest (no old S21 no-fault shown as current)", forbidsOldLaw(JSON.stringify(ladder)));
      }
    },
  },
  {
    id: 2,
    desc: "Got a Section 8 notice for rent arrears, court date in 3 weeks.",
    async test(s) {
      check("intake: noticeType = section8", s.situation.noticeType === "section8", s.situation.noticeType);
      const nc = await runOutput(noticeCheckCall, s.situation);
      if (check("notice check parsed", !!nc)) {
        const blob = lc(nc.verdict) + " " + lc(nc.reasoning);
        check("treats S8 as a valid route (not invalid)", !blob.includes("invalid") || blob.includes("valid route"), nc.verdict);
        check("mentions court order / hearing still needed", blob.includes("court"));
        check("does NOT describe old no-fault as current", forbidsOldLaw(blob));
      }
      const tl = await runOutput(timelineCall, s.situation);
      check("timeline parsed with stages", tl && Array.isArray(tl.stages));

      // Tier 2.3 — CRF eligibility pre-check
      const crf = await runOutput(crfPrecheckCall, s.situation);
      if (check("CRF pre-check parsed", crf && "mayQualify" in crf)) {
        const gate = lc(crf.reasoning) + " " + lc(crf.gatingFactor);
        check("CRF gate references Housing Benefit / Universal Credit", gate.includes("housing benefit") || gate.includes("universal credit") || gate.includes("uc"));
        check("CRF next step points to the council", lc(crf.nextStep).includes("council"));
        check("CRF never says 'you qualify' (only may)", !(lc(crf.reasoning) + " " + lc(crf.mayQualify)).includes("you qualify"));
      }

      // Tier 2.4 — landlord message drafter (prose)
      const draft = await runText(landlordDraftCall(s.situation));
      check("landlord draft is non-trivial prose", typeof draft === "string" && draft.trim().length > 80, draft ? `len=${draft.length}` : "null");
    },
  },
  {
    id: 3,
    desc: "My fixed term ends in 40 days, I have nowhere to go and two kids.",
    async test(s) {
      const tl = await runOutput(timelineCall, s.situation);
      if (check("timeline parsed", !!tl)) {
        check("within 56-day window = true (40 days out)", tl.within56Days === true, `days=${tl.daysUntilThreat}, within=${tl.within56Days}`);
        check("daysUntilThreat is ~40 and <= 56", tl.daysUntilThreat != null && tl.daysUntilThreat <= 56, String(tl.daysUntilThreat));
      }
      const ap = await runOutput(actionPlanCall, s.situation);
      check("action plan has exactly 3 steps", ap && Array.isArray(ap.steps) && ap.steps.length === 3, ap && ap.steps ? `len=${ap.steps.length}` : "null");
    },
  },
  {
    id: 4,
    desc: "I'm 75 days from having to leave, no notice yet, just worried.",
    async test(s) {
      const tl = await runOutput(timelineCall, s.situation);
      if (check("timeline parsed", !!tl)) {
        check("within 56-day window = false (75 days out)", tl.within56Days === false, `days=${tl.daysUntilThreat}, within=${tl.within56Days}`);
        check("daysUntilThreat > 56", tl.daysUntilThreat != null && tl.daysUntilThreat > 56, String(tl.daysUntilThreat));
      }
    },
  },
  {
    id: 5,
    desc: "I don't understand this letter, it says 'possession order'.",
    async test(s) {
      // Tier 2.2 — jargon decoder
      const jd = await runSpec(jargonDecodeCall("possession order", s.situation));
      if (check("jargon decode parsed", jd && typeof jd.plainEnglish === "string")) {
        const blob = lc(jd.term) + " " + lc(jd.plainEnglish) + " " + lc(jd.whyItMatters);
        check("explains 'possession order' via the court", blob.includes("court"));
        check("post-reform accurate (no old no-fault as current)", forbidsOldLaw(blob));
        check("includes why it matters", typeof jd.whyItMatters === "string" && jd.whyItMatters.trim().length > 0);
      }
    },
  },
  {
    id: 6,
    desc: "I'm scared of my partner and I need to leave the flat.",
    async test(s) {
      check("intake sets safetyFlag = domesticAbuse", s.situation.safetyFlag === "domesticAbuse", s.situation.safetyFlag);
      check("intake reply leads with safety (not routine tenancy)", lc(s.intakeJSON.reply).includes("safe") || lc(s.intakeJSON.reply).includes("999") || lc(s.intakeJSON.reply).includes("danger"));
    },
  },
];

(async () => {
  console.log(`\nHAVEN Tier-1 + Tier-2 self-test — model: ${MODEL}\n`);
  for (const sc of SCENARIOS) {
    console.log(`Scenario ${sc.id}: "${sc.desc}"`);
    try {
      const s = await intake(sc.desc);
      await sc.test(s);
    } catch (e) {
      check(`scenario ${sc.id} ran without error`, false, String(e.message || e).slice(0, 300));
    }
    console.log("");
    await sleep(4000); // ease off the free-tier per-minute token budget
  }
  if (failures === 0) {
    console.log("🎉 All Tier-1 + Tier-2 self-tests passed.\n");
    process.exit(0);
  } else {
    console.log(`⚠️  ${failures} check(s) failed.\n`);
    process.exit(1);
  }
})();
