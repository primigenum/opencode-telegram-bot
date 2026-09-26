import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
import { QUEUED_PROMPT_BUTTON_TEXT_PATTERN } from "#src/bot/message-patterns.js";
import { promptQueue } from "#src/app/managers/prompt-queue-manager.js";
import { interactionManager } from "#src/app/managers/interaction-manager.js";
import { t } from "#src/i18n/index.js";
import { defined } from "#helpers/defined.js";
import { createIncomingPrompt } from "#src/app/types/prompt.js";
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

    expect(bot.hears).toHaveBeenCalledTimes(5);
    // The queued prompt route must win over the other reply keyboard routes.
    expect(defined(bot.hears.mock.calls[0]?.[0])).toBe(QUEUED_PROMPT_BUTTON_TEXT_PATTERN);
    expect(bot.on.mock.calls.map(([event]) => event)).toEqual([
      "message:text",
      "message:text",
      "message:voice",
      "message:audio",
      "message",
      "message:photo",
      "message:document",
      "message:video",
      "message:text",
      "message",
    ]);
  });

  describe("queued prompt button handler", () => {
    function registerAndGetQueuedPromptHandler() {
      const bot = { on: vi.fn(), hears: vi.fn() };

      registerMessageRouter(bot as never, {
        ensureEventSubscription: vi.fn(),
        setTelegramContext: vi.fn(),
      });

      return defined(bot.hears.mock.calls[0]?.[1]) as (ctx: unknown, next: () => Promise<void>) => Promise<void>;
    }

    function makeButtonContext(text: string) {
      return {
        chat: { id: 42 },
        message: { text },
        reply: vi.fn().mockResolvedValue({ message_id: 99 }),
      };
    }

    beforeEach(() => {
      promptQueue.__resetForTests();
      interactionManager.clear("message_router_test_reset");
    });

    it("opens the queue menu instead of removing the pressed prompt", async () => {
      promptQueue.add(createIncomingPrompt("first"));
      promptQueue.add(createIncomingPrompt("second"));
      promptQueue.add(createIncomingPrompt("third"));
      const handler = registerAndGetQueuedPromptHandler();
      const ctx = makeButtonContext("❌ 2. second");
      const next = vi.fn();

      await handler(ctx, next);

      // Nothing is removed: stop/send/delete are explicit menu actions now.
      expect(promptQueue.list().map((item) => item.text)).toEqual(["first", "second", "third"]);
      expect(interactionManager.getSnapshot()?.kind).toBe("inline");

      const replyOptions = defined(ctx.reply.mock.calls[0]?.[1]) as {
        reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> };
      };
      const callbackData = replyOptions.reply_markup.inline_keyboard
        .flat()
        .map((button) => button.callback_data);
      expect(callbackData).toEqual([
        "queue:stop:queued-2",
        "queue:send:queued-2",
        "queue:delete:queued-2",
        "inline:cancel:queue",
      ]);
      expect(defined(ctx.reply.mock.calls[0]?.[0])).toBe(
        t("queue.menu.title", { index: "2", text: "second" }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("never forwards a stale button label to OpenCode when the queue is empty", async () => {
      const handler = registerAndGetQueuedPromptHandler();
      const ctx = makeButtonContext("❌ 1. cleared by abort");
      const next = vi.fn();

      await handler(ctx, next);

      expect(next).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(t("queue.not_found"), expect.anything());
    });

    it("answers not_found when the label no longer matches the queue", async () => {
      promptQueue.add(createIncomingPrompt("still queued"));
      const handler = registerAndGetQueuedPromptHandler();
      const ctx = makeButtonContext("❌ 3. already gone");
      const next = vi.fn();

      await handler(ctx, next);

      expect(next).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(t("queue.not_found"), expect.anything());
      expect(promptQueue.size()).toBe(1);
    });
  });
});
