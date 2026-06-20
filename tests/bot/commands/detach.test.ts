import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "../../helpers/sut-loader.js";

const mocked = {
  currentProject: { id: "project-1", worktree: "D:/repo" } as { id: string; worktree: string } | null,
  currentSession: null as { id: string; title: string; directory: string } | null,
  clearSessionMock: vi.fn(),
  detachAttachedSessionMock: vi.fn(),
  clearAllInteractionStateMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(() => true),
  pinnedClearMock: vi.fn().mockResolvedValue(undefined),
  pinnedRefreshContextLimitMock: vi.fn().mockResolvedValue(undefined),
  pinnedGetContextLimitMock: vi.fn(() => 200000),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardGetKeyboardMock: vi.fn(() => ({ keyboard: true })),
  foregroundMarkIdleMock: vi.fn(),
  assistantClearRunMock: vi.fn(),
  clearPromptResponseModeMock: vi.fn(),
};

vi.mock("../../../src/app/stores/settings-store.ts", () => {
  const fns = [
    "getCurrentProject",
    "setCurrentProject",
    "clearProject",
    "getCurrentSession",
    "setCurrentSession",
    "clearSession",
    "getTtsMode",
    "setTtsMode",
    "getCurrentAgent",
    "setCurrentAgent",
    "clearCurrentAgent",
    "getCurrentModel",
    "setCurrentModel",
    "clearCurrentModel",
    "getPinnedMessageId",
    "setPinnedMessageId",
    "clearPinnedMessageId",
    "getSessionDirectoryCache",
    "setSessionDirectoryCache",
    "clearSessionDirectoryCache",
    "getScheduledTasks",
    "setScheduledTasks",
    "getScheduledTaskSessionIgnores",
    "setScheduledTaskSessionIgnores",
    "__resetSettingsForTests",
    "loadSettings",
  ];
  const obj: Record<string, unknown> = {};
  for (const name of fns) obj[name] = vi.fn();
  obj.getCurrentProject = vi.fn(() => mocked.currentProject);
  obj.clearSession = mocked.clearSessionMock;
  return obj;
});

vi.mock("../../../src/app/services/attach-service.ts", () => ({
  detachAttachedSession: mocked.detachAttachedSessionMock,
}));

vi.mock("../../../src/app/managers/interaction-manager.ts", () => ({
  interactionManager: { clear: vi.fn() },
  clearAllInteractionState: mocked.clearAllInteractionStateMock,
  questionManager: { clear: vi.fn(), startQuestions: vi.fn(), isActive: vi.fn(() => false) },
  permissionManager: { clear: vi.fn(), startPermission: vi.fn(), isActive: vi.fn(() => false) },
  renameManager: { clear: vi.fn(), startWaiting: vi.fn(), isWaitingForName: vi.fn(() => false) },
  getSnapshot: vi.fn(),
}));

vi.mock("../../../src/bot/pinned/pinned-message-manager.ts", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    clear: mocked.pinnedClearMock,
    refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
    getContextLimit: mocked.pinnedGetContextLimitMock,
  },
}));

vi.mock("../../../src/bot/keyboards/keyboard-manager.ts", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateContext: mocked.keyboardUpdateContextMock,
    getKeyboard: mocked.keyboardGetKeyboardMock,
  },
}));

vi.mock("../../../src/app/managers/foreground-session-state-manager.ts", () => ({
  foregroundSessionState: {
    markIdle: mocked.foregroundMarkIdleMock,
    isBusy: vi.fn(() => false),
    markBusy: vi.fn(),
    __resetForTests: vi.fn(),
  },
}));

vi.mock("../../../src/app/managers/assistant-run-state-manager.ts", () => ({
  assistantRunState: {
    clearRun: mocked.assistantClearRunMock,
  },
}));

vi.mock("../../../src/bot/handlers/prompt.ts", () => ({
  clearPromptResponseMode: mocked.clearPromptResponseModeMock,
}));

const sut = loadSut<typeof import("../../../src/bot/commands/detach-command.js")>(
  "../../../src/bot/commands/detach-command.ts",
  import.meta.url,
);

import { t } from "../../../src/i18n/index.js";

function createContext(): Context {
  return {
    chat: { id: 777 },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as Context;
}

describe("bot/commands/detach", () => {
  beforeEach(() => {
    mocked.currentProject = { id: "project-1", worktree: "D:/repo" };
    mocked.currentSession = null;
    mocked.clearSessionMock.mockReset();
    mocked.detachAttachedSessionMock.mockReset();
    mocked.clearAllInteractionStateMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReturnValue(true);
    mocked.pinnedClearMock.mockReset();
    mocked.pinnedClearMock.mockResolvedValue(undefined);
    mocked.pinnedRefreshContextLimitMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockResolvedValue(undefined);
    mocked.pinnedGetContextLimitMock.mockReset();
    mocked.pinnedGetContextLimitMock.mockReturnValue(200000);
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.keyboardGetKeyboardMock.mockReset();
    mocked.keyboardGetKeyboardMock.mockReturnValue({ keyboard: true });
    mocked.foregroundMarkIdleMock.mockReset();
    mocked.assistantClearRunMock.mockReset();
    mocked.clearPromptResponseModeMock.mockReset();
  });

  it("detaches the active session and clears UI state", async () => {
    mocked.currentSession = { id: "session-1", title: "Session", directory: "D:/repo" };

    await sut.detachCommand(createContext() as never);

    expect(mocked.detachAttachedSessionMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearSessionMock).toHaveBeenCalledWith();
    expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("session-1");
    expect(mocked.assistantClearRunMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("detach");
    expect(mocked.pinnedClearMock).toHaveBeenCalled();
    expect(mocked.keyboardUpdateContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: null }),
    );
  });

  it("replies with a not-attached message when no session is active", async () => {
    const ctx = createContext();
    await sut.detachCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("detach.not_attached"));
    expect(mocked.detachAttachedSessionMock).not.toHaveBeenCalled();
  });
});
