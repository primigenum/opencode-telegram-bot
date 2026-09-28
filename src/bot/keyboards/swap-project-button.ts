import {
  getCurrentProject,
  getSessionDirectoryCache,
  getSwapProject,
} from "../../app/stores/settings-store.js";
import { getProjectFolderName } from "../menus/project-selection-menu.js";

function normalizeWorktree(worktree: string): string {
  const trimmed = worktree.replace(/[\\/]+$/g, "");
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

/** Whether two worktree paths point at the same project folder. */
export function isSameWorktree(left: string, right: string): boolean {
  return normalizeWorktree(left) === normalizeWorktree(right);
}

/** Reply-keyboard label for the quick project swap: icon + target folder name. */
export function formatSwapProjectButtonLabel(worktree: string): string {
  return `🔄 ${getProjectFolderName(worktree)}`;
}

/**
 * Label of the quick-swap keyboard button, or null when there is no other
 * project to offer. Prefers the project stored as the swap target (the one the
 * last switch moved away from) and falls back to the most recent other session
 * directory, so the row exists from the very first keyboard render. The press
 * handler resolves the real target against the server list anyway, so a stale
 * hint self-corrects on the next keyboard update.
 */
export function getSwapProjectButtonLabel(): string | null {
  const currentWorktree = getCurrentProject()?.worktree;
  const stored = getSwapProject();

  if (stored && !(currentWorktree && isSameWorktree(stored, currentWorktree))) {
    return formatSwapProjectButtonLabel(stored);
  }

  const recentOther = getSessionDirectoryCache()?.directories.find(
    (directory) => !currentWorktree || !isSameWorktree(directory.worktree, currentWorktree),
  );

  return recentOther ? formatSwapProjectButtonLabel(recentOther.worktree) : null;
}
