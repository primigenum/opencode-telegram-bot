import { InlineKeyboard, type Context } from "grammy";
import {
  getCurrentProject,
  getCurrentSession,
  getSavedSessions,
  isSessionSaved,
} from "../../app/stores/settings-store.js";
import type { SessionInfo } from "../../app/types/session.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

/** Callback prefix handled by saved-sessions-callback-handler.ts. */
export const SAVED_SESSIONS_CALLBACK_PREFIX = "saved:";

/** Callback action names, kept short because session ids are long. */
export const SAVED_SESSIONS_SAVE_ACTION = "save";
export const SAVED_SESSIONS_UNSAVE_ACTION = "unsave";
export const SAVED_SESSIONS_OPEN_ACTION = "open";
export const SAVED_SESSIONS_DELETE_ACTION = "delete";

const SAVED_SESSION_TITLE_MAX_LENGTH = 40;

function truncateTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized.length <= SAVED_SESSION_TITLE_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, SAVED_SESSION_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

export interface ParsedSavedSessionsCallback {
  action: string;
  sessionId: string | null;
}

/** Parses "save" / "unsave" / "open:<id>" / "delete:<id>" payloads. */
export function parseSavedSessionsCallback(data: string): ParsedSavedSessionsCallback | null {
  if (!data.startsWith(SAVED_SESSIONS_CALLBACK_PREFIX)) {
    return null;
  }

  const payload = data.slice(SAVED_SESSIONS_CALLBACK_PREFIX.length);
  if (payload.length === 0) {
    return null;
  }

  const separatorIndex = payload.indexOf(":");
  if (separatorIndex < 0) {
    return { action: payload, sessionId: null };
  }

  const action = payload.slice(0, separatorIndex);
  const sessionId = payload.slice(separatorIndex + 1);
  if (action.length === 0 || sessionId.length === 0) {
    return null;
  }

  return { action, sessionId };
}

export function buildSavedSessionsOpenCallback(sessionId: string): string {
  return `${SAVED_SESSIONS_CALLBACK_PREFIX}${SAVED_SESSIONS_OPEN_ACTION}:${sessionId}`;
}

export function buildSavedSessionsDeleteCallback(sessionId: string): string {
  return `${SAVED_SESSIONS_CALLBACK_PREFIX}${SAVED_SESSIONS_DELETE_ACTION}:${sessionId}`;
}

/**
 * Saved-sessions menu of one project: a save/remove button for the current
 * session plus one row per saved session (open it or drop it from the list).
 */
export function buildSavedSessionsMenuView(worktree: string): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const saved = getSavedSessions(worktree);
  const current = getCurrentSession();
  const keyboard = new InlineKeyboard();

  if (current && current.directory === worktree) {
    const currentIsSaved = isSessionSaved(worktree, current.id);
    keyboard
      .text(
        currentIsSaved ? t("saved.remove_current") : t("saved.save_current"),
        `${SAVED_SESSIONS_CALLBACK_PREFIX}${
          currentIsSaved ? SAVED_SESSIONS_UNSAVE_ACTION : SAVED_SESSIONS_SAVE_ACTION
        }`,
      )
      .row();
  }

  saved.forEach((session: SessionInfo, index: number) => {
    keyboard
      .text(
        `▶️ ${index + 1}. ${truncateTitle(session.title)}`,
        buildSavedSessionsOpenCallback(session.id),
      )
      .text("🗑", buildSavedSessionsDeleteCallback(session.id))
      .row();
  });

  const text = [
    t("saved.title", { count: String(saved.length) }),
    saved.length === 0 ? t("saved.empty") : t("saved.hint"),
  ].join("\n");

  return { text, keyboard };
}

/** Opens the saved-sessions menu of the current project. */
export async function showSavedSessionsMenu(ctx: Context): Promise<boolean> {
  const worktree = getCurrentProject()?.worktree;
  if (!worktree) {
    await ctx.reply(t("sessions.select_project_first")).catch(() => {});
    return false;
  }

  const { text, keyboard } = buildSavedSessionsMenuView(worktree);
  await replyWithInlineMenu(ctx, { menuKind: "saved", text, keyboard });
  return true;
}
