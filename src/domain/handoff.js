// 1.5 Persistent handoff — context-aware human handoff.
// The surfaced org CHANGES with context and states WHY a human is needed there.
// (Real orgs from the knowledge base. Numbers are the well-known public lines.)

const ORGS = {
  shelterEmergency: {
    name: "Shelter — Emergency Helpline",
    contact: "0808 800 4444",
    url: "https://www.shelter.org.uk/get_help",
  },
  shelter: {
    name: "Shelter",
    contact: "0808 800 4444",
    url: "https://www.shelter.org.uk/get_help",
  },
  citizensAdvice: {
    name: "Citizens Advice",
    contact: "0800 144 8848",
    url: "https://www.citizensadvice.org.uk/housing/",
  },
  council: {
    name: "Your council's housing options team",
    contact: "Search 'GOV.UK apply to your council for housing help'",
    url: "https://www.gov.uk/apply-for-council-housing",
  },
  emergencyAbuse: {
    name: "National Domestic Abuse Helpline (24h, free)",
    contact: "0808 2000 247",
    url: "https://www.nationaldahelpline.org.uk/",
  },
};

// Returns { org, why } chosen from the current situation.
export function pickHandoff(situation) {
  if (!situation) {
    return { org: ORGS.shelter, why: "Free, expert housing advice you can trust." };
  }

  if (situation.safetyFlag === "domesticAbuse") {
    return {
      org: ORGS.emergencyAbuse,
      why: "Your safety comes first. They can help you leave safely and arrange emergency housing — call 999 if you are in immediate danger.",
    };
  }
  if (situation.safetyFlag === "acuteDistress") {
    return {
      org: ORGS.shelterEmergency,
      why: "You don't have to handle this alone — a real person can talk it through with you right now.",
    };
  }

  // Council duty becomes relevant once a date of threat is known.
  if (situation.dateOfThreat || situation.claimedLeaveDate) {
    return {
      org: ORGS.council,
      why: "They are the body that legally owes you the prevention duty once you're threatened with homelessness within 56 days.",
    };
  }

  if (situation.noticeType === "section21" || situation.noticeType === "section8") {
    return {
      org: ORGS.shelter,
      why: "They can check your notice for free and tell you exactly where you stand.",
    };
  }

  if (situation.rentArrears && situation.rentArrears.inArrears) {
    return {
      org: ORGS.citizensAdvice,
      why: "They give free help with arrears, benefits and debt — including the CRF housing payment.",
    };
  }

  return { org: ORGS.shelter, why: "Free, expert housing advice you can trust." };
}

export { ORGS };
