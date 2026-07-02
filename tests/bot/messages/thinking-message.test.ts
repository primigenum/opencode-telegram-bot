import { describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { deliverThinkingMessage } = await loadSut<typeof import("#src/bot/messages/thinking-message.js")>(
  "#src/bot/messages/thinking-message.ts",
  import.meta.url,
);
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

describe("bot/messages/thinking-message", () => {
  it("sends thinking immediately", () => {
    const batcher = {
      enqueue: vi.fn(),
      sendTextNow: vi.fn(),
    };

    deliverThinkingMessage("s1", batcher);

    expect(batcher.sendTextNow).toHaveBeenCalledWith("s1", t("bot.thinking"), "thinking_started");
    expect(batcher.enqueue).not.toHaveBeenCalled();
  });
});
