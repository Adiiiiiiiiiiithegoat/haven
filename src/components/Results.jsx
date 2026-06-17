// Results view — renders Tier 1 outputs as clean components (not a chat wall).
// Each output is its OWN focused call (§3). They run in parallel and render as they land.
import React, { useEffect, useState } from "react";
import { callLLM } from "../api/llm.js";
import { parseModelJSON } from "../api/parseModelJSON.js";
import {
  noticeCheckCall,
  timelineCall,
  actionPlanCall,
  optionsLadderCall,
  jargonDecodeCall,
  crfPrecheckCall,
  landlordDraftCall,
} from "../domain/prompts.js";
import { Loading, ErrorRetry, useLazyCall } from "./_shared.jsx";
import WontDecide from "./WontDecide.jsx";

// Generic loader for one focused JSON call. Returns {data, error, loading, reload}.
function useFocusedCall(buildCall, situation, validate) {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  function run() {
    setState({ data: null, error: null, loading: true });
    const { system, messages, maxTokens } = buildCall(situation);
    callLLM(messages, system, { maxTokens })
      .then((text) => {
        const parsed = parseModelJSON(text);
        if (!parsed || (validate && !validate(parsed))) {
          setState({
            data: null,
            error: "We couldn't read that result. Try again in a moment.",
            loading: false,
          });
        } else {
          setState({ data: parsed, error: null, loading: false });
        }
      })
      .catch((e) => setState({ data: null, error: String(e.message || e), loading: false }));
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, reload: run };
}

// ---------- 1.2 Notice validity ----------
function NoticeCheck({ situation }) {
  const { data, error, loading, reload } = useFocusedCall(
    noticeCheckCall,
    situation,
    (d) => typeof d.verdict === "string"
  );
  return (
    <div className="card">
      <p className="eyebrow">Your notice</p>
      {loading && <Loading label="Checking your notice" />}
      {error && <ErrorRetry message={error} onRetry={reload} />}
      {data && (
        <>
          <div className="verdict-head">
            <h2 style={{ margin: 0 }}>{data.verdict}</h2>
            {data.confidence && (
              <span className={`pill ${data.confidence}`}>{data.confidence} confidence</span>
            )}
          </div>
          <p style={{ marginBottom: 0 }}>{data.reasoning}</p>
          {data.verifyWith && (
            <p className="verify-note">
              ✔ This isn't legal advice. Verify it for free with{" "}
              <strong>{data.verifyWith}</strong>.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------- 1.3 Timeline + 56-day clock ----------
function Timeline({ situation }) {
  const { data, error, loading, reload } = useFocusedCall(
    timelineCall,
    situation,
    (d) => Array.isArray(d.stages)
  );
  return (
    <div className="card">
      <p className="eyebrow">Where you are in the process</p>
      {loading && <Loading label="Mapping your timeline" />}
      {error && <ErrorRetry message={error} onRetry={reload} />}
      {data && (
        <>
          <ol className="timeline">
            {data.stages.map((s, i) => {
              const cls =
                i < data.currentStageIndex
                  ? "done"
                  : i === data.currentStageIndex
                  ? "current"
                  : "";
              return (
                <li key={i} className={cls}>
                  <span className="stage-label">{s.label}</span>
                  {i === data.currentStageIndex && (
                    <span className="you-are-here">you are here</span>
                  )}
                  {s.detail && <div className="stage-detail">{s.detail}</div>}
                </li>
              );
            })}
          </ol>

          <Clock data={data} />
        </>
      )}
    </div>
  );
}

function Clock({ data }) {
  const within = !!data.within56Days;
  const days = data.daysUntilThreat;
  if (days == null) {
    return (
      <div className="clock outside">
        <div className="lbl">
          Once you know the date you'd actually lose your home, we'll show how close you are
          to the 56-day council-help window.
        </div>
      </div>
    );
  }
  return (
    <div className={`clock ${within ? "within" : "outside"}`}>
      <div className="big">{days}</div>
      <div className="lbl">days until you'd lose your home</div>
      <span className="flag">
        {within
          ? "✓ Within the 56-day window — your council owes you help now"
          : "Outside the 56-day window — but there's plenty to prepare now"}
      </span>
      {data.thresholdNote && (
        <p className="lbl" style={{ marginTop: 10 }}>
          {data.thresholdNote}
        </p>
      )}
    </div>
  );
}

// ---------- 1.4 48-hour action plan ----------
function ActionPlan({ situation }) {
  const { data, error, loading, reload } = useFocusedCall(
    actionPlanCall,
    situation,
    (d) => Array.isArray(d.steps) && d.steps.length === 3
  );
  return (
    <div className="card">
      <p className="eyebrow">Your next 48 hours</p>
      {loading && <Loading label="Building your plan" />}
      {error && <ErrorRetry message={error} onRetry={reload} />}
      {data && (
        <ol className="steps">
          {data.steps.map((s, i) => (
            <li key={i}>
              <div className="what">{s.step}</div>
              <div className="why">{s.why}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------- 2.1 Options ladder ----------
function OptionsLadder({ situation }) {
  const { data, error, loading, started, run } = useLazyCall();
  const load = () =>
    run(optionsLadderCall(situation), {
      validate: (d) => Array.isArray(d.options) && d.options.length > 0,
    });
  return (
    <div className="card">
      <p className="eyebrow">Your options, ranked</p>
      {!started && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            See the realistic pathways open to you — and which routes no longer apply under
            the current rules.
          </p>
          <button className="btn secondary" onClick={load}>
            Show my options
          </button>
        </>
      )}
      {loading && <Loading label="Working out your options" />}
      {error && <ErrorRetry message={error} onRetry={load} />}
      {data && (
        <ul className="ladder">
          {data.options.map((o, i) => (
            <li key={i} className={o.status === "closed" ? "closed" : "available"}>
              <span className="ladder-rank" aria-hidden="true">
                {o.status === "closed" ? "✕" : i + 1}
              </span>
              <div>
                <div className="ladder-option">
                  {o.option}
                  {o.status === "closed" && <span className="tag-closed">no longer applies</span>}
                </div>
                <div className="ladder-why">{o.why}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- 2.3 CRF eligibility pre-check ----------
function CrfPrecheck({ situation }) {
  const { data, error, loading, started, run } = useLazyCall();
  const load = () =>
    run(crfPrecheckCall(situation), { validate: (d) => "mayQualify" in d });
  const labels = {
    possibly: { text: "You may be eligible", cls: "moderate" },
    unclear: { text: "It depends", cls: "low" },
    unlikely: { text: "Less likely", cls: "low" },
  };
  const badge = data ? labels[data.mayQualify] || labels.unclear : null;
  return (
    <div className="card">
      <p className="eyebrow">Financial help — CRF pre-check</p>
      {!started && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            A quick, non-binding check on whether you might be able to get help with rent,
            arrears or moving costs from the Crisis &amp; Resilience Fund.
          </p>
          <button className="btn secondary" onClick={load}>
            Check if I might be eligible
          </button>
        </>
      )}
      {loading && <Loading label="Checking eligibility" />}
      {error && <ErrorRetry message={error} onRetry={load} />}
      {data && (
        <>
          <div className="verdict-head">
            <h2 style={{ margin: 0 }}>{badge.text}</h2>
            <span className={`pill ${badge.cls}`}>pre-check only</span>
          </div>
          {data.gatingFactor && (
            <p style={{ marginBottom: 6 }}>
              <strong>What decides it:</strong> {data.gatingFactor}
            </p>
          )}
          {data.reasoning && <p style={{ marginTop: 0 }}>{data.reasoning}</p>}
          {data.nextStep && (
            <p className="verify-note">➜ {data.nextStep}</p>
          )}
        </>
      )}
    </div>
  );
}

// ---------- 2.2 Jargon decoder ----------
function JargonDecoder({ situation }) {
  const [term, setTerm] = useState("");
  const { data, error, loading, run } = useLazyCall();
  const decode = () => {
    const t = term.trim();
    if (!t) return;
    run(jargonDecodeCall(t, situation), { validate: (d) => typeof d.plainEnglish === "string" });
  };
  return (
    <div className="card">
      <p className="eyebrow">Confused by a word or line?</p>
      <p className="muted" style={{ marginTop: 0 }}>
        Paste a term or sentence from a letter and we'll explain it in plain English.
      </p>
      <div className="composer">
        <input
          className="text-input"
          placeholder="e.g. possession order"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && decode()}
          aria-label="Term to explain"
        />
        <button className="btn" onClick={decode} disabled={loading || !term.trim()}>
          Explain
        </button>
      </div>
      {loading && <Loading label="Explaining" />}
      {error && (
        <div className="error-box" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      {data && (
        <div style={{ marginTop: 14 }}>
          <h2 style={{ margin: "0 0 4px" }}>{data.term}</h2>
          <p style={{ marginTop: 0 }}>{data.plainEnglish}</p>
          {data.whyItMatters && (
            <p style={{ marginBottom: 6 }}>
              <strong>What it means for you:</strong> {data.whyItMatters}
            </p>
          )}
          {data.verifyWith && (
            <p className="verify-note">✔ Not sure? Check it for free with {data.verifyWith}.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- 2.4 Landlord message drafter ----------
function LandlordDrafter({ situation }) {
  const { data, error, loading, started, run } = useLazyCall();
  const [edited, setEdited] = useState("");
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setCopied(false);
    await run(landlordDraftCall(situation), { parse: false });
  };
  // Sync the editable box when a fresh draft arrives.
  useEffect(() => {
    if (typeof data === "string") setEdited(data);
  }, [data]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(edited);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked; the text is selectable anyway */
    }
  };

  return (
    <div className="card">
      <p className="eyebrow">Message your landlord</p>
      {!started && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            A calm, good-faith draft to open a conversation — for example proposing a
            payment plan — to try to avoid court.
          </p>
          <button className="btn secondary" onClick={load}>
            Draft a message
          </button>
        </>
      )}
      {loading && <Loading label="Drafting your message" />}
      {error && <ErrorRetry message={error} onRetry={load} />}
      {typeof data === "string" && (
        <>
          <div className="draft-note">
            ✎ This is a draft for <strong>you</strong> to review, edit and send yourself.
            HAVEN never contacts your landlord. Consider getting it sanity-checked free by
            Shelter or Citizens Advice first.
          </div>
          <textarea
            className="intake-input draft-area"
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            aria-label="Editable draft message"
          />
          <div className="draft-actions">
            <button className="btn secondary" onClick={copy}>
              {copied ? "Copied ✓" : "Copy text"}
            </button>
            <button className="btn secondary" onClick={load}>
              Re-draft
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Results({ situation, onBack, onGenerateLetter }) {
  return (
    <section aria-label="Your situation">
      <button className="btn secondary" onClick={onBack} style={{ marginBottom: 6 }}>
        ← Back to the conversation
      </button>
      <NoticeCheck situation={situation} />
      <Timeline situation={situation} />
      <ActionPlan situation={situation} />

      {/* Tier 3 showpiece entry point */}
      <div className="card feature-cta">
        <p className="eyebrow">The big one</p>
        <h2 style={{ marginTop: 0 }}>Get the council to act — in writing</h2>
        <p style={{ marginTop: 0 }}>
          Build a council-duty letter that asserts the help you're legally owed, plus a
          phone script, a document checklist and what to do if you're turned away.
        </p>
        <button className="btn" onClick={onGenerateLetter}>
          Build my council-duty toolkit →
        </button>
      </div>

      <p className="group-heading">Go deeper</p>
      <OptionsLadder situation={situation} />
      <CrfPrecheck situation={situation} />
      <JargonDecoder situation={situation} />
      <LandlordDrafter situation={situation} />

      <WontDecide />
    </section>
  );
}
