import { describe, expect, it, vi } from "#vitest";
import type { Context, NextFunction } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
const { unknownCommandMiddleware } = await loadSut<typeof import("#src/bot/middleware/unknown-command.js")>(
  "#src/bot/middleware/unknown-command.ts",
  import.meta.url,
);
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

function createTextContext(text: string): Context {
  return {
    message: { text } as Context["message"],
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("unknownCommandMiddleware", () => {
  it("replies for unknown slash command in idle flow", async () => {
    const ctx = createTextContext("/foobar");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await unknownCommandMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      t("bot.unknown_command", {
        command: "/foobar",
      }),
    );
  });

  it("passes through known command", async () => {
    const ctx = createTextContext("/status");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await unknownCommandMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("passes through known command with bot mention", async () => {
    const ctx = createTextContext("/help@MyBot");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await unknownCommandMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("passes through non-command text", async () => {
    const ctx = createTextContext("hello there");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await unknownCommandMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
