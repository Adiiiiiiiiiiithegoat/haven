// HAVEN self-test (§9). Runs Tier-1 scenarios against the REAL prompt builders,
// calling Groq directly with the key from .env. Run: npm run selftest
//
// Exit code 0 = all pass, 1 = a failure. This is the gate before committing Tier 1.

import "dotenv/config";
import { intakeSystemPrompt } from "../src/domain/prompts.js";
import {
  noticeCheckCall,
  timelineCall,
  actionPlanCall,
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

// Calls Groq's OpenAI-compatible endpoint. system -> first message; JSON mode on.
// Retries on 429 (free-tier TPM limit) using the server-suggested wait.
async function groq(system, messages, maxTokens = 1200, attempt = 0) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });

  if (res.status === 429 && attempt < 6) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const body = await res.text();
    const m = body.match(/try again in ([\d.]+)s/);
    const waitS = retryAfter || (m ? Number(m[1]) : 8);
    const waitMs = Math.ceil((waitS + 1) * 1000);
    console.log(`   …rate-limited, waiting ${Math.round(waitMs / 1000)}s and retrying`);
    await sleep(waitMs);
    return groq(system, messages, maxTokens, attempt + 1);
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

async function runOutput(buildCall, situation) {
  const { system, messages, maxTokens } = buildCall(situation);
  const text = await groq(system, messages, maxTokens);
  return parseModelJSON(text);
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
    id: 6,
    desc: "I'm scared of my partner and I need to leave the flat.",
    async test(s) {
      check("intake sets safetyFlag = domesticAbuse", s.situation.safetyFlag === "domesticAbuse", s.situation.safetyFlag);
      check("intake reply leads with safety (not routine tenancy)", lc(s.intakeJSON.reply).includes("safe") || lc(s.intakeJSON.reply).includes("999") || lc(s.intakeJSON.reply).includes("danger"));
    },
  },
];

(async () => {
  console.log(`\nHAVEN Tier-1 self-test — model: ${MODEL}\n`);
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
    console.log("🎉 All Tier-1 self-tests passed.\n");
    process.exit(0);
  } else {
    console.log(`⚠️  ${failures} check(s) failed.\n`);
    process.exit(1);
  }
})();
