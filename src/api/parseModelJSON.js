// Defensive JSON parsing (§3) — use EVERYWHERE. Never crash on a bad model reply.
export function parseModelJSON(text) {
  if (typeof text !== "string") return null;
  let cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Best-effort: pull out the first balanced {...} or [...] block.
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null; // caller shows a graceful retry/error state, never crashes.
  }
}

// Extract the assistant text from a chat-completions response.
// Handles the Groq/OpenAI shape (choices[].message.content) and tolerates
// an Anthropic-style content-block array as a fallback — never assume index 0.
export function extractText(response) {
  if (!response) return "";

  // Groq / OpenAI: { choices: [{ message: { content } }] }
  if (Array.isArray(response.choices)) {
    return response.choices
      .map((c) => (c && c.message && typeof c.message.content === "string" ? c.message.content : ""))
      .join("");
  }

  // Fallback: Anthropic-style content blocks.
  if (Array.isArray(response.content)) {
    return response.content
      .filter((block) => block && block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  return "";
}
