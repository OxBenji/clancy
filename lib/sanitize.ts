/**
 * Strip HTML tags from a string to prevent XSS in rendered log output.
 * Preserves text content, removes all tags including <script>.
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

/**
 * Validate and clamp a string to a maximum length.
 */
export function clampString(input: string, maxLength: number): string {
  if (typeof input !== "string") return "";
  return input.slice(0, maxLength);
}

/**
 * Validate a project description: string, 10-2000 chars.
 */
export function validateDescription(
  desc: unknown
): { valid: true; value: string } | { valid: false; error: string } {
  if (!desc || typeof desc !== "string") {
    return { valid: false, error: "description is required" };
  }
  const trimmed = desc.trim();
  if (trimmed.length < 10) {
    return {
      valid: false,
      error: "description must be at least 10 characters",
    };
  }
  if (trimmed.length > 2000) {
    return {
      valid: false,
      error: "description must be 2000 characters or fewer",
    };
  }
  return { valid: true, value: trimmed };
}

/**
 * Validate chat messages array: each message must have role and content (max 4000 chars).
 */
export function validateMessages(
  msgs: unknown
): { valid: true; value: { role: "user" | "assistant"; content: string }[] } | { valid: false; error: string } {
  if (!Array.isArray(msgs) || msgs.length === 0) {
    return { valid: false, error: "messages array is required and must not be empty" };
  }
  if (msgs.length > 50) {
    return { valid: false, error: "too many messages (max 50)" };
  }
  const validated: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of msgs) {
    if (!m || typeof m.content !== "string" || !["user", "assistant"].includes(m.role)) {
      return { valid: false, error: "each message must have role (user|assistant) and content (string)" };
    }
    validated.push({
      role: m.role,
      content: m.content.slice(0, 4000),
    });
  }
  return { valid: true, value: validated };
}
