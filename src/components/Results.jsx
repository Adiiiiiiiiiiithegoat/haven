// Results view — renders Tier 1 outputs as clean components (not a chat wall).
// Each output is its OWN focused call (§3). They run in parallel and render as they land.
import React, { useEffect, useState } from "react";
import { callLLM } from "../api/llm.js";
import { parseModelJSON } from "../api/parseModelJSON.js";
import { noticeCheckCall, timelineCall, actionPlanCall } from "../domain/prompts.js";
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

function Loading({ label }) {
  return (
    <p className="loading">
      {label}{" "}
      <span className="dots">
        <span></span>
        <span></span>
        <span></span>
      </span>
    </p>
  );
}

function ErrorRetry({ message, onRetry }) {
  return (
    <div className="error-box" role="alert">
      {message}
      <div style={{ marginTop: 8 }}>
        <button className="btn secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
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

export default function Results({ situation, onBack }) {
  return (
    <section aria-label="Your situation">
      <button className="btn secondary" onClick={onBack} style={{ marginBottom: 6 }}>
        ← Back to the conversation
      </button>
      <NoticeCheck situation={situation} />
      <Timeline situation={situation} />
      <ActionPlan situation={situation} />
      <WontDecide />
    </section>
  );
}
