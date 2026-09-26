import { Context } from "grammy";
import { promptQueue } from "../../app/managers/prompt-queue-manager.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { abortCurrentOperation } from "../commands/abort-command.js";
import { dispatchNextQueuedPrompt } from "../handlers/prompt-queue-dispatch.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu } from "../menus/inline-menu.js";
import { QUEUE_CALLBACK_PREFIX } from "../menus/queued-prompt-menu.js";
import { alert, failure, notify, switched } from "./feedback.js";

const QUEUE_ACTIONS = ["stop", "send", "delete"] as const;
type QueueAction = (typeof QUEUE_ACTIONS)[number];

function parseQueueAction(data: string): { action: QueueAction; id: string } | null {
  const [prefix, action, ...idParts] = data.split(":");
  const id = idParts.join(":");
  if (prefix !== "queue" || !id || !QUEUE_ACTIONS.includes(action as QueueAction)) {
    return null;
  }

  return { action: action as QueueAction, id };
}

/**
 * Handle the queue menu actions: stop the current task, send a queued message
 * now, or delete it from the queue.
 * @returns true when the callback was handled, false to let the router answer
 */
export async function handleQueueCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;

  if (!data?.startsWith(QUEUE_CALLBACK_PREFIX)) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "queue");
  if (!isActiveMenu) {
    return true;
  }

  const parsed = parseQueueAction(data);
  if (!parsed) {
    return false;
  }

  logger.debug(`[QueueHandler] Action=${parsed.action}, id=${parsed.id}`);

  try {
    if (parsed.action === "stop") {
      await handleStop(ctx);
      return true;
    }

    if (parsed.action === "send") {
      await handleSendNow(ctx, parsed.id);
      return true;
    }

    await handleDelete(ctx, parsed.id);
    return true;
  } catch (err) {
    clearActiveInlineMenu("queue_action_error");
    logger.error("[QueueHandler] Queue action failed:", err);
    await failure(ctx, "callback.processing_error");
    return true;
  }
}

/**
 * Stop only the running task, keeping the queue intact so it keeps draining.
 */
async function handleStop(ctx: Context): Promise<void> {
  if (!isForegroundBusy()) {
    // Nothing to stop: leave the menu open so send/delete stay reachable.
    await notify(ctx, "queue.action.no_active_run");
    return;
  }

  clearActiveInlineMenu("queue_stop");
  await abortCurrentOperation(ctx, { notifyUser: false, keepQueue: true });
  void dispatchNextQueuedPrompt();
  await confirmWithKeyboard(ctx, t("queue.action.stopped"));
}

/**
 * Promote the queued message to the front and run it now, interrupting the
 * current task when one is running.
 */
async function handleSendNow(ctx: Context, queuedId: string): Promise<void> {
  const moved = promptQueue.moveToFront(queuedId);
  if (!moved) {
    clearActiveInlineMenu("queue_send_not_found");
    await alert(ctx, "queue.not_found");
    await ctx.deleteMessage().catch(() => {});
    return;
  }

  clearActiveInlineMenu("queue_send");
  if (isForegroundBusy()) {
    await abortCurrentOperation(ctx, { notifyUser: false, keepQueue: true });
  }
  void dispatchNextQueuedPrompt();
  await confirmWithKeyboard(ctx, t("queue.action.sending", { text: moved.displayText }));
}

async function handleDelete(ctx: Context, queuedId: string): Promise<void> {
  const removed = promptQueue.removeById(queuedId);
  clearActiveInlineMenu("queue_delete");
  if (!removed) {
    await alert(ctx, "queue.not_found");
    await ctx.deleteMessage().catch(() => {});
    return;
  }

  await confirmWithKeyboard(ctx, t("queue.removed"));
}

/**
 * Confirm an action that changes the queued-message buttons: the reply keyboard
 * travels with a regular message (Telegram cannot update a reply keyboard
 * through the callback answer).
 */
async function confirmWithKeyboard(ctx: Context, text: string): Promise<void> {
  const keyboard = keyboardManager.getKeyboard();
  if (keyboard) {
    await switched(ctx, text, keyboard);
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(text);
  await ctx.deleteMessage().catch(() => {});
}
