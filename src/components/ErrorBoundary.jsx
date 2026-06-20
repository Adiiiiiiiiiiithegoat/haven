// Last line of defence: if any part of the UI throws while rendering, show a calm
// fallback that still routes the user to real human help — never a blank white screen.
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Surfaced to the console for debugging; never shown raw to a stressed user.
    console.error("[HAVEN] UI error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="app">
        <header className="haven-header">
          <h1 className="haven-logo">HAVEN</h1>
          <p className="haven-tagline">Housing Advice, Validation &amp; Eviction Navigator</p>
        </header>
        <div className="card" role="alert">
          <p className="eyebrow">Something went wrong</p>
          <h2 style={{ marginTop: 0 }}>Sorry — that didn't load properly</h2>
          <p>
            You don't have to wait for us to fix this. For free, expert housing help right now,
            call <strong>Shelter on 0808 800 4444</strong>, or your local council's housing
            options team.
          </p>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload HAVEN
          </button>
        </div>
      </div>
    );
  }
}
