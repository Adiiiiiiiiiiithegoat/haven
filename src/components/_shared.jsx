// Shared UI helpers used by the results and letter-suite screens.
import React, { useState, useCallback } from "react";
import { callLLM } from "../api/llm.js";
import { parseModelJSON } from "../api/parseModelJSON.js";

// Defensive: coerce a model-supplied value to renderable text. Guards against the model
// occasionally returning an object/array where a string was asked for (which would
// otherwise crash React with "Objects are not valid as a React child").
export function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join("; ");
  if (typeof v === "object") {
    return (
      v.text || v.detail || v.point || v.step || v.label || v.value || JSON.stringify(v)
    );
  }
  return String(v);
}

export function Loading({ label }) {
  return (
    <p className="loading" aria-live="polite">
      {label}{" "}
      <span className="dots">
        <span></span>
        <span></span>
        <span></span>
      </span>
    </p>
  );
}

export function ErrorRetry({ message, onRetry }) {
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

// On-demand call (user triggers it). Handles JSON or prose (json:false) calls.
// run(callSpec, { parse, validate }) — parse=false returns raw text in `data`.
export function useLazyCall() {
  const [state, setState] = useState({
    data: null,
    error: null,
    loading: false,
    started: false,
  });

  const run = useCallback(async (callSpec, { parse = true, validate } = {}) => {
    setState({ data: null, error: null, loading: true, started: true });
    try {
      const { system, messages, maxTokens, json } = callSpec;
      const text = await callLLM(messages, system, { maxTokens, json });
      if (!parse) {
        setState({ data: text, error: null, loading: false, started: true });
        return;
      }
      const parsed = parseModelJSON(text);
      if (!parsed || (validate && !validate(parsed))) {
        setState({
          data: null,
          error: "We couldn't read that result. Try again in a moment.",
          loading: false,
          started: true,
        });
        return;
      }
      setState({ data: parsed, error: null, loading: false, started: true });
    } catch (e) {
      setState({ data: null, error: String(e.message || e), loading: false, started: true });
    }
  }, []);

  return { ...state, run };
}
