// 1.5 Persistent handoff bar — always visible, context-aware, states WHY a human is needed.
import React from "react";
import { pickHandoff } from "../domain/handoff.js";

function telHref(contact) {
  const digits = (contact || "").replace(/[^0-9+]/g, "");
  return digits.length >= 3 ? `tel:${digits}` : null;
}

export default function HandoffBar({ situation }) {
  const { org, why } = pickHandoff(situation);
  const tel = telHref(org.contact);

  return (
    <div className="handoff-bar" role="complementary" aria-label="Get help from a person">
      <div className="handoff-inner">
        <span className="ic" aria-hidden="true">🛟</span>
        <div className="handoff-text">
          <div className="org">{org.name}</div>
          <div className="why">{why}</div>
        </div>
        {tel ? (
          <a className="call" href={tel}>
            {org.contact}
          </a>
        ) : (
          <a className="call" href={org.url} target="_blank" rel="noopener noreferrer">
            Open
          </a>
        )}
      </div>
    </div>
  );
}
