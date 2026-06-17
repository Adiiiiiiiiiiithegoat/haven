// 3.1 Gated generation — the five facts that MUST be present before HAVEN will
// draft a council-duty letter. Refusing to guess these is itself the responsible-AI
// feature: each missing slot is asked for, with a reason we can't proceed without it.

export const LETTER_SLOTS = [
  {
    key: "reasonForThreat",
    label: "Why you're facing losing your home",
    why: "The council needs the reason to assess your case — and we won't invent it for you.",
  },
  {
    key: "dateOfThreat",
    label: "The date you'd actually lose your home",
    why: "This date is what decides whether the council owes you the prevention duty. We can't assert the 56-day duty without it.",
  },
  {
    key: "localCouncil",
    label: "Your local council",
    why: "The letter has to be addressed to the specific council that legally owes you the duty.",
  },
  {
    key: "household",
    label: "Who lives with you",
    why: "Children or a vulnerability can raise your priority. The council needs this to assess you properly.",
  },
  {
    key: "priorCouncilContact",
    label: "Whether you've contacted the council before",
    why: "It changes what you should ask for, and avoids repeating steps you've already done.",
  },
];

export function isSlotFilled(situation, key) {
  const v = situation ? situation[key] : null;
  if (key === "household") return !!v && typeof v.adults === "number";
  if (key === "priorCouncilContact") return !!v && typeof v.contacted === "boolean";
  return v != null && v !== "";
}

export function letterGateStatus(situation) {
  const filledKeys = LETTER_SLOTS.filter((s) => isSlotFilled(situation, s.key)).map((s) => s.key);
  return {
    filledCount: filledKeys.length,
    total: LETTER_SLOTS.length,
    allFilled: filledKeys.length === LETTER_SLOTS.length,
    filledKeys,
  };
}
