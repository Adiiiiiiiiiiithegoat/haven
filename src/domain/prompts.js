// Per-feature prompt builders. Each OUTPUT feature is its own focused call (§3),
// receiving the current `situation` as JSON input and returning a specified shape.

import { buildSystemPrompt } from "./systemPrompt.js";

// ---------- 1.1 Conversational intake ----------
// The model maintains a conversation and returns the §3 JSON shape every turn.
const INTAKE_INSTRUCTION = `You are running CONVERSATIONAL INTAKE. Your job is to understand the user's housing situation and extract structured fields, asking warm follow-ups ONLY for fields that matter and are still missing.

The "situation" fields you can populate:
- noticeType: "section21" | "section8" | "verbal" | "none" | "unknown"
- noticeDateReceived: ISO date (YYYY-MM-DD) or null
- claimedLeaveDate: ISO date the notice says to leave, or null
- statedGround: the Section 8 ground, if any, or null
- rentArrears: { "inArrears": boolean, "detail": string } or null
- reasonForThreat: why they're facing housing loss, or null
- dateOfThreat: ISO date they expect to ACTUALLY lose the home (drives the 56-day calc), or null
- localCouncil: name of their local council, or null
- household: { "adults": number, "children": number, "vulnerabilityOrDisability": string|null } or null
- priorCouncilContact: { "contacted": boolean, "reference": string|null } or null
- safetyFlag: "none" | "domesticAbuse" | "acuteDistress"

The fields that MATTER MOST for core help: noticeType, dateOfThreat (or claimedLeaveDate to infer it), reasonForThreat. Ask about these if unknown. Do not interrogate — one or two gentle questions per turn, max.

When you have enough to produce the core outputs (notice check + timeline + action plan), set "readyForOutputs": true. You can be ready even with some nulls, as long as you know the notice type and roughly when they'd lose the home.

If the user shows domestic abuse or acute distress, set safetyFlag and let your "reply" lead with care and safety — not a tenancy answer.

Respond with STRICT JSON ONLY (no markdown fences), exactly this shape:
{
  "reply": "natural-language message to show the user",
  "situationUpdate": { "...only fields newly learned this turn..." },
  "missingRequiredFields": ["fieldName", "..."],
  "readyForOutputs": false
}`;

export function intakeSystemPrompt(situation) {
  const known = situation
    ? `\n\nALREADY KNOWN so far (do NOT re-ask for fields that are already filled; null = still unknown):\n${JSON.stringify(
        situation,
        null,
        2
      )}\n\nToday's date is ${new Date()
        .toISOString()
        .slice(0, 10)} — use it to resolve relative dates like "in 40 days" into ISO dates.`
    : "";
  return buildSystemPrompt(INTAKE_INSTRUCTION + known);
}

// Helper: render the situation as a compact JSON input block for output calls.
function situationBlock(situation) {
  return `Here is the user's current situation (fields that are null are unknown — handle them gracefully, never invent values):\n${JSON.stringify(
    situation,
    null,
    2
  )}`;
}

// ---------- 1.2 Notice validity check ----------
export function noticeCheckCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Assess the validity of the notice (if any) the user has received, using ONLY the post-1-May-2026 knowledge base.

Rules to apply:
- A Section 21 notice SERVED ON OR AFTER 1 May 2026 is INVALID (S21 abolished). Say "likely invalid" and explain plainly why.
- A Section 8 notice is a valid ROUTE if it states a ground; check the ground and notice period against the knowledge base, but you may not have all details.
- ALWAYS reinforce: a notice is NOT an eviction, and the landlord still needs a COURT POSSESSION ORDER before anyone can be made to leave.
- Use confidence framing. Never a guarantee.

Return STRICT JSON only, this shape:
{
  "verdict": "short headline, e.g. 'This Section 21 notice appears likely invalid'",
  "confidence": "low" | "moderate" | "high",
  "reasoning": "2-4 short plain-English sentences explaining why, including that a notice is not an eviction and a court order is still needed",
  "verifyWith": "who to verify with for free, e.g. 'Shelter or your local council'"
}`
  );
  const messages = [
    {
      role: "user",
      content: `${situationBlock(situation)}\n\nAssess the notice validity now.`,
    },
  ];
  return { system, messages, maxTokens: 700 };
}

// ---------- 1.3 Timeline mapper + 56-day clock ----------
export function timelineCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Map the eviction/housing-loss process into clear stages for THIS user, mark where they are now, and surface the 56-day homelessness-duty threshold relative to their dateOfThreat (or claimedLeaveDate if dateOfThreat is null).

Knowledge base facts that shape the stages (post-1-May-2026): Section 8 notice served -> notice period runs -> landlord applies to court -> court hearing -> possession order -> (only then) bailiff/eviction. A notice alone is NOT an eviction. The 56-day "threatened with homelessness" threshold is when the council's PREVENTION DUTY triggers — acting at/before this point unlocks help.

Compute "daysUntilThreat" as whole days from today to dateOfThreat (or claimedLeaveDate). If both are null, set it to null and within56Days to false.

Return STRICT JSON only, this shape:
{
  "stages": [ { "label": "short stage name", "detail": "one plain-English line" }, ... ],
  "currentStageIndex": 0,
  "daysUntilThreat": number | null,
  "within56Days": boolean,
  "thresholdNote": "one supportive line about what the 56-day window means for them"
}`
  );
  const todayISO = new Date().toISOString().slice(0, 10);
  const messages = [
    {
      role: "user",
      content: `Today's date is ${todayISO}.\n${situationBlock(
        situation
      )}\n\nProduce the timeline now.`,
    },
  ];
  return { system, messages, maxTokens: 900 };
}

// ---------- 1.4 48-hour action plan ----------
export function actionPlanCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Produce EXACTLY THREE ordered steps the user should take in the next 48 hours, specific to their situation. Each step has a one-line "why". Where relevant, anchor to triggering council help EARLY (the 56-day prevention duty) rather than waiting. Be concrete and calm.

Return STRICT JSON only, an object whose "steps" array has EXACTLY 3 items, this shape:
{
  "steps": [
    { "step": "imperative action, one sentence", "why": "one short line on why it matters" },
    { "step": "...", "why": "..." },
    { "step": "...", "why": "..." }
  ]
}`
  );
  const messages = [
    {
      role: "user",
      content: `${situationBlock(situation)}\n\nProduce the 3-step 48-hour plan now.`,
    },
  ];
  return { system, messages, maxTokens: 600 };
}
