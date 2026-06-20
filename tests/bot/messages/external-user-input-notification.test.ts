import { beforeEach, describe, expect, it, vi } from "#vitest";
import { mockDep } from "#helpers/mock-dep.js";
import { loadSut } from "#helpers/sut-loader.js";

const mocked = {
  sendBotTextMock: vi.fn(),
};

mockDep(
  "#src/bot/messages/telegram-text.ts",
  () => ({
    sendBotText: mocked.sendBotTextMock,
  }),
  import.meta.url,
);

const serviceSut = loadSut<
  typeof import("#src/app/services/external-user-input-service.js")
>(
  "#src/app/services/external-user-input-service.ts",
  import.meta.url,
);

const sut = loadSut<typeof import("#src/bot/messages/external-user-input-notification.js")>(
  "#src/bot/messages/external-user-input-notification.ts",
  import.meta.url,
);

describe("bot/messages/external-user-input-notification", () => {
  beforeEach(() => {
    mocked.sendBotTextMock.mockReset();
    mocked.sendBotTextMock.mockResolvedValue(undefined);
  });

  it("builds a quoted notification with fallback text", () => {
    const notification = serviceSut.buildExternalUserInputNotification("Line 1\nLine 2");

    expect(notification).toEqual({
      text: expect.stringContaining("External user input"),
      rawFallbackText: "👤 External user input\n\n> Line 1\n> Line 2",
    });
  });

  it("truncates long external user input notifications", () => {
    const longText = "x".repeat(2001);

    const notification = serviceSut.buildExternalUserInputNotification(longText);

    expect(notification?.rawFallbackText).toBe(`👤 External user input\n\n> ${"x".repeat(1997)}...`);
    expect(notification?.text).toContain(`${"x".repeat(1997)}\\.\\.\\.`);
  });

  it("sends external user input when session matches and it is not suppressed", async () => {
    const delivered = await sut.deliverExternalUserInputNotification({
      api: { sendMessage: vi.fn() } as never,
      chatId: 777,
      currentSessionId: "session-1",
      sessionId: "session-1",
      text: "Review the parser",
      consumeSuppressedInput: vi.fn().mockReturnValue(false),
    });

    expect(delivered).toBe(true);
    expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 777,
        format: "markdown_v2",
        rawFallbackText: "👤 External user input\n\n> Review the parser",
      }),
    );
  });

  it("does not send notification when input is suppressed", async () => {
    const consumeSuppressedInput = vi.fn().mockReturnValue(true);

    const delivered = await sut.deliverExternalUserInputNotification({
      api: { sendMessage: vi.fn() } as never,
      chatId: 777,
      currentSessionId: "session-1",
      sessionId: "session-1",
      text: "Review the parser",
      consumeSuppressedInput,
    });

    expect(delivered).toBe(false);
    expect(consumeSuppressedInput).toHaveBeenCalledWith("session-1", "Review the parser");
    expect(mocked.sendBotTextMock).not.toHaveBeenCalled();
  });

  it("does not send notification when the current session differs", async () => {
    const delivered = await sut.deliverExternalUserInputNotification({
      api: { sendMessage: vi.fn() } as never,
      chatId: 777,
      currentSessionId: "session-2",
      sessionId: "session-1",
      text: "Review the parser",
      consumeSuppressedInput: vi.fn().mockReturnValue(false),
    });

    expect(delivered).toBe(false);
    expect(mocked.sendBotTextMock).not.toHaveBeenCalled();
  });
});
