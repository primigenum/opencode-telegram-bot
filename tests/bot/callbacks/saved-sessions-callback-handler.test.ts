import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Bot, Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";

const mocked = vi.hoisted(() => ({
  isForegroundBusyMock: vi.fn(),
  attachSessionByIdMock: vi.fn(),
  detachAttachedSessionMock: vi.fn(),
  resolveProjectAgentMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  updateAgentMock: vi.fn(),
  updateModelMock: vi.fn(),
  getKeyboardMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearActiveInlineMenuMock: vi.fn(),
  appendInlineMenuCancelButtonMock: vi.fn(),
  alertMock: vi.fn(),
  notifyMock: vi.fn(),
  failureMock: vi.fn(),
}));

const settingsStoreMock = createSettingsStoreMock();
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);

vi.mock("#src/app/services/run-control-service.js", () => ({
  isForegroundBusy: mocked.isForegroundBusyMock,
}));

vi.mock("#src/app/services/project-session-service.js", () => ({
  attachSessionById: mocked.attachSessionByIdMock,
}));

vi.mock("#src/app/services/attach-service.ts", () => ({
  detachAttachedSession: mocked.detachAttachedSessionMock,
  attachToSession: vi.fn(),
  markAttachedSessionBusy: vi.fn(),
  markAttachedSessionIdle: vi.fn(),
  restoreAttachedCurrentSession: vi.fn(),
  configureAttachPresentation: vi.fn(),
}));

vi.mock("#src/app/services/agent-selection-service.ts", () => ({
  getStoredAgent: vi.fn(() => "build"),
  resolveProjectAgent: mocked.resolveProjectAgentMock,
  getAvailableAgents: vi.fn(async () => []),
  selectAgent: vi.fn(),
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  getStoredModel: mocked.getStoredModelMock,
  reconcileStoredModelSelection: vi.fn(),
  selectModel: vi.fn(),
  fetchCurrentModel: vi.fn(),
  getFavoriteModels: vi.fn(async () => []),
  getProviders: vi.fn(async () => []),
  getProviderModels: vi.fn(async () => []),
  searchModels: vi.fn(async () => []),
  getModelSelectionLists: vi.fn(async () => ({ favorites: [], recent: [], providers: [] })),
}));

vi.mock("#src/bot/keyboards/keyboard-manager.js", () => ({
  keyboardManager: {
    updateAgent: mocked.updateAgentMock,
    updateModel: mocked.updateModelMock,
    getKeyboard: mocked.getKeyboardMock,
  },
}));

vi.mock("#src/bot/menus/inline-menu.js", () => ({
  replyWithInlineMenu: vi.fn(),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  clearActiveInlineMenu: mocked.clearActiveInlineMenuMock,
  appendInlineMenuCancelButton: mocked.appendInlineMenuCancelButtonMock,
  isInlineMenuKind: vi.fn(() => false),
  INLINE_MENU_CANCEL_PREFIX: "inline:cancel:",
}));

vi.mock("#src/bot/callbacks/feedback.js", () => ({
  alert: mocked.alertMock,
  notify: mocked.notifyMock,
  failure: mocked.failureMock,
  switched: vi.fn(),
  cancelMenu: vi.fn(),
  cancelPrompt: vi.fn(),
}));

vi.mock("#src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { handleSavedSessionsCallback } = await loadSut<
  typeof import("#src/bot/callbacks/saved-sessions-callback-handler.js")
>("#src/bot/callbacks/saved-sessions-callback-handler.ts", import.meta.url);

const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

const WORKTREE = "/workspace/project-a";
const bot = { api: {} } as unknown as Bot<Context>;
const deps = { bot, ensureEventSubscription: vi.fn() };

function createContext(data: string): Context {
  return {
    callbackQuery: { data },
    chat: { id: 42 },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/callbacks/saved-sessions-callback-handler", () => {
  beforeEach(() => {
    mocked.isForegroundBusyMock.mockReset().mockReturnValue(false);
    mocked.attachSessionByIdMock.mockReset().mockResolvedValue(null);
    mocked.detachAttachedSessionMock.mockReset();
    mocked.resolveProjectAgentMock.mockReset().mockResolvedValue("build");
    mocked.getStoredModelMock.mockReset().mockReturnValue({ providerID: "p", modelID: "m" });
    mocked.updateAgentMock.mockReset();
    mocked.updateModelMock.mockReset();
    mocked.getKeyboardMock.mockReset().mockReturnValue({ keyboard: [] });
    mocked.ensureActiveInlineMenuMock.mockReset().mockResolvedValue(true);
    mocked.clearActiveInlineMenuMock.mockReset();
    mocked.appendInlineMenuCancelButtonMock.mockReset().mockImplementation((keyboard) => keyboard);
    mocked.alertMock.mockReset();
    mocked.notifyMock.mockReset();
    mocked.failureMock.mockReset();

    settingsStoreMock.getCurrentProject.mockReset().mockReturnValue({
      id: "project-a",
      worktree: WORKTREE,
      name: "project-a",
    });
    settingsStoreMock.getCurrentSession.mockReset().mockReturnValue(undefined);
    settingsStoreMock.getSavedSessions.mockReset().mockReturnValue([]);
    settingsStoreMock.isSessionSaved.mockReset().mockReturnValue(false);
    settingsStoreMock.saveSession.mockReset();
    settingsStoreMock.removeSavedSession.mockReset();
  });

  it("ignores callbacks from other routes", async () => {
    const ctx = createContext("queue:delete:queued-1");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(false);
    expect(mocked.ensureActiveInlineMenuMock).not.toHaveBeenCalled();
  });

  it("bookmarks the current session while the session is busy", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);
    const current = { id: "ses-current", title: "Current", directory: WORKTREE };
    settingsStoreMock.getCurrentSession.mockReturnValue(current);
    const ctx = createContext("saved:save");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(settingsStoreMock.saveSession).toHaveBeenCalledWith(current);
    expect(mocked.notifyMock).toHaveBeenCalledWith(ctx, "saved.added", { title: "Current" });
  });

  it("drops an entry from the saved list while the session is busy", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);
    settingsStoreMock.getSavedSessions.mockReturnValue([
      { id: "ses-one", title: "First work", directory: WORKTREE },
    ]);
    const ctx = createContext("saved:delete:ses-one");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(settingsStoreMock.removeSavedSession).toHaveBeenCalledWith("ses-one");
  });

  it("ignores a stale menu", async () => {
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(false);
    const ctx = createContext("saved:save");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);
    expect(settingsStoreMock.saveSession).not.toHaveBeenCalled();
  });

  it("bookmarks the current session and re-renders the menu", async () => {
    const current = { id: "ses-current", title: "Current", directory: WORKTREE };
    settingsStoreMock.getCurrentSession.mockReturnValue(current);
    const ctx = createContext("saved:save");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(settingsStoreMock.saveSession).toHaveBeenCalledWith(current);
    expect(mocked.notifyMock).toHaveBeenCalledWith(ctx, "saved.added", { title: "Current" });
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("unbookmarks the current session", async () => {
    const current = { id: "ses-current", title: "Current", directory: WORKTREE };
    settingsStoreMock.getCurrentSession.mockReturnValue(current);
    settingsStoreMock.isSessionSaved.mockReturnValue(true);
    const ctx = createContext("saved:unsave");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(settingsStoreMock.removeSavedSession).toHaveBeenCalledWith("ses-current");
    expect(mocked.notifyMock).toHaveBeenCalledWith(ctx, "saved.removed", { title: "Current" });
  });

  it("refuses to bookmark without an active session of the project", async () => {
    const ctx = createContext("saved:save");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(mocked.alertMock).toHaveBeenCalledWith(ctx, "saved.no_current_session");
    expect(settingsStoreMock.saveSession).not.toHaveBeenCalled();
  });

  it("drops an entry from the saved list", async () => {
    settingsStoreMock.getSavedSessions.mockReturnValue([
      { id: "ses-one", title: "First work", directory: WORKTREE },
    ]);
    const ctx = createContext("saved:delete:ses-one");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(settingsStoreMock.removeSavedSession).toHaveBeenCalledWith("ses-one");
    expect(mocked.notifyMock).toHaveBeenCalledWith(ctx, "saved.removed", { title: "First work" });
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("opens a saved session and confirms with the refreshed keyboard", async () => {
    mocked.attachSessionByIdMock.mockResolvedValue("First work");
    const ctx = createContext("saved:open:ses-one");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(mocked.attachSessionByIdMock).toHaveBeenCalledWith({
      bot,
      chatId: 42,
      sessionId: "ses-one",
      directory: WORKTREE,
      ensureEventSubscription: deps.ensureEventSubscription,
    });
    expect(mocked.clearActiveInlineMenuMock).toHaveBeenCalledWith("saved_opened");
    expect(ctx.reply).toHaveBeenCalledWith(
      t("sessions.selected", { title: "First work" }),
      { reply_markup: { keyboard: [] } },
    );
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it("detaches the active run before opening another session while busy", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);
    mocked.attachSessionByIdMock.mockResolvedValue("First work");
    const ctx = createContext("saved:open:ses-one");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(mocked.detachAttachedSessionMock).toHaveBeenCalledWith("saved_session_opened");
    expect(mocked.attachSessionByIdMock).toHaveBeenCalled();
    expect(mocked.detachAttachedSessionMock.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.attachSessionByIdMock.mock.invocationCallOrder[0],
    );
  });

  it("does not detach the run when opening a session without a busy run", async () => {
    mocked.attachSessionByIdMock.mockResolvedValue("First work");
    const ctx = createContext("saved:open:ses-one");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(mocked.detachAttachedSessionMock).not.toHaveBeenCalled();
    expect(mocked.attachSessionByIdMock).toHaveBeenCalled();
  });

  it("drops a saved session that no longer exists", async () => {
    const ctx = createContext("saved:open:ses-gone");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(settingsStoreMock.removeSavedSession).toHaveBeenCalledWith("ses-gone");
    expect(mocked.alertMock).toHaveBeenCalledWith(ctx, "saved.not_found");
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("reports a failure when opening a saved session throws", async () => {
    mocked.attachSessionByIdMock.mockRejectedValue(new Error("boom"));
    const ctx = createContext("saved:open:ses-one");

    expect(await handleSavedSessionsCallback(ctx, deps)).toBe(true);

    expect(mocked.failureMock).toHaveBeenCalledWith(ctx, "sessions.select_error");
  });
});
