import { Context, InlineKeyboard } from "grammy";
import { isTtsConfigured } from "../../app/services/tts-service.js";
import { getTtsMode, setTtsMode, type TtsMode } from "../../app/stores/settings-store.js";
import { TTS_CALLBACK_PREFIX } from "../commands/tts-command.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const TTS_MODES: TtsMode[] = ['off', 'all', 'auto'];

export async function handleTtsCallback(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith(TTS_CALLBACK_PREFIX)) {
    return false;
  }

  const mode = callbackQuery.data.slice(TTS_CALLBACK_PREFIX.length) as TtsMode;

  if (!TTS_MODES.includes(mode)) {
    return false;
  }

  if (!isTtsConfigured()) {
    await ctx.answerCallbackQuery({ text: t("tts.not_configured"), show_alert: true });
    return true;
  }

  setTtsMode(mode);

  const current = getTtsMode();

  const keyboard = new InlineKeyboard()
    .text(`${current === 'off' ? '✅ ' : ''}🔇 ${t("status.tts.off")}`, `${TTS_CALLBACK_PREFIX}off`)
    .text(`${current === 'all' ? '✅ ' : ''}🔊 ${t("status.tts.all")}`, `${TTS_CALLBACK_PREFIX}all`)
    .text(`${current === 'auto' ? '✅ ' : ''}🎤 ${t("status.tts.auto")}`, `${TTS_CALLBACK_PREFIX}auto`);

  try {
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  } catch (err) {
    logger.warn("[TTS] Failed to update inline keyboard:", err);
  }

  const messageKey = mode === 'off' ? "tts.off" : mode === 'all' ? "tts.all" : "tts.auto";
  await ctx.answerCallbackQuery({ text: t(messageKey) });

  return true;
}
