import React, { useState } from "react";
import { callLLM } from "./api/llm.js";
import { parseModelJSON } from "./api/parseModelJSON.js";
import { intakeSystemPrompt } from "./domain/prompts.js";
import {
  createEmptySituation,
  mergeSituation,
} from "./domain/situation.js";
import Intake from "./components/Intake.jsx";
import Results from "./components/Results.jsx";
import LetterSuite from "./components/LetterSuite.jsx";
import SafetyBanner from "./components/SafetyBanner.jsx";
import HandoffBar from "./components/HandoffBar.jsx";
import WontDecide from "./components/WontDecide.jsx";

export default function App() {
  const [stage, setStage] = useState("welcome"); // welcome | chat | results | letter
  const [messages, setMessages] = useState([]); // [{role, content}] — content is natural language
  const [situation, setSituation] = useState(createEmptySituation());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState("");

  // Run one intake turn against the model.
  async function runIntakeTurn(nextMessages, currentSituation) {
    setBusy(true);
    setError(null);
    try {
      const text = await callLLM(
        nextMessages,
        intakeSystemPrompt(currentSituation)
      );
      const parsed = parseModelJSON(text);
      if (!parsed || typeof parsed.reply !== "string") {
        setError("Something went wrong reading that. Could you try rephrasing?");
        return;
      }
      const mergedSituation = mergeSituation(currentSituation, parsed.situationUpdate);
      setSituation(mergedSituation);
      setMessages([...nextMessages, { role: "assistant", content: parsed.reply }]);
      setReady(Boolean(parsed.readyForOutputs));
    } catch (e) {
      // Surface the real reason (callLLM throws friendly messages, e.g. rate limit)
      // instead of always blaming the server.
      setError(
        e && e.message
          ? e.message
          : "We couldn't reach the assistant. Check the server is running, then try again."
      );
    } finally {
      setBusy(false);
    }
  }

  function startChat() {
    const text = opening.trim();
    if (!text) return;
    const first = [{ role: "user", content: text }];
    setMessages(first);
    setStage("chat");
    const seeded = mergeSituation(createEmptySituation(), {
      rawUserDescription: text,
    });
    setSituation(seeded);
    runIntakeTurn(first, seeded);
  }

  function onSend(text) {
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    runIntakeTurn(next, situation);
  }

  // Tier 3 gating fills missing facts; merge them into the master situation.
  function onUpdateSituation(update) {
    setSituation((s) => mergeSituation(s, update));
  }

  return (
    <div className="app">
      <header className="haven-header">
        <h1 className="haven-logo">HAVEN</h1>
        <p className="haven-tagline">Housing Advice, Validation &amp; Eviction Navigator</p>
      </header>

      {/* Safety flags get prominent treatment on every stage, never buried. */}
      <SafetyBanner flag={situation.safetyFlag} />

      {stage === "welcome" && (
        <section className="welcome">
          <h1>Facing eviction or losing your home? Let's work out where you stand.</h1>
          <p className="lede">
            Tell us what's happening in your own words. HAVEN explains your situation in
            plain English, based on England's current rules (updated May 2026), and points
            you to the right help.
          </p>
          <WontDecide />
          <div className="card">
            <label htmlFor="opening" className="eyebrow" style={{ display: "block" }}>
              What's going on?
            </label>
            <textarea
              id="opening"
              className="intake-input"
              placeholder="e.g. My landlord gave me a Section 21 notice last week saying I have 2 months to leave…"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
            <div className="section-spacer" />
            <button className="btn" onClick={startChat} disabled={!opening.trim()}>
              Start
            </button>
            <p className="muted" style={{ marginTop: 10 }}>
              Private: nothing you type is saved or logged beyond this session.
            </p>
          </div>
        </section>
      )}

      {stage === "chat" && (
        <Intake
          messages={messages}
          onSend={onSend}
          busy={busy}
          error={error}
          ready={ready}
          onSeeResults={() => setStage("results")}
        />
      )}

      {stage === "results" && (
        <Results
          situation={situation}
          onBack={() => setStage("chat")}
          onGenerateLetter={() => setStage("letter")}
        />
      )}

      {stage === "letter" && (
        <LetterSuite
          situation={situation}
          onUpdateSituation={onUpdateSituation}
          onBack={() => setStage("results")}
        />
      )}

      <HandoffBar situation={situation} />
    </div>
  );
}
