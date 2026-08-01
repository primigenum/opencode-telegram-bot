import { describe, expect, it, vi } from "#vitest";
import type { Context, NextFunction } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
const { ensureCommandsInitialized, registerCommandRouter } = await loadSut<typeof import("#src/bot/routers/command-router.js")>(
  "#src/bot/routers/command-router.ts",
  import.meta.url,
);
const { BOT_COMMANDS } = await loadSut<typeof import("#src/bot/commands/definitions.js")>(
  "#src/bot/commands/definitions.ts",
  import.meta.url,
);
const { config } = await loadSut<typeof import("#src/config.js")>(
  "#src/config.ts",
  import.meta.url,
);

const flushPendingPromptMock = vi.hoisted(() => vi.fn());

vi.mock("#src/bot/handlers/message-merger.ts", () => ({
  flushPendingPrompt: flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));

describe("bot/routers/command-router", () => {
  it("registers bot slash command handlers", () => {
    const bot = { command: vi.fn(), use: vi.fn() };

    registerCommandRouter(bot as never, { ensureEventSubscription: vi.fn() });

    expect(bot.command.mock.calls.map(([command]) => command)).toEqual([
      "start",
      "help",
      "status",
      "settings",
      "opencode_start",
      "opencode_stop",
      "projects",
      "worktree",
      "open",
      "ls",
      "sessions",
      "messages",
      "new",
      "abort",
      "detach",
      "task",
      "tasklist",
      "rename",
      "commands",
      "skills",
      "mcps",
    ]);
  });

  it("flushes a pending prompt before routing a command", async () => {
    const bot = { command: vi.fn(), use: vi.fn() };
    const next = vi.fn();
    registerCommandRouter(bot as never, { ensureEventSubscription: vi.fn() });
    const middleware = bot.use.mock.calls[0][0];
    const ctx = { chat: { id: 123 }, message: { text: "/new" } } as unknown as Context;

    await middleware(ctx, next);

    expect(flushPendingPromptMock).toHaveBeenCalledWith(123);
    expect(next).toHaveBeenCalledOnce();
  });

  it("initializes commands for the authorized chat", async () => {
    const next: NextFunction = vi.fn();
    const ctx = {
      from: { id: config.telegram.allowedUserId },
      chat: { id: 123 },
      api: { setMyCommands: vi.fn() },
    } as unknown as Context;

    await ensureCommandsInitialized(ctx, next);

    expect(ctx.api.setMyCommands).toHaveBeenCalledWith(BOT_COMMANDS, {
      scope: { type: "chat", chat_id: 123 },
    });
    expect(next).toHaveBeenCalledOnce();
  });
});
