export const AGENT_MODE_BUTTON_TEXT_PATTERN = /^(📋|🛠️|💬|🔍|📝|📄|📦|🤖)\s.+\s(?:Mode|Agent)$/;

export const MODEL_BUTTON_TEXT_PATTERN = /^🧠\s(?!.*\s(?:Mode|Agent)$)[\s\S]+$/;

// Keep support for both legacy "💭" and current "💡" prefix.
export const VARIANT_BUTTON_TEXT_PATTERN = /^(💡|💭)\s.+$/;

// The context reply-keyboard button always renders as "📊 {used} / {limit} ({percent}%)"
// (or "📊 0" when empty) in every locale — numbers only. Requiring a digit after
// the emoji keeps a user's own message that merely starts with "📊" from being
// mistaken for a button press (the old /^📊(?:\s|$)/ swallowed any such prompt
// and opened the compact-context confirmation instead of running it).
export const CONTEXT_BUTTON_TEXT_PATTERN = /^📊\s+\d/;

export const QUEUED_PROMPT_BUTTON_TEXT_PATTERN = /^❌\s\d+\.\s/;

const REPLY_KEYBOARD_BUTTON_TEXT_PATTERNS = [
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
  CONTEXT_BUTTON_TEXT_PATTERN,
  QUEUED_PROMPT_BUTTON_TEXT_PATTERN,
];

/**
 * Whether the text looks like a press on one of the reply-keyboard buttons
 * rather than a prompt the user typed.
 */
export function isReplyKeyboardButtonText(text: string): boolean {
  return REPLY_KEYBOARD_BUTTON_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}
