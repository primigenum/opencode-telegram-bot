import type { Context } from "grammy";
import { getProjects } from "../../app/services/project-service.js";
import { switchToProject } from "../../app/services/project-switch-service.js";
import { getCurrentProject, getSwapProject } from "../../app/stores/settings-store.js";
import { isSameWorktree } from "../keyboards/swap-project-button.js";
import { getProjectFolderName } from "../menus/project-selection-menu.js";
import { createProjectSwitchPresentation } from "../services/project-switch-presentation.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export interface SwapProjectDeps {
  ensureEventSubscription?: (directory: string) => Promise<void>;
}

/**
 * Quick project swap from the reply keyboard: switches to the other project,
 * no matter whether a session is running (the switch detaches it). The target
 * is the stored swap project when it still exists, otherwise the most recently
 * active other project. Unlike the /projects menu this path is deliberately not
 * blocked while the session is busy: bypassing the busy gate is the whole point.
 */
export async function handleSwapProjectButton(
  ctx: Context,
  deps: SwapProjectDeps = {},
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

    const keyboard = await switchToProject(ctx, target, "project_swapped", {
      ensureEventSubscription: deps.ensureEventSubscription,
      presentation: createProjectSwitchPresentation(),
    });

    await ctx.reply(t("projects.selected", { project: projectName }), {
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error("[Bot] Error handling project swap button:", error);
    await ctx.reply(t("projects.select_error")).catch(() => {});
  }
}
