import { Context, InlineKeyboard } from "grammy";
import { promptQueue, type QueuedPrompt } from "../../app/managers/prompt-queue-manager.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

/** Callback prefix handled by queue-callback-handler.ts. */
export const QUEUE_CALLBACK_PREFIX = "queue:";

/**
 * Per-message menu for a queued prompt: stop the running task, send this
 * message now, or delete it from the queue.
 */
export function buildQueuedPromptMenuKeyboard(queuedPromptId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("queue.menu.stop"), `${QUEUE_CALLBACK_PREFIX}stop:${queuedPromptId}`)
    .text(t("queue.menu.send"), `${QUEUE_CALLBACK_PREFIX}send:${queuedPromptId}`)
    .row()
    .text(t("queue.menu.delete"), `${QUEUE_CALLBACK_PREFIX}delete:${queuedPromptId}`);
}

/**
 * Open the queue menu for a pressed queued-prompt button.
 * @returns false when the queued prompt disappears before the menu is built
 */
export async function showQueuedPromptMenu(
  ctx: Context,
  queuedPrompt: QueuedPrompt,
): Promise<boolean> {
  const index = promptQueue.list().findIndex((item) => item.id === queuedPrompt.id);
  if (index < 0) {
    return false;
  }

  await replyWithInlineMenu(ctx, {
    menuKind: "queue",
    text: t("queue.menu.title", { index: String(index + 1), text: queuedPrompt.displayText }),
    keyboard: buildQueuedPromptMenuKeyboard(queuedPrompt.id),
  });

  return true;
}
