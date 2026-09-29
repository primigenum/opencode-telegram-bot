export const AGENT_MODE_BUTTON_TEXT_PATTERN = /^(📋|🛠️|💬|🔍|📝|📄|📦|🤖)\s.+\s(?:Mode|Agent)$/;

export const MODEL_BUTTON_TEXT_PATTERN = /^🧠\s(?!.*\s(?:Mode|Agent)$)[\s\S]+$/;

// The context reply-keyboard button always renders as "📊 {used} / {limit} ({percent}%)"
// (or "📊 0" when empty) in every locale — numbers only. Requiring a digit after
// the emoji keeps a user's own message that merely starts with "📊" from being
// mistaken for a button press (the old /^📊(?:\s|$)/ swallowed any such prompt
// and opened the compact-context confirmation instead of running it).
export const CONTEXT_BUTTON_TEXT_PATTERN = /^📊\s+\d/;

// ⏳ is the current queued-prompt icon; ❌ is still accepted so a keyboard
// rendered before the icon change resolves to the queue instead of falling
// through and being sent to OpenCode as a prompt.
export const QUEUED_PROMPT_BUTTON_TEXT_PATTERN = /^(?:⏳|❌)\s\d+\.\s/;

// Quick project swap button: "🔄 {folder name}". Kept deliberately broad (any
// non-empty text after the icon) so the press works for every folder name; a
// user prompt realistically never starts with this icon.
export const SWAP_PROJECT_BUTTON_TEXT_PATTERN = /^🔄\s\S/;

// Saved-sessions button: "⭐ {label}" (label is localized, so only the icon is
// matched). It opens the saved-sessions menu.
export const SAVED_SESSIONS_BUTTON_TEXT_PATTERN = /^⭐\s\S/;

const REPLY_KEYBOARD_BUTTON_TEXT_PATTERNS = [
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  CONTEXT_BUTTON_TEXT_PATTERN,
  QUEUED_PROMPT_BUTTON_TEXT_PATTERN,
  SWAP_PROJECT_BUTTON_TEXT_PATTERN,
  SAVED_SESSIONS_BUTTON_TEXT_PATTERN,
];

/**
 * Whether the text looks like a press on one of the reply-keyboard buttons
 * rather than a prompt the user typed.
 */
export function isReplyKeyboardButtonText(text: string): boolean {
  return REPLY_KEYBOARD_BUTTON_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}
