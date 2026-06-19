import { beforeEach, describe, expect, it, vi } from "#vitest";
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
    expect(opts.reply_markup.inline_keyboard[1][0].text).toContain("✅");
    expect(opts.reply_markup.inline_keyboard[2][0].text).toContain("🎤");
  });

  it("shows mode menu even when TTS is not configured", async () => {
    mocked.getTtsModeMock.mockReturnValue("off");
    mocked.isTtsConfiguredMock.mockReturnValue(false);
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
    expect(opts.reply_markup.inline_keyboard[0][0].text).toContain("✅");
  });
});

describe("bot/callbacks/tts-callback-handler", () => {
  beforeEach(() => {
    mocked.getTtsModeMock.mockReset();
    mocked.setTtsModeMock.mockReset();
    mocked.isTtsConfiguredMock.mockReset();
  });

  it("sets mode and deletes menu message on callback", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(true);
    mocked.getTtsModeMock.mockReturnValue("off");
    const deleteMessageMock = vi.fn().mockResolvedValue(undefined);
    const answerCbMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      callbackQuery: { data: `${TTS_CALLBACK_PREFIX}all` },
      deleteMessage: deleteMessageMock,
      answerCallbackQuery: answerCbMock,
    } as unknown as Context;

    const result = await handleTtsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setTtsModeMock).toHaveBeenCalledWith("all");
    expect(answerCbMock).toHaveBeenCalledWith({ text: t("tts.all") });
    expect(deleteMessageMock).toHaveBeenCalledTimes(1);
  });

  it("removes keyboard when deleting menu message fails", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(true);
    const deleteMessageMock = vi.fn().mockRejectedValue(new Error("delete failed"));
    const editReplyMarkupMock = vi.fn().mockResolvedValue(undefined);
    const answerCbMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      callbackQuery: { data: `${TTS_CALLBACK_PREFIX}auto` },
      deleteMessage: deleteMessageMock,
      editMessageReplyMarkup: editReplyMarkupMock,
      answerCallbackQuery: answerCbMock,
    } as unknown as Context;

    const result = await handleTtsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setTtsModeMock).toHaveBeenCalledWith("auto");
    expect(deleteMessageMock).toHaveBeenCalledTimes(1);
    expect(editReplyMarkupMock).toHaveBeenCalledTimes(1);
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
    expect(mocked.setTtsModeMock).not.toHaveBeenCalled();
    expect(answerCbMock).toHaveBeenCalledWith({ text: t("tts.not_configured"), show_alert: true });
  });

  it("allows selecting off when TTS is not configured", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(false);
    mocked.getTtsModeMock.mockReturnValue("off");
    const deleteMessageMock = vi.fn().mockResolvedValue(undefined);
    const answerCbMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      callbackQuery: { data: `${TTS_CALLBACK_PREFIX}off` },
      deleteMessage: deleteMessageMock,
      answerCallbackQuery: answerCbMock,
    } as unknown as Context;

    const result = await handleTtsCallback(ctx);

    expect(result).toBe(true);
    expect(mocked.setTtsModeMock).toHaveBeenCalledWith("off");
    expect(answerCbMock).toHaveBeenCalledWith({ text: t("tts.off") });
    expect(deleteMessageMock).toHaveBeenCalledTimes(1);
  });
});
