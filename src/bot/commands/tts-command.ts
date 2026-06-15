import { CommandContext, Context, InlineKeyboard } from "grammy";
import { isTtsConfigured } from "../../app/services/tts-service.js";
import { getTtsMode } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";

export const TTS_CALLBACK_PREFIX = "tts:";

export async function ttsCommand(ctx: CommandContext<Context>): Promise<void> {
  if (!isTtsConfigured()) {
    await ctx.reply(t("tts.not_configured"));
    return;
  }

  const current = getTtsMode();

  const keyboard = new InlineKeyboard()
    .text(`${current === 'off' ? '✅ ' : ''}🔇 ${t("status.tts.off")}`, `${TTS_CALLBACK_PREFIX}off`)
    .text(`${current === 'all' ? '✅ ' : ''}🔊 ${t("status.tts.all")}`, `${TTS_CALLBACK_PREFIX}all`)
    .text(`${current === 'auto' ? '✅ ' : ''}🎤 ${t("status.tts.auto")}`, `${TTS_CALLBACK_PREFIX}auto`);

  await ctx.reply(t("tts.prompt"), { reply_markup: keyboard });
}
