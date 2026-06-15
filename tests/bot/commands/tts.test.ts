import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { ttsCommand } from "../../../src/bot/commands/tts-command.js";
import { handleTtsCallback } from "../../../src/bot/callbacks/tts-callback-handler.js";
import { t } from "../../../src/i18n/index.js";
import { TTS_CALLBACK_PREFIX } from "../../../src/bot/commands/tts-command.js";

const mocked = vi.hoisted(() => ({
  getTtsModeMock: vi.fn(),
  setTtsModeMock: vi.fn(),
  isTtsConfiguredMock: vi.fn(),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getTtsMode: mocked.getTtsModeMock,
  setTtsMode: mocked.setTtsModeMock,
}));

vi.mock("../../../src/app/services/tts-service.js", () => ({
  isTtsConfigured: mocked.isTtsConfiguredMock,
}));

describe("bot/commands/tts-command", () => {
  beforeEach(() => {
    mocked.getTtsModeMock.mockReset();
    mocked.setTtsModeMock.mockReset();
    mocked.isTtsConfiguredMock.mockReset();
  });

  it("shows inline keyboard with current mode selected", async () => {
    mocked.getTtsModeMock.mockReturnValue("all");
    mocked.isTtsConfiguredMock.mockReturnValue(true);
    const replyMock = vi.fn().mockResolvedValue({ message_id: 1 });
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/tts" },
      reply: replyMock,
    } as unknown as Context;

    await ttsCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledTimes(1);
    const [text, opts] = replyMock.mock.calls[0];
    expect(text).toBe(t("tts.prompt"));
    expect(opts.reply_markup.inline_keyboard[0][0].text).toContain("🔇");
    expect(opts.reply_markup.inline_keyboard[0][1].text).toContain("✅");
    expect(opts.reply_markup.inline_keyboard[0][2].text).toContain("🎤");
  });

  it("shows not configured when TTS is not configured", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(false);
    const replyMock = vi.fn().mockResolvedValue({ message_id: 1 });
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/tts" },
      reply: replyMock,
    } as unknown as Context;

    await ttsCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("tts.not_configured"));
  });
});

describe("bot/callbacks/tts-callback-handler", () => {
  beforeEach(() => {
    mocked.getTtsModeMock.mockReset();
    mocked.setTtsModeMock.mockReset();
    mocked.isTtsConfiguredMock.mockReset();
  });

  it("sets mode and updates keyboard on callback", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(true);
    mocked.getTtsModeMock.mockReturnValue("off");
    const editReplyMarkupMock = vi.fn().mockResolvedValue(undefined);
    const answerCbMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      callbackQuery: { data: `${TTS_CALLBACK_PREFIX}all` },
      editMessageReplyMarkup: editReplyMarkupMock,
      answerCallbackQuery: answerCbMock,
    } as unknown as Context;

    const result = await handleTtsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setTtsModeMock).toHaveBeenCalledWith("all");
    expect(editReplyMarkupMock).toHaveBeenCalledTimes(1);
    expect(answerCbMock).toHaveBeenCalledWith({ text: t("tts.all") });
  });

  it("rejects unknown callback prefix", async () => {
    const ctx = {
      callbackQuery: { data: "unknown:data" },
    } as unknown as Context;

    const result = await handleTtsCallback(ctx);
    expect(result).toBe(false);
  });

  it("shows alert when not configured", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(false);
    const answerCbMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      callbackQuery: { data: `${TTS_CALLBACK_PREFIX}all` },
      answerCallbackQuery: answerCbMock,
    } as unknown as Context;

    const result = await handleTtsCallback(ctx);

    expect(result).toBe(true);
    expect(answerCbMock).toHaveBeenCalledWith({ text: t("tts.not_configured"), show_alert: true });
  });
});
