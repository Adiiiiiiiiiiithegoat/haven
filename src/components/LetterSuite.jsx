// TIER 3 — Council-duty letter generator suite.
// Gated generation (3.1) → strength meter (3.2) → letter w/ anti-gatekeeping line (3.3)
// → packet (3.4) → multi-channel (3.5) → what-happens-next (3.6).
// Human-in-the-loop: the user supplies every fact, edits freely, and sends it themselves.
import React, { useEffect, useState } from "react";
import { mergeSituation } from "../domain/situation.js";
import { LETTER_SLOTS } from "../domain/letterSlots.js";
import {
  strengthMeterCall,
  councilLetterCall,
  packetCall,
  multiChannelCall,
  whatHappensNextCall,
} from "../domain/prompts.js";
import { Loading, ErrorRetry, useLazyCall } from "./_shared.jsx";

// Auto-run a lazy call once on mount.
function useAutoCall(callSpec, opts) {
  const lazy = useLazyCall();
  useEffect(() => {
    lazy.run(callSpec, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return lazy;
}

function CopyButton({ text, label = "Copy text" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard may be blocked; text is selectable anyway */
        }
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

// ---------- 3.1 Gating panel ----------
function GatingPanel({ situation, onSubmit }) {
  const [reason, setReason] = useState(situation.reasonForThreat || "");
  const [date, setDate] = useState(situation.dateOfThreat || "");
  const [council, setCouncil] = useState(situation.localCouncil || "");
  const [adults, setAdults] = useState(
    situation.household && typeof situation.household.adults === "number"
      ? String(situation.household.adults)
      : ""
  );
  const [children, setChildren] = useState(
    situation.household && typeof situation.household.children === "number"
      ? String(situation.household.children)
      : ""
  );
  const [vuln, setVuln] = useState(situation.household?.vulnerabilityOrDisability || "");
  const [contacted, setContacted] = useState(
    situation.priorCouncilContact
      ? situation.priorCouncilContact.contacted
        ? "yes"
        : "no"
      : ""
  );
  const [ref, setRef] = useState(situation.priorCouncilContact?.reference || "");

  const filledFlags = {
    reasonForThreat: reason.trim() !== "",
    dateOfThreat: date !== "",
    localCouncil: council.trim() !== "",
    household: adults !== "",
    priorCouncilContact: contacted !== "",
  };
  const filledCount = Object.values(filledFlags).filter(Boolean).length;
  const allFilled = filledCount === LETTER_SLOTS.length;
  const missing = LETTER_SLOTS.filter((s) => !filledFlags[s.key]);

  function submit() {
    if (!allFilled) return;
    onSubmit({
      reasonForThreat: reason.trim(),
      dateOfThreat: date,
      localCouncil: council.trim(),
      household: {
        adults: Number(adults),
        children: children === "" ? 0 : Number(children),
        vulnerabilityOrDisability: vuln.trim() || null,
      },
      priorCouncilContact: {
        contacted: contacted === "yes",
        reference: ref.trim() || null,
      },
    });
  }

  return (
    <div className="card">
      <p className="eyebrow">Before we draft anything</p>
      <h2 style={{ marginTop: 0 }}>We won't guess these — they're your case</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        A council-duty letter is only as good as the facts in it. We'll draft nothing until
        all five are filled in.
      </p>

      <div className="gate-progress" aria-live="polite">
        <div className="gate-bar">
          <span style={{ width: `${(filledCount / LETTER_SLOTS.length) * 100}%` }} />
        </div>
        <strong>
          {filledCount} of {LETTER_SLOTS.length} gathered
        </strong>
      </div>

      <div className="gate-field">
        <label htmlFor="g-reason">Why you're facing losing your home</label>
        <input
          id="g-reason"
          className="text-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. my fixed term is ending and I have nowhere to go"
        />
        {!filledFlags.reasonForThreat && <p className="gate-why">{LETTER_SLOTS[0].why}</p>}
      </div>

      <div className="gate-field">
        <label htmlFor="g-date">The date you'd actually lose your home</label>
        <input
          id="g-date"
          className="text-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {!filledFlags.dateOfThreat && <p className="gate-why">{LETTER_SLOTS[1].why}</p>}
      </div>

      <div className="gate-field">
        <label htmlFor="g-council">Your local council</label>
        <input
          id="g-council"
          className="text-input"
          value={council}
          onChange={(e) => setCouncil(e.target.value)}
          placeholder="e.g. Manchester City Council"
        />
        {!filledFlags.localCouncil && <p className="gate-why">{LETTER_SLOTS[2].why}</p>}
      </div>

      <div className="gate-field">
        <label>Who lives with you</label>
        <div className="gate-row">
          <input
            className="text-input"
            type="number"
            min="0"
            value={adults}
            onChange={(e) => setAdults(e.target.value)}
            placeholder="Adults"
            aria-label="Number of adults"
          />
          <input
            className="text-input"
            type="number"
            min="0"
            value={children}
            onChange={(e) => setChildren(e.target.value)}
            placeholder="Children"
            aria-label="Number of children"
          />
        </div>
        <input
          className="text-input"
          style={{ marginTop: 8 }}
          value={vuln}
          onChange={(e) => setVuln(e.target.value)}
          placeholder="Any disability or vulnerability? (optional)"
          aria-label="Disability or vulnerability"
        />
        {!filledFlags.household && <p className="gate-why">{LETTER_SLOTS[3].why}</p>}
      </div>

      <div className="gate-field">
        <label htmlFor="g-contacted">Have you contacted the council about this already?</label>
        <select
          id="g-contacted"
          className="text-input"
          value={contacted}
          onChange={(e) => setContacted(e.target.value)}
        >
          <option value="">Choose…</option>
          <option value="no">No, not yet</option>
          <option value="yes">Yes, I have</option>
        </select>
        {contacted === "yes" && (
          <input
            className="text-input"
            style={{ marginTop: 8 }}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="Any reference number? (optional)"
            aria-label="Council reference number"
          />
        )}
        {!filledFlags.priorCouncilContact && <p className="gate-why">{LETTER_SLOTS[4].why}</p>}
      </div>

      {!allFilled && (
        <div className="gate-blocked" role="status">
          We can't draft this yet. Still needed:
          <ul>
            {missing.map((s) => (
              <li key={s.key}>
                <strong>{s.label}</strong> — {s.why}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="btn" onClick={submit} disabled={!allFilled}>
        {allFilled ? "Build my council-duty toolkit →" : `Fill in all ${LETTER_SLOTS.length} to continue`}
      </button>
    </div>
  );
}

// ---------- 3.2 Strength meter ----------
function StrengthMeter({ situation }) {
  const { data, error, loading, run } = useAutoCall(strengthMeterCall(situation), {
    validate: (d) => typeof d.strength === "string",
  });
  const tone =
    data?.strength === "strong"
      ? "high"
      : data?.strength === "weak"
      ? "low"
      : "moderate";
  return (
    <div className="card">
      <p className="eyebrow">How strong your case is</p>
      {loading && <Loading label="Assessing your case honestly" />}
      {error && <ErrorRetry message={error} onRetry={() => run(strengthMeterCall(situation), { validate: (d) => typeof d.strength === "string" })} />}
      {data && (
        <>
          <div className="verdict-head">
            <h2 style={{ margin: 0, textTransform: "capitalize" }}>
              {String(data.strength).replace(/-/g, " ")}
            </h2>
            <span className={`pill ${tone}`}>honest assessment</span>
          </div>
          <p style={{ marginTop: 6 }}>{data.reasoning}</p>
          {Array.isArray(data.howToStrengthen) && data.howToStrengthen.length > 0 && (
            <>
              <p style={{ marginBottom: 4, fontWeight: 650 }}>What would strengthen it:</p>
              <ul className="bullets">
                {data.howToStrengthen.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------- 3.3 The letter ----------
function CouncilLetter({ situation }) {
  const { data, error, loading, run } = useAutoCall(councilLetterCall(situation), { parse: false });
  const [edited, setEdited] = useState("");
  useEffect(() => {
    if (typeof data === "string") setEdited(data);
  }, [data]);

  const redraft = () => run(councilLetterCall(situation), { parse: false });

  return (
    <div className="card">
      <p className="eyebrow">Your council-duty letter</p>
      {loading && <Loading label="Drafting your letter" />}
      {error && <ErrorRetry message={error} onRetry={redraft} />}
      {typeof data === "string" && (
        <>
          <div className="draft-note">
            ✎ This is a draft for <strong>you</strong> to review, edit and send yourself —
            HAVEN never contacts the council. Anything in <strong>[square brackets]</strong>{" "}
            is an assumption: check it before you send. Get it sanity-checked for free by{" "}
            <a href="https://www.shelter.org.uk/get_help" target="_blank" rel="noopener noreferrer">
              Shelter
            </a>{" "}
            first if you can.
          </div>
          <textarea
            className="intake-input draft-area"
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            aria-label="Editable council-duty letter"
          />
          <div className="draft-actions">
            <CopyButton text={edited} />
            <button className="btn secondary" onClick={redraft}>
              Re-draft
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- 3.4 The packet ----------
function Packet({ situation }) {
  const { data, error, loading, started, run } = useLazyCall();
  const load = () => run(packetCall(situation), { validate: (d) => Array.isArray(d.documents) });
  return (
    <div className="card">
      <p className="eyebrow">Your packet — handle the whole interaction</p>
      {!started && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            What to attach, the exact phrase to say on the phone, and what to do if you're
            knocked back.
          </p>
          <button className="btn secondary" onClick={load}>
            Build my packet
          </button>
        </>
      )}
      {loading && <Loading label="Building your packet" />}
      {error && <ErrorRetry message={error} onRetry={load} />}
      {data && (
        <>
          <h3 className="sub">Documents to attach or bring</h3>
          <ul className="bullets">
            {data.documents.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
          {data.phonePhrase && (
            <>
              <h3 className="sub">Say this when you call</h3>
              <blockquote className="say-this">“{data.phonePhrase}”</blockquote>
            </>
          )}
          {Array.isArray(data.ifKnockedBack) && data.ifKnockedBack.length > 0 && (
            <>
              <h3 className="sub">If they turn you away or delay</h3>
              <ul className="bullets">
                {data.ifKnockedBack.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------- 3.5 Multi-channel ----------
function MultiChannel({ situation }) {
  const { data, error, loading, started, run } = useLazyCall();
  const load = () => run(multiChannelCall(situation), { validate: (d) => typeof d.phoneScript === "string" });
  return (
    <div className="card">
      <p className="eyebrow">Make your case any way you reach them</p>
      {!started && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            The same case as a ~30-second phone script and a set of in-person talking points.
            (Your letter above is the written version.)
          </p>
          <button className="btn secondary" onClick={load}>
            Get my phone script &amp; talking points
          </button>
        </>
      )}
      {loading && <Loading label="Preparing your script" />}
      {error && <ErrorRetry message={error} onRetry={load} />}
      {data && (
        <>
          <h3 className="sub">📞 Phone script (~30 seconds)</h3>
          <blockquote className="say-this">{data.phoneScript}</blockquote>
          <div className="draft-actions" style={{ marginBottom: 14 }}>
            <CopyButton text={data.phoneScript} label="Copy script" />
          </div>
          {Array.isArray(data.talkingPoints) && data.talkingPoints.length > 0 && (
            <>
              <h3 className="sub">🧍 In person — talking points</h3>
              <ul className="bullets">
                {data.talkingPoints.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------- 3.6 What happens next ----------
function WhatHappensNext({ situation }) {
  const { data, error, loading, started, run } = useLazyCall();
  const load = () => run(whatHappensNextCall(situation), { validate: (d) => Array.isArray(d.steps) });
  return (
    <div className="card">
      <p className="eyebrow">What happens next</p>
      {!started && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Know what the council should do — so you can tell if they're treating you right.
          </p>
          <button className="btn secondary" onClick={load}>
            Show me what to expect
          </button>
        </>
      )}
      {loading && <Loading label="Mapping what's next" />}
      {error && <ErrorRetry message={error} onRetry={load} />}
      {data && (
        <>
          <ol className="timeline">
            {data.steps.map((s, i) => (
              <li key={i} className={i === 0 ? "current" : ""}>
                <span className="stage-label">{s.stage}</span>
                {s.detail && <div className="stage-detail">{s.detail}</div>}
                {s.ifItGoesWrong && (
                  <div className="if-wrong">⚠ If this doesn't happen: {s.ifItGoesWrong}</div>
                )}
              </li>
            ))}
          </ol>
          {Array.isArray(data.redFlags) && data.redFlags.length > 0 && (
            <>
              <h3 className="sub">Red flags you're being mistreated</h3>
              <ul className="bullets">
                {data.redFlags.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function LetterSuite({ situation, onUpdateSituation, onBack }) {
  const [phase, setPhase] = useState("gate"); // gate | generated
  const [caseSituation, setCaseSituation] = useState(situation);

  function handleSubmit(update) {
    const committed = mergeSituation(situation, update);
    setCaseSituation(committed);
    onUpdateSituation(update); // keep App's master situation + handoff bar in sync
    setPhase("generated");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section aria-label="Council-duty letter generator">
      <button className="btn secondary" onClick={onBack} style={{ marginBottom: 6 }}>
        ← Back to your situation
      </button>

      {phase === "gate" && <GatingPanel situation={situation} onSubmit={handleSubmit} />}

      {phase === "generated" && (
        <>
          <StrengthMeter situation={caseSituation} />
          <CouncilLetter situation={caseSituation} />
          <p className="group-heading">Around the letter</p>
          <Packet situation={caseSituation} />
          <MultiChannel situation={caseSituation} />
          <WhatHappensNext situation={caseSituation} />
          <button
            className="btn secondary"
            onClick={() => setPhase("gate")}
            style={{ marginTop: 8 }}
          >
            ← Edit my details
          </button>
        </>
      )}
    </section>
  );
}
