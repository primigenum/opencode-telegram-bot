export const MAX_SESSION_TITLE_LENGTH = 64;

const DEFAULT_SESSION_TITLE_PATTERN =
  /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * True when the title is the placeholder the OpenCode server assigns on
 * session creation ("New session - <ISO>" / "Child session - <ISO>"). The
 * pattern is strict on purpose: a user title that merely starts with
 * "New session - " but is not an ISO timestamp must not match.
 */
export function isDefaultSessionTitle(title: string): boolean {
  return DEFAULT_SESSION_TITLE_PATTERN.test(title);
}

/**
 * Derives a session title from the first user prompt: first non-empty line,
 * internal whitespace collapsed, truncated to MAX_SESSION_TITLE_LENGTH with a
 * word-boundary cut when possible. Returns null when there is no usable text.
 */
export function deriveTitleFromPrompt(text: string): string | null {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!firstLine) {
    return null;
  }

  const collapsed = firstLine.trim().replace(/\s+/g, " ");
  if (collapsed.length <= MAX_SESSION_TITLE_LENGTH) {
    return collapsed;
  }

  // Reserve one character for the ellipsis so the result never exceeds the cap.
  let truncated = collapsed.slice(0, MAX_SESSION_TITLE_LENGTH - 1);
  // Never split a surrogate pair: a trailing high surrogate would render as a
  // broken glyph once the ellipsis is appended.
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
  return `${cut.trimEnd()}…`;
}
