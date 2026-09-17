import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import type { TelegramRenderedPart } from "./types.js";

/**
 * CJK guard: model output occasionally drifts into Chinese/Japanese/Korean
 * despite explicit instructions. This filter guarantees that no CJK character
 * reaches the user through Telegram (see AGENTS.md "Language hard check").
 *
 * Scope: model-generated content (assistant text, reasoning, questions,
 * transcriptions, summaries). Content is only altered when CJK is actually
 * present; when removal empties the message, a localized notice replaces it.
 */
const CJK_PATTERN =
  /[\u1100-\u11FF\u2E80-\u2EFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3130-\u318F\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7AF\uD7B0-\uD7FF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u{20000}-\u{2FA1F}\u{30000}-\u{3134F}]/gu;

export interface CjkSanitizeResult {
  /** Sanitized text (or the localized notice when everything was CJK). */
  text: string;
  /** Number of CJK characters removed. */
  removed: number;
  /** True when the message was almost entirely CJK and got replaced. */
  blocked: boolean;
}

export function sanitizeCjkText(text: string): CjkSanitizeResult {
  if (!text) {
    return { text, removed: 0, blocked: false };
  }

  let removed = 0;
  const cleaned = text.replace(CJK_PATTERN, () => {
    removed++;
    return "";
  });

  if (removed === 0) {
    return { text, removed: 0, blocked: false };
  }

  const blocked = cleaned.trim().length === 0;
  logger.warn("[CjkGuard] Removed CJK characters from outgoing message", {
    removed,
    blocked,
    originalLength: text.length,
  });

  return { text: blocked ? t("cjk_guard.blocked_notice") : cleaned, removed, blocked };
}

/**
 * Guards a rendered part before delivery. Parts that carry CJK are rebuilt
 * from their sanitized plain projection — partially sanitized rich blocks
 * could otherwise still leak content through the native rich payload.
 */
export function guardRenderedPart(part: TelegramRenderedPart): TelegramRenderedPart {
  const result = sanitizeCjkText(part.fallbackText);
  if (result.removed === 0) {
    return part;
  }

  return {
    blocks: [],
    fallbackText: result.text,
    source: "plain",
  };
}
