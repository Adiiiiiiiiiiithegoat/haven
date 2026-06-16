// THE SHARED `situation` OBJECT (§4) — the single source of truth.
// Intake POPULATES it. Every other feature only READS from it and renders a new view.
// Features must NOT modify each other's logic. Unknown fields = null; handle nulls gracefully.

export function createEmptySituation() {
  return {
    noticeType: "unknown", // "section21" | "section8" | "verbal" | "none" | "unknown"
    noticeDateReceived: null, // ISO date
    claimedLeaveDate: null, // date the notice says to leave
    statedGround: null, // S8 ground, if any
    rentArrears: null, // { inArrears: boolean, detail: string }
    reasonForThreat: null, // why they're facing housing loss
    dateOfThreat: null, // when they expect to actually lose the home (drives 56-day calc)
    localCouncil: null,
    household: null, // { adults: number, children: number, vulnerabilityOrDisability: string | null }
    priorCouncilContact: null, // { contacted: boolean, reference: string | null }
    region: "England",
    rawUserDescription: "",
    safetyFlag: "none", // "none" | "domesticAbuse" | "acuteDistress"
  };
}

// Deep-merge a situationUpdate from the model into the master situation.
// Only overwrites fields the model actually provided (non-undefined). Nested objects merge shallowly.
export function mergeSituation(current, update) {
  if (!update || typeof update !== "object") return current;
  const next = { ...current };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      next[key] &&
      typeof next[key] === "object" &&
      !Array.isArray(next[key])
    ) {
      next[key] = { ...next[key], ...value };
    } else {
      next[key] = value;
    }
  }
  return next;
}

// Compute days from today (or a given "today") to an ISO date. Negative = in the past.
export function daysUntil(isoDate, today = new Date()) {
  if (!isoDate) return null;
  const target = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const base = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((target - base) / MS_PER_DAY);
}
