import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
import type { Context } from "grammy";
import { promptQueue } from "#src/app/managers/prompt-queue-manager.js";
import { createIncomingPrompt } from "#src/app/types/prompt.js";
import { t } from "#src/i18n/index.js";

const mocked = {
  abortCurrentOperationMock: vi.fn(),
  dispatchNextQueuedPromptMock: vi.fn(),
  isForegroundBusyMock: vi.fn(),
  getKeyboardMock: vi.fn(),
  switchedMock: vi.fn(),
  notifyMock: vi.fn(),
  alertMock: vi.fn(),
  failureMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearActiveInlineMenuMock: vi.fn(),
};

vi.mock("#src/bot/commands/abort-command.js", () => ({
  abortCurrentOperation: mocked.abortCurrentOperationMock,
}));

vi.mock("#src/bot/handlers/prompt-queue-dispatch.js", () => ({
  dispatchNextQueuedPrompt: mocked.dispatchNextQueuedPromptMock,
  __resetPromptQueueDispatchForTests: vi.fn(),
}));

vi.mock("#src/app/services/run-control-service.js", () => ({
  isForegroundBusy: mocked.isForegroundBusyMock,
}));

vi.mock("#src/bot/keyboards/keyboard-manager.js", () => ({
  keyboardManager: {
    getKeyboard: mocked.getKeyboardMock,
  },
}));

vi.mock("#src/bot/callbacks/feedback.js", () => ({
  switched: mocked.switchedMock,
  notify: mocked.notifyMock,
  alert: mocked.alertMock,
  failure: mocked.failureMock,
  cancelMenu: vi.fn(),
  cancelPrompt: vi.fn(),
}));

vi.mock("#src/bot/menus/inline-menu.js", () => ({
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  clearActiveInlineMenu: mocked.clearActiveInlineMenuMock,
  replyWithInlineMenu: vi.fn(),
  appendInlineMenuCancelButton: vi.fn(),
  INLINE_MENU_CANCEL_PREFIX: "inline:cancel:",
  LEGACY_CONTEXT_CANCEL_CALLBACK: "compact:cancel",
  isInlineMenuKind: vi.fn(() => false),
}));

vi.mock("#src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { handleQueueCallback } = await loadSut<
  typeof import("#src/bot/callbacks/queue-callback-handler.js")
>("#src/bot/callbacks/queue-callback-handler.ts", import.meta.url);

function createContext(data: string): Context {
  return {
    callbackQuery: { data },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/callbacks/queue-callback-handler", () => {
  beforeEach(() => {
    promptQueue.__resetForTests();
    for (const mock of Object.values(mocked)) {
      mock.mockReset();
    }
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
    mocked.getKeyboardMock.mockReturnValue({});
    mocked.isForegroundBusyMock.mockReturnValue(false);
  });

  it("ignores callbacks from other routes", async () => {
    const ctx = createContext("agent:plan");

    expect(await handleQueueCallback(ctx)).toBe(false);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("ignores an unknown queue action", async () => {
    const ctx = createContext("queue:bogus:queued-1");

    expect(await handleQueueCallback(ctx)).toBe(false);
  });

  it("does nothing when the menu is no longer active", async () => {
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(false);
    promptQueue.add(createIncomingPrompt("first"));
    const ctx = createContext("queue:delete:queued-1");

    expect(await handleQueueCallback(ctx)).toBe(true);
    expect(promptQueue.size()).toBe(1);
    expect(mocked.switchedMock).not.toHaveBeenCalled();
  });

  it("stops the running task keeping the queue", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);
    promptQueue.add(createIncomingPrompt("first"));
    const ctx = createContext("queue:stop:queued-1");

    expect(await handleQueueCallback(ctx)).toBe(true);
    expect(mocked.abortCurrentOperationMock).toHaveBeenCalledWith(ctx, {
      notifyUser: false,
      keepQueue: true,
    });
    expect(mocked.dispatchNextQueuedPromptMock).toHaveBeenCalled();
    expect(promptQueue.size()).toBe(1);
    expect(mocked.switchedMock).toHaveBeenCalledWith(ctx, t("queue.action.stopped"), {});
  });

  it("reports when there is nothing to stop", async () => {
    const ctx = createContext("queue:stop:queued-1");

    expect(await handleQueueCallback(ctx)).toBe(true);
    expect(mocked.abortCurrentOperationMock).not.toHaveBeenCalled();
    expect(mocked.notifyMock).toHaveBeenCalledWith(ctx, "queue.action.no_active_run");
    expect(mocked.switchedMock).not.toHaveBeenCalled();
  });

  it("sends a queued message now by promoting it to the front", async () => {
    promptQueue.add(createIncomingPrompt("first"));
    const second = promptQueue.add(createIncomingPrompt("second"));
    promptQueue.add(createIncomingPrompt("third"));
    const ctx = createContext(`queue:send:${second!.id}`);

    expect(await handleQueueCallback(ctx)).toBe(true);
    expect(promptQueue.list().map((item) => item.text)).toEqual(["second", "first", "third"]);
    expect(mocked.dispatchNextQueuedPromptMock).toHaveBeenCalled();
    expect(mocked.switchedMock).toHaveBeenCalledWith(
      ctx,
      t("queue.action.sending", { text: "second" }),
      {},
    );
  });

  it("interrupts the running task before sending now", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);
    const first = promptQueue.add(createIncomingPrompt("first"));
    const ctx = createContext(`queue:send:${first!.id}`);

    await handleQueueCallback(ctx);

    expect(mocked.abortCurrentOperationMock).toHaveBeenCalledWith(ctx, {
      notifyUser: false,
      keepQueue: true,
    });
  });

  it("deletes a queued message", async () => {
    promptQueue.add(createIncomingPrompt("first"));
    const second = promptQueue.add(createIncomingPrompt("second"));
    const ctx = createContext(`queue:delete:${second!.id}`);

    expect(await handleQueueCallback(ctx)).toBe(true);
    expect(promptQueue.list().map((item) => item.text)).toEqual(["first"]);
    expect(mocked.switchedMock).toHaveBeenCalledWith(ctx, t("queue.removed"), {});
  });

  it("alerts when the message is gone", async () => {
    const ctx = createContext("queue:delete:queued-404");

    expect(await handleQueueCallback(ctx)).toBe(true);
    expect(mocked.alertMock).toHaveBeenCalledWith(ctx, "queue.not_found");
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });
});
