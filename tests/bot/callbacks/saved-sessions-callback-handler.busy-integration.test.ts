import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Bot, Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";

// Independent busy-gate coverage with the real guard, the real inline-menu
// bookkeeping, the real attach service and the real settings store. Only the
// OpenCode network call (attachSessionById) is faked.
const mocked = vi.hoisted(() => ({
  attachSessionByIdMock: vi.fn(),
}));

vi.mock("#src/app/services/project-session-service.js", () => ({
  attachSessionById: mocked.attachSessionByIdMock,
}));

vi.mock("#src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { handleSavedSessionsCallback } = await loadSut<
  typeof import("#src/bot/callbacks/saved-sessions-callback-handler.js")
>("#src/bot/callbacks/saved-sessions-callback-handler.ts", import.meta.url);
const { interactionGuardMiddleware } = await loadSut<
  typeof import("#src/bot/middleware/interaction-guard.js")
>("#src/bot/middleware/interaction-guard.ts", import.meta.url);
const { showSavedSessionsMenu } = await loadSut<
  typeof import("#src/bot/menus/saved-sessions-menu.js")
>("#src/bot/menus/saved-sessions-menu.ts", import.meta.url);
const { interactionManager } = await loadSut<typeof import("#src/app/managers/interaction-manager.js")>(
  "#src/app/managers/interaction-manager.ts",
  import.meta.url,
);
const { attachManager } = await loadSut<typeof import("#src/app/managers/attach-manager.js")>(
  "#src/app/managers/attach-manager.ts",
  import.meta.url,
);
const { foregroundSessionState } = await loadSut<
  typeof import("#src/app/managers/foreground-session-state-manager.js")
>("#src/app/managers/foreground-session-state-manager.ts", import.meta.url);
const settingsStore = await loadSut<typeof import("#src/app/stores/settings-store.js")>(
  "#src/app/stores/settings-store.ts",
  import.meta.url,
);

const WORKTREE = "/workspace/project-a";
const MENU_MESSAGE_ID = 777;
const bot = { api: {} } as unknown as Bot<Context>;
const deps = { bot, ensureEventSubscription: vi.fn() };

function createTextContext(text: string): Context {
  return {
    message: { text, message_id: MENU_MESSAGE_ID },
    chat: { id: 42 },
    reply: vi.fn().mockResolvedValue({ message_id: MENU_MESSAGE_ID }),
  } as unknown as Context;
}

function createCallbackContext(data: string): Context {
  return {
    callbackQuery: { data, message: { message_id: MENU_MESSAGE_ID } },
    chat: { id: 42 },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: MENU_MESSAGE_ID }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function openSavedMenu(): void {
  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: { menuKind: "saved", messageId: MENU_MESSAGE_ID },
  });
}

describe("saved-sessions menu while busy (real guard, real attach service)", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    attachManager.__resetForTests();
    foregroundSessionState.__resetForTests();
    settingsStore.clearSession();
    settingsStore.clearProject();
    for (const entry of settingsStore.getSavedSessions()) {
      settingsStore.removeSavedSession(entry.id);
    }
    mocked.attachSessionByIdMock.mockReset();
    settingsStore.setCurrentProject({ id: "project-a", name: "project-a", worktree: WORKTREE });
  });

  it("lets the saved-sessions button through the guard and registers the saved menu kind", async () => {
    foregroundSessionState.markBusy("ses-old", WORKTREE);
    const ctx = createTextContext("⭐ Sesiones");
    const next = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next as never);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();

    // What the message router does with the press: the menu registers the
    // inline interaction the busy callback gate keys on.
    const menuCtx = createTextContext("⭐ Sesiones");
    expect(await showSavedSessionsMenu(menuCtx)).toBe(true);

    expect(menuCtx.reply).toHaveBeenCalledTimes(1);
    expect(interactionManager.getSnapshot()?.metadata.menuKind).toBe("saved");
  });

  it("releases the busy run of the attached session before attaching the opened one", async () => {
    attachManager.attach("ses-old", WORKTREE);
    foregroundSessionState.markBusy("ses-old", WORKTREE);
    settingsStore.saveSession({ id: "ses-target", title: "Target", directory: WORKTREE });
    openSavedMenu();

    let attachedWhenOpening: unknown = "attach never ran";
    mocked.attachSessionByIdMock.mockImplementation(async () => {
      attachedWhenOpening = attachManager.getSnapshot();
      return "Target";
    });

    const ctx = createCallbackContext("saved:open:ses-target");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    // The real detachAttachedSession ran first: nothing was attached by the
    // time the attach started, so the old run cannot block the new session.
    expect(mocked.attachSessionByIdMock).toHaveBeenCalledTimes(1);
    expect(attachedWhenOpening).toBeNull();
    expect(foregroundSessionState.isBusy()).toBe(false);
  });

  it("leaves the attached session alone when no run is active", async () => {
    attachManager.attach("ses-current", WORKTREE);
    settingsStore.saveSession({ id: "ses-target", title: "Target", directory: WORKTREE });
    openSavedMenu();
    mocked.attachSessionByIdMock.mockResolvedValue("Target");

    const ctx = createCallbackContext("saved:open:ses-target");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(mocked.attachSessionByIdMock).toHaveBeenCalledTimes(1);
    expect(attachManager.getSnapshot()?.sessionId).toBe("ses-current");
  });

  it("bookmarks and unbookmarks the running session in the real settings store", async () => {
    foregroundSessionState.markBusy("ses-current", WORKTREE);
    settingsStore.setCurrentSession({ id: "ses-current", title: "Current", directory: WORKTREE });
    openSavedMenu();

    const saveCtx = createCallbackContext("saved:save");
    expect(await handleSavedSessionsCallback(saveCtx, deps)).toBe(true);
    expect(settingsStore.getSavedSessions(WORKTREE).map((entry) => entry.id)).toEqual([
      "ses-current",
    ]);

    // The menu was re-rendered in place, so the next press on the same message
    // must still be accepted (message id unchanged by editMessageText).
    const unsaveCtx = createCallbackContext("saved:unsave");
    expect(await handleSavedSessionsCallback(unsaveCtx, deps)).toBe(true);
    expect(settingsStore.getSavedSessions(WORKTREE)).toEqual([]);
  });

  it("drops a saved entry and answers with the busy-free toast while busy", async () => {
    foregroundSessionState.markBusy("ses-current", WORKTREE);
    settingsStore.saveSession({ id: "ses-one", title: "One", directory: WORKTREE });
    openSavedMenu();

    const ctx = createCallbackContext("saved:delete:ses-one");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(settingsStore.getSavedSessions(WORKTREE)).toEqual([]);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
