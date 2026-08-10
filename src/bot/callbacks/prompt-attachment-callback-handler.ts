import type { Context } from "grammy";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { promptAttachment } from "../../app/managers/prompt-attachment-manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export const ATTACHMENT_CANCEL_CALLBACK = "attach:cancel";

export async function handlePromptAttachmentCancel(ctx: Context): Promise<boolean> {
  if (ctx.callbackQuery?.data !== ATTACHMENT_CANCEL_CALLBACK) {
    return false;
  }

  promptAttachment.clear("user_cancelled");
  interactionManager.clear("attachment_cancelled");

  await ctx.answerCallbackQuery().catch(() => {});
  // Drop the keyboard along with the text so the button cannot be pressed twice.
  await ctx.editMessageText(t("attachment.cancelled")).catch(() => {});

  logger.debug("[PromptAttachment] Attachment cancelled by user");

  return true;
}
