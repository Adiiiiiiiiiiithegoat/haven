// 1.1 Conversational intake — chat UI. Calls the model, expects the §3 JSON shape.
import React, { useRef, useEffect, useState } from "react";

export default function Intake({ messages, onSend, busy, error, ready, onSeeResults }) {
  const [draft, setDraft] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <section aria-label="Tell us what's happening">
      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role === "user" ? "user" : "haven"}`}>
            {m.content}
          </div>
        ))}
        {busy && (
          <div className="bubble haven" aria-live="polite">
            <span className="dots">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {ready && (
        <button className="btn" onClick={onSeeResults} style={{ marginBottom: 12 }}>
          See your situation →
        </button>
      )}

      <div className="composer">
        <textarea
          className="intake-input"
          placeholder="Type your reply…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Your message"
          disabled={busy}
        />
        <button className="btn" onClick={submit} disabled={busy || !draft.trim()}>
          Send
        </button>
      </div>
    </section>
  );
}
