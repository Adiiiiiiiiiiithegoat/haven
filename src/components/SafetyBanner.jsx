// 1.5 / §7 — Safety flags get calm, prominent, supportive treatment (never buried).
import React from "react";

export default function SafetyBanner({ flag }) {
  if (!flag || flag === "none") return null;

  if (flag === "domesticAbuse") {
    return (
      <section className="safety domesticAbuse" role="alert" aria-live="polite">
        <h2>Your safety comes first</h2>
        <p>
          Before anything about your tenancy, let's make sure you're safe. If you're in
          immediate danger, call <strong>999</strong> now.
        </p>
        <p>
          The free, 24-hour{" "}
          <a href="tel:08082000247">National Domestic Abuse Helpline — 0808 2000 247</a>{" "}
          can help you leave safely. Your council also has an{" "}
          <strong>emergency housing duty</strong> if you have to flee your home — you can
          ask them for emergency accommodation.
        </p>
        <p className="muted">
          We'll keep helping with your housing questions too, whenever you're ready.
        </p>
      </section>
    );
  }

  // acuteDistress
  return (
    <section className="safety acuteDistress" role="alert" aria-live="polite">
      <h2>You don't have to face this alone</h2>
      <p>
        This sounds really hard, and it makes sense to feel overwhelmed. If you're
        struggling to cope, you can talk to someone right now — call{" "}
        <a href="tel:116123">Samaritans on 116 123</a>, free, any time.
      </p>
      <p>
        Shelter's helpline (<a href="tel:08088004444">0808 800 4444</a>) can talk through
        the housing side with a real person. We can keep going together when you're ready.
      </p>
    </section>
  );
}
