// Per-feature prompt builders. Each OUTPUT feature is its own focused call (§3),
// receiving the current `situation` as JSON input and returning a specified shape.

import { buildSystemPrompt } from "./systemPrompt.js";
import { daysUntil } from "./situation.js";

// Compute the 56-day clock in CODE (the model is unreliable at date math) and hand
// the model an authoritative number to use rather than recompute.
function clockHint(situation) {
  const iso = situation.dateOfThreat || situation.claimedLeaveDate;
  const d = daysUntil(iso);
  if (d == null) return "The date they would actually lose their home is not yet known.";
  return `PRECOMPUTED 56-DAY CLOCK (authoritative — use this exact number, do NOT recompute it): the user is ${d} day(s) from losing their home, which is ${
    d <= 56 ? "WITHIN" : "OUTSIDE"
  } the 56-day prevention-duty window.`;
}

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
- household: { "adults": number, "children": number, "vulnerabilityOrDisability": string|null } or null  (when asking, say "in your household" not "live with you" — include the user themselves)
- benefits: { "housingBenefit": boolean, "universalCreditHousingElement": boolean, "detail": string } or null  — whether they ALREADY receive Housing Benefit or the housing element of Universal Credit (this quietly GATES the Crisis & Resilience Fund, which can help with rent, arrears, deposits and moving costs)
- priorCouncilContact: { "contacted": boolean, "reference": string|null } or null
- safetyFlag: "none" | "domesticAbuse" | "acuteDistress"

The fields that MATTER MOST for core help: noticeType, dateOfThreat (or claimedLeaveDate to infer it), reasonForThreat. Ask about these if unknown. Do not interrogate — one or two gentle questions per turn, max.

BENEFITS (optional, but worth one light touch): if they haven't already mentioned it, gently check whether they get any help towards their rent — specifically Housing Benefit or the housing element of Universal Credit — because it can quietly unlock real financial help (the Crisis & Resilience Fund). Ask it warmly and make it feel optional, never like a means-test form — e.g. "One quick thing that can open up financial help: do you happen to get any help with your rent at the moment, like Universal Credit or Housing Benefit?". Best woven in once the core picture is forming, or whenever money/arrears come up. It is NOT required — never let it block readiness, and don't ask more than once. Record what they say in the matching flag; if they're unsure whether their Universal Credit includes the housing element, leave universalCreditHousingElement null and note it in "detail" rather than guessing.

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
      content: `Today's date is ${todayISO}.\n${clockHint(
        situation
      )}\nSet "daysUntilThreat" and "within56Days" to match the precomputed clock above.\n${situationBlock(
        situation
      )}\n\nProduce the timeline now.`,
    },
  ];
  return { system, messages, maxTokens: 900 };
}

// ---------- 1.4 48-hour action plan ----------
export function actionPlanCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Produce EXACTLY THREE ordered steps THIS specific user should take in the next 48 hours. Each step is ONE concrete action they could literally do today, paired with a one-line "why". This is NOT a generic checklist — every step and every "why" must be built from this user's own facts.

USE THEIR ACTUAL SPECIFICS in every step. Draw on, by name and value: their noticeType and the dates on it (noticeDateReceived, claimedLeaveDate); whether that notice looks valid; their statedGround; their arrears (rentArrears.inArrears and rentArrears.detail); their named localCouncil; their household — adults, children, any vulnerabilityOrDisability; whether they receive Housing Benefit or the Universal Credit housing element (the CRF gate); reasonForThreat; any priorCouncilContact; and WHERE THEY ARE IN THE TIMELINE (use the precomputed day-count you are given — do not recompute it). A step like "gather your documents" is ONLY acceptable if made concrete to this user — e.g. "Photograph your Section 8 notice dated 12 June and your last 5 rent statements, since the arrears figure decides which ground applies." Where a step involves another person or body, name them inside the step (their council's housing options team, Shelter, Citizens Advice, their landlord).

ORDER BY THIS USER'S OWN URGENCY — what is most time-sensitive for THEM right now. There is NO fixed template; choose step 1 from their facts:
- Inside the 56-day window (precomputed day-count ≤ 56) → LEAD with contacting their named council's housing options team to trigger the homelessness PREVENTION DUTY (a housing-needs assessment + a Personalised Housing Plan). Acting now is the whole point; every day waited is help forfeited.
- Notice looks INVALID (a Section 21 served on/after 1 May 2026, or a Section 8 with a missing/ill-fitting ground or too-short notice period) → LEAD with getting the notice checked for free (Shelter / Citizens Advice / the council), because whether the notice even bites changes everything that follows.
- In arrears AND receiving Housing Benefit or the UC housing element → raise the CRF (apply via their named council) high, because clearing or reducing the arrears is the lever that can remove the ground being used against them.
- Outside the 56-day window with a known date → LEAD with assembling their exact evidence and diarising the precise date they become eligible to trigger the council, so they act the MOMENT they are inside the window (too early and the council may turn them away).
- safetyFlag is "domesticAbuse" or "acuteDistress" → LEAD with safety / emergency support, not tenancy admin.
Then order steps 2 and 3 by what most reduces THEIR risk next.

EACH "why" must say why THIS step matters for THEM and why NOW — tie it to their countdown, their arrears, their children/vulnerability, or their notice. Never a generic platitude like "this protects your rights."

OMIT anything that does not fit them. If a typical step is irrelevant (no arrears → no payment/CRF step; no notice yet → no notice-verification step; already contacted the council → don't tell them to make first contact), DROP it and use a step that actually matters to them. Still return EXACTLY 3.

When a fact that would drive a step is unknown (null), do NOT invent it: either pick a step that doesn't depend on it, or make the step about pinning that fact down concretely (e.g. "Confirm whether you get the housing element of Universal Credit — it's the gate to the CRF that could clear your arrears"). If the council name is unknown, say "your local council" and fold finding it into the action.

Keep each step tight, calm, and immediately actionable.

Return STRICT JSON only, an object whose "steps" array has EXACTLY 3 items, this shape:
{
  "steps": [
    { "step": "imperative action, one sentence, built from this user's facts", "why": "one short line on why it matters for THEM, right now" },
    { "step": "...", "why": "..." },
    { "step": "...", "why": "..." }
  ]
}`
  );
  const todayISO = new Date().toISOString().slice(0, 10);
  const messages = [
    {
      role: "user",
      content: `Today's date is ${todayISO}.\n${clockHint(
        situation
      )}\nUse this exact day-count to decide the ORDER of the steps and to anchor each "why".\n${situationBlock(
        situation
      )}\n\nProduce the tailored 3-step 48-hour plan now, ordered by THIS user's urgency.`,
    },
  ];
  return { system, messages, maxTokens: 700 };
}

// ========================= TIER 2 — Reasoning depth =========================

// ---------- 2.1 Options ladder ----------
export function optionsLadderCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Produce a ranked "ladder" of realistic pathways for THIS user's exact situation, most-protective / strongest first. For each, mark "status": "available" (a route they can genuinely take now) or "closed" (a route that no longer applies under the post-1-May-2026 law, or that doesn't fit their facts).

Be honest: SHOW closed options rather than hiding them, with a one-line "why" it's closed — this is the point. The classic CLOSED option post-reform is challenging or relying on the old Section 21 "no-fault" process (abolished). Never present a closed/old-law route as available.

Keep each "option" short and plain-English. Order available options by how much they protect the user.

Return STRICT JSON only, an object with an "options" array, this shape:
{
  "options": [
    { "option": "short pathway name", "status": "available", "why": "one plain-English line" },
    { "option": "...", "status": "closed", "why": "one line on why it no longer applies" }
  ]
}`
  );
  const messages = [
    {
      role: "user",
      content: `${situationBlock(situation)}\n\nProduce the options ladder now.`,
    },
  ];
  return { system, messages, maxTokens: 900 };
}

// ---------- 2.2 Jargon decoder ----------
export function jargonDecodeCall(term, situation) {
  const system = buildSystemPrompt(
    `TASK: The user pasted a confusing housing word, phrase, or line from a letter. Explain it in plain English, ACCURATE to the post-1-May-2026 law. Short and calm — decode any jargon, don't add new jargon.

If the term belongs to the abolished Section 21 "no-fault" system, say plainly that this is no longer how eviction works in England. If it's a real current step (e.g. "possession order"), explain it correctly: a possession order is what a landlord must get from a COURT, after a hearing, before anyone can be made to leave — a notice alone is not enough.

Return STRICT JSON only, this shape:
{
  "term": "the exact term you're explaining",
  "plainEnglish": "2-4 short sentences in plain English",
  "whyItMatters": "one line on what it means for them right now",
  "verifyWith": "who to check with for free, e.g. 'Shelter or Citizens Advice'"
}`
  );
  const ctx = situation ? `\n\nFor light context only, the user's situation:\n${JSON.stringify(situation)}` : "";
  const messages = [
    {
      role: "user",
      content: `Please explain this term/line in plain English: """${term}"""${ctx}`,
    },
  ];
  return { system, messages, maxTokens: 600 };
}

// ---------- 2.3 CRF eligibility pre-check ----------
export function crfPrecheckCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Reason about whether the user MAY qualify for the Crisis and Resilience Fund (CRF) Housing Payments (this replaced Discretionary Housing Payments on 1 April 2026).

THE GATE: to qualify you must ALREADY receive Housing Benefit OR the housing element of Universal Credit. Read the structured "benefits" field in the situation and let it DRIVE your verdict:
- benefits.housingBenefit is true OR benefits.universalCreditHousingElement is true -> the gate is MET; set mayQualify to "possibly" (the door is open — but never "you qualify").
- BOTH are explicitly false -> the gate is NOT met; set mayQualify to "unlikely", and explain plainly that the CRF requires one of these two benefits.
- benefits is null, or the deciding flag is null/unknown (e.g. they're on Universal Credit but unsure whether it includes the housing element — check benefits.detail) -> set mayQualify to "unclear", say it depends on this gate, and tell them how to check (their UC online journal / award notice, or their Housing Benefit award from the council).
The CRF is discretionary (the council decides) and is applied for VIA THE LOCAL COUNCIL.

CRITICAL FRAMING: NEVER say "you qualify". Only ever "you may qualify" / "you might be eligible". This is a pre-check, not a decision.

Return STRICT JSON only, this shape:
{
  "mayQualify": "possibly" | "unclear" | "unlikely",
  "gatingFactor": "the single thing that decides it — whether they get Housing Benefit or the UC housing element",
  "reasoning": "2-3 short sentences, strictly in 'you may qualify' framing, never a guarantee",
  "nextStep": "apply via your local council — name the council if known"
}`
  );
  const messages = [
    {
      role: "user",
      content: `${situationBlock(situation)}\n\nGive the CRF pre-check now.`,
    },
  ];
  return { system, messages, maxTokens: 600 };
}

// ---------- 2.4 Landlord message drafter ----------
// Returns MARKDOWN prose (json: false) — the user edits and sends it, never the app.
export function landlordDraftCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Draft a short, realistic message the user could send to their LANDLORD or letting agent — an early, good-faith approach proposing a way forward (e.g. a hardship/payment-plan conversation, or asking to discuss options) to try to avoid court.

Rules:
- Polite, factual, calm. Plain language — NOT amateur legalese.
- Propose something constructive and specific where the situation allows (e.g. a realistic payment plan if there are arrears).
- The USER sends and edits this themselves — write it as a ready-to-edit draft in the first person.
- Do not invent facts not in the situation; leave a clearly-marked placeholder like [amount] where a number is unknown.

Output the draft as MARKDOWN prose only — NO JSON, no preamble, no commentary. Start with a subject line, then the message body.`
  );
  const messages = [
    {
      role: "user",
      content: `${situationBlock(situation)}\n\nWrite the draft message to the landlord now.`,
    },
  ];
  return { system, messages, maxTokens: 700, json: false };
}

// ---------- A2. Adviser briefing (handoff preparation) ----------
// A short, copy-able briefing the user can take to a free human adviser.
export function adviserBriefingCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Produce a short briefing the user can take to a free human adviser (Shelter, Citizens Advice, or their local council). It must be TERSE and functional — no filler, no padding.

Return STRICT JSON only, this shape:
{
  "summary": ["2-3 short factual lines summarising their situation", "..."],
  "questions": ["specific question to ask the adviser", "...", "..."]
}

Rules:
- "summary" has 2-3 short items, each one plain-English line about their actual situation.
- "questions" has EXACTLY 3 items: specific, useful questions to ask an adviser, accurate to the post-1-May-2026 law and tailored to their facts.
- No preamble, no closing remarks — just the two arrays.`
  );
  const messages = [
    {
      role: "user",
      content: `${situationBlock(situation)}\n\nProduce the adviser briefing now.`,
    },
  ];
  return { system, messages, maxTokens: 500 };
}

// ============== TIER 3 — Council-duty letter generator suite ==============

const todayLine = () => `Today's date is ${new Date().toISOString().slice(0, 10)}.`;

// ---------- 3.2 Strength meter ----------
export function strengthMeterCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Honestly assess how STRONG this person's claim on the council's prevention duty is, right now. Be candid — this is a reality check, not a cheerleader.

Key rule: the prevention duty triggers when someone is "threatened with homelessness within 56 days". Use dateOfThreat (or claimedLeaveDate) vs today to judge timing:
- Clear date AND within 56 days -> stronger. Children / vulnerability in the household strengthen it further.
- More than 56 days away -> the council MAY say it's too early; say so plainly and explain what to prepare so they can act the moment they're inside the window.
- Vague or missing date -> weaker; explain what would firm it up.

${todayLine()}

Return STRICT JSON only, this shape:
{
  "strength": "strong" | "moderate" | "early-but-prepare" | "weak",
  "reasoning": "2-4 short plain-English sentences, honest about timing and what helps/hurts",
  "howToStrengthen": ["short concrete action", "..."]
}`
  );
  const messages = [
    {
      role: "user",
      content: `${clockHint(situation)}\n\n${situationBlock(situation)}\n\nAssess the strength now.`,
    },
  ];
  return { system, messages, maxTokens: 700 };
}

// ---------- 3.3 The council-duty letter (markdown prose) ----------
export function councilLetterCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Draft a council-duty letter the user will review, edit and send THEMSELVES to their local council's housing options team, asserting the homelessness PREVENTION DUTY. HAVEN never sends it.

HARD REQUIREMENTS (all mandatory):
1. Include this recognised trigger phrase VERBATIM, word for word: "threatened with homelessness within 56 days".
2. Include, in substance, this anti-gatekeeping point, framed as rights-based and factual (never as gaming the system): that they are contacting the council NOW, within the 56-day window, because the council owes them the prevention duty at THIS stage — NOT after they are already homeless. This arms a stressed person against being wrongly turned away.
3. Address it to the named local council's housing options team. Use the user's real facts (reason for threat, the date they'd lose their home, household, any prior contact).
4. Ask clearly for: a housing-needs assessment and a Personalised Housing Plan.
5. Where you have had to ASSUME or infer anything not given, flag it INLINE in square brackets like [please check: ...] so the user can verify before sending.
6. Plain, factual, calm language — NOT amateur legalese. The ONLY verbatim legal phrase is the one in requirement 1.

Output the letter as MARKDOWN prose only — no JSON, no commentary before or after. Include a date line, the council address line, a subject, the body, and a sign-off with [your name] / [your address] placeholders.`
  );
  const messages = [
    {
      role: "user",
      content: `${todayLine()}\n${clockHint(situation)}\n${situationBlock(
        situation
      )}\n\nWrite the council-duty letter now.`,
    },
  ];
  return { system, messages, maxTokens: 1100, json: false };
}

// ---------- 3.4 The packet ----------
export function packetCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Build the practical "packet" that goes around the letter, so the user can handle the WHOLE interaction with the council — not just one artifact.

Return STRICT JSON only, this shape:
{
  "documents": ["exact document to attach/bring", "..."],
  "phonePhrase": "the precise sentence to say when they call, that names the duty and the 56-day window",
  "ifKnockedBack": ["what to do / say if the council wrongly turns them away or delays", "..."]
}`
  );
  const messages = [
    { role: "user", content: `${situationBlock(situation)}\n\nBuild the packet now.` },
  ];
  return { system, messages, maxTokens: 800 };
}

// ---------- 3.5 Multi-channel (phone + in person; the letter is the written channel) ----------
export function multiChannelCall(situation) {
  const system = buildSystemPrompt(
    `TASK: From the SAME case, produce the spoken channels to match the written letter, so the user can make their case however they reach the council.

The phone script should be about 30 seconds when read aloud, and should name the prevention duty and that they are "threatened with homelessness within 56 days". The talking points are short bullets for an in-person visit.

Return STRICT JSON only, this shape:
{
  "phoneScript": "~30-second script in the first person, calm and clear",
  "talkingPoints": ["short bullet for talking in person", "..."]
}`
  );
  const messages = [
    { role: "user", content: `${situationBlock(situation)}\n\nProduce the phone script and talking points now.` },
  ];
  return { system, messages, maxTokens: 800 };
}

// ---------- 3.6 "What happens next" simulator ----------
export function whatHappensNextCall(situation) {
  const system = buildSystemPrompt(
    `TASK: Walk the user through the LIKELY sequence after they contact the council, so they can tell whether they're being treated correctly. Include: the council should assess them and produce a Personalised Housing Plan; if they DON'T (or try to turn the user away), what pushing back looks like and when to call Shelter.

Return STRICT JSON only, this shape:
{
  "steps": [ { "stage": "short label", "detail": "one plain-English line", "ifItGoesWrong": "what to do if this step doesn't happen properly (or empty string)" }, ... ],
  "redFlags": ["a sign the council is not treating you correctly", "..."]
}`
  );
  const messages = [
    { role: "user", content: `${situationBlock(situation)}\n\nProduce the what-happens-next walkthrough now.` },
  ];
  return { system, messages, maxTokens: 900 };
}
