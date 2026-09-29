import type { Bot, Context } from "grammy";
import { resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { attachSessionById } from "../../app/services/project-session-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import {
  getCurrentProject,
  getCurrentSession,
  getSavedSessions,
  removeSavedSession,
  saveSession,
} from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import {
  appendInlineMenuCancelButton,
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
} from "../menus/inline-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import {
  buildSavedSessionsMenuView,
  parseSavedSessionsCallback,
  SAVED_SESSIONS_CALLBACK_PREFIX,
  SAVED_SESSIONS_DELETE_ACTION,
  SAVED_SESSIONS_OPEN_ACTION,
  SAVED_SESSIONS_SAVE_ACTION,
  SAVED_SESSIONS_UNSAVE_ACTION,
} from "../menus/saved-sessions-menu.js";
import { alert, failure, notify } from "./feedback.js";

export interface SavedSessionsCallbackDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string) => Promise<void>;
}

/** Re-render the menu in place after a save/remove action. */
async function refreshMenu(ctx: Context, worktree: string): Promise<void> {
  const { text, keyboard } = buildSavedSessionsMenuView(worktree);

  try {
    await ctx.editMessageText(text, {
      reply_markup: appendInlineMenuCancelButton(keyboard, "saved"),
    });
  } catch (err) {
    logger.debug("[SavedSessions] Menu refresh skipped:", err);
  }
}

export async function handleSavedSessionsCallback(
  ctx: Context,
  deps: SavedSessionsCallbackDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(SAVED_SESSIONS_CALLBACK_PREFIX)) {
    return false;
  }

  const parsed = parseSavedSessionsCallback(data);
  if (!parsed) {
    return false;
  }

  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "saved");
  if (!isActiveMenu) {
    return true;
  }

  const project = getCurrentProject();
  if (!project) {
    clearActiveInlineMenu("saved_project_missing");
    await alert(ctx, "sessions.select_project_first");
    return true;
  }

  try {
    const isSaveAction =
      parsed.action === SAVED_SESSIONS_SAVE_ACTION ||
      parsed.action === SAVED_SESSIONS_UNSAVE_ACTION;

    if (isSaveAction) {
      const current = getCurrentSession();
      if (!current || current.directory !== project.worktree) {
        await alert(ctx, "saved.no_current_session");
        return true;
      }

      if (parsed.action === SAVED_SESSIONS_SAVE_ACTION) {
        saveSession(current);
        await notify(ctx, "saved.added", { title: current.title });
      } else {
        removeSavedSession(current.id);
        await notify(ctx, "saved.removed", { title: current.title });
      }

      await refreshMenu(ctx, project.worktree);
      return true;
    }

    if (parsed.action === SAVED_SESSIONS_DELETE_ACTION) {
      const sessionId = parsed.sessionId;
      if (!sessionId) {
        return false;
      }

      const removed = getSavedSessions(project.worktree).find(
        (session) => session.id === sessionId,
      );
      removeSavedSession(sessionId);
      if (removed) {
        await notify(ctx, "saved.removed", { title: removed.title });
      }

      await refreshMenu(ctx, project.worktree);
      return true;
    }

    if (parsed.action === SAVED_SESSIONS_OPEN_ACTION) {
      const sessionId = parsed.sessionId;
      const chatId = ctx.chat?.id;
      if (!sessionId || !chatId) {
        return false;
      }

      const title = await attachSessionById({
        bot: deps.bot,
        chatId,
        sessionId,
        directory: project.worktree,
        ensureEventSubscription: deps.ensureEventSubscription,
      });

      if (!title) {
        // The session is gone: drop it from the saved list so the menu stays honest.
        removeSavedSession(sessionId);
        await alert(ctx, "saved.not_found");
        await refreshMenu(ctx, project.worktree);
        return true;
      }

      clearActiveInlineMenu("saved_opened");
      await ctx.answerCallbackQuery();

      keyboardManager.updateAgent(await resolveProjectAgent());
      keyboardManager.updateModel(getStoredModel());
      const keyboard = keyboardManager.getKeyboard();

      await ctx.reply(
        t("sessions.selected", { title }),
        keyboard ? { reply_markup: keyboard } : {},
      );
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[SavedSessions] Error handling saved-sessions callback:", error);
    await failure(ctx, "sessions.select_error");
    return true;
  }
}
