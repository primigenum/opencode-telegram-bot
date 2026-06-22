import { describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { registerMessageRouter } = await loadSut<typeof import("#src/bot/routers/message-router.js")>(
  "#src/bot/routers/message-router.ts",
  import.meta.url,
);

describe("bot/routers/message-router", () => {
  it("registers reply keyboard, media, and text routes", () => {
    const bot = {
      on: vi.fn(),
      hears: vi.fn(),
    };

    registerMessageRouter(bot as never, {
      ensureEventSubscription: vi.fn(),
      setTelegramContext: vi.fn(),
    });

    expect(bot.hears).toHaveBeenCalledTimes(4);
    expect(bot.on.mock.calls.map(([event]) => event)).toEqual([
      "message:text",
      "message:text",
      "message:voice",
      "message:audio",
      "message",
      "message:photo",
      "message:document",
      "message:text",
    ]);
  });
});
