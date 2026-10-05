import type { Bot, Context } from "grammy";
import { promptQueue } from "../../app/managers/prompt-queue-manager.js";
import { resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { getProjects } from "../../app/services/project-service.js";
import { attachLatestProjectSession } from "../../app/services/project-session-service.js";
import { switchToProject } from "../../app/services/project-switch-service.js";
import { getCurrentProject, getSwapProject } from "../../app/stores/settings-store.js";
import { isSameWorktree } from "../keyboards/swap-project-button.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { getProjectFolderName } from "../menus/project-selection-menu.js";
import { createProjectSwitchPresentation } from "../services/project-switch-presentation.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export interface SwapProjectDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string) => Promise<void>;
}

/**
 * Quick project swap from the reply keyboard: switches to the other project,
 * no matter whether a session is running (the switch detaches it) and lands on
 * that project's most recently updated session. The target is the stored swap
 * project when it still exists, otherwise the most recently active other
 * project. Unlike the /projects menu this path is deliberately not blocked while
 * the session is busy: bypassing the busy gate is the whole point.
 */
export async function handleSwapProjectButton(
  ctx: Context,
  deps: SwapProjectDeps,
): Promise<void> {
  try {
    const projects = await getProjects();
    const current = getCurrentProject();
    const others = projects.filter(
      (project) => !current || !isSameWorktree(project.worktree, current.worktree),
    );

    const storedSwap = getSwapProject();
    const preferred = storedSwap
      ? others.find((project) => isSameWorktree(project.worktree, storedSwap))
      : undefined;
    const target = preferred ?? others[0];

    if (!target) {
      await ctx.reply(t("projects.swap_unavailable")).catch(() => {});
      return;
    }

    const projectName = target.name || getProjectFolderName(target.worktree);
    logger.info(`[Bot] Project swap button pressed: switching to ${projectName}`);

    const queuedBeforeSwap = promptQueue.size();

    const keyboard = await switchToProject(ctx, target, "project_swapped", {
      ensureEventSubscription: deps.ensureEventSubscription,
      presentation: createProjectSwitchPresentation(),
    });

    // The switch clears queued prompts: never drop them without telling the user.
    const droppedQueuedPrompts = Math.max(queuedBeforeSwap - promptQueue.size(), 0);

    // Land on the target project's most recent session. Without this the swap
    // left the chat with no session to prompt and no pinned session.
    let sessionTitle: string | null = null;
    if (ctx.chat) {
      try {
        sessionTitle = await attachLatestProjectSession({
          bot: deps.bot,
          chatId: ctx.chat.id,
          directory: target.worktree,
          ensureEventSubscription: deps.ensureEventSubscription,
        });

        if (sessionTitle) {
          // The session's agent and model were adopted by the attach: refresh the
          // keyboard so its buttons match the session we landed on.
          keyboardManager.updateAgent(await resolveProjectAgent());
          keyboardManager.updateModel(getStoredModel());
        }
      } catch (error) {
        // The project is already switched: a landing failure must not report the
        // swap itself as failed.
        logger.error("[Bot] Failed to land on a session after the project swap:", error);
        sessionTitle = null;
      }
    }

    const replyKeyboard = (sessionTitle ? keyboardManager.getKeyboard() : undefined) ?? keyboard;

    await ctx.reply(t("projects.selected", { project: projectName }), {
      reply_markup: replyKeyboard,
    });

    if (sessionTitle) {
      await ctx.reply(t("sessions.selected", { title: sessionTitle })).catch(() => {});
    } else {
      await ctx.reply(t("sessions.none_in_project", { project: projectName })).catch(() => {});
    }

    if (droppedQueuedPrompts > 0) {
      await ctx
        .reply(t("queue.discarded", { count: String(droppedQueuedPrompts) }))
        .catch(() => {});
    }
  } catch (error) {
    logger.error("[Bot] Error handling project swap button:", error);
    await ctx.reply(t("projects.select_error")).catch(() => {});
  }
}
