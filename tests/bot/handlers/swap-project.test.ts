import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Bot, Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";
import { promptQueue } from "#src/app/managers/prompt-queue-manager.js";
import { createIncomingPrompt } from "#src/app/types/prompt.js";

const mocked = vi.hoisted(() => ({
  getProjectsMock: vi.fn(),
  switchToProjectMock: vi.fn(),
  attachLatestProjectSessionMock: vi.fn(),
  ensureEventSubscriptionMock: vi.fn(),
  resolveProjectAgentMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  updateAgentMock: vi.fn(),
  updateModelMock: vi.fn(),
  getKeyboardMock: vi.fn(),
  presentation: { kind: "switch-presentation" },
}));

const settingsStoreMock = createSettingsStoreMock();
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);
vi.mock("#src/app/services/project-service.ts", () => ({
  getProjects: mocked.getProjectsMock,
}));
vi.mock("#src/app/services/project-switch-service.ts", () => ({
  switchToProject: mocked.switchToProjectMock,
}));
vi.mock("#src/app/services/project-session-service.ts", () => ({
  attachLatestProjectSession: mocked.attachLatestProjectSessionMock,
}));
// Partial mocks: keep the real module surface so other modules in the handler
// graph resolve their imports, and override only what this test drives.
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
vi.mock("#src/bot/services/project-switch-presentation.ts", () => ({
  createProjectSwitchPresentation: vi.fn(() => mocked.presentation),
}));
vi.mock("#src/utils/logger.ts", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { handleSwapProjectButton } = await loadSut<
  typeof import("#src/bot/handlers/swap-project-handler.js")
>("#src/bot/handlers/swap-project-handler.ts", import.meta.url);

const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

const toolsProject = { id: "tools", worktree: "/home/user/tools", name: "tools" };
const primigenumProject = {
  id: "primigenum",
  worktree: "/home/user/primigenum",
  name: "primigenum",
};

const bot = { api: {} } as unknown as Bot<Context>;

function createContext(): Context {
  return {
    chat: { id: 42 },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as Context;
}

function swapDeps() {
  return { bot, ensureEventSubscription: mocked.ensureEventSubscriptionMock };
}

describe("bot/handlers/swap-project", () => {
  beforeEach(() => {
    promptQueue.__resetForTests();
    mocked.getProjectsMock.mockReset().mockResolvedValue([toolsProject, primigenumProject]);
    mocked.switchToProjectMock.mockReset().mockResolvedValue({ keyboard: [[{ text: "mock" }]] });
    mocked.attachLatestProjectSessionMock.mockReset().mockResolvedValue(null);
    mocked.ensureEventSubscriptionMock.mockReset();
    mocked.resolveProjectAgentMock.mockReset().mockResolvedValue("build");
    mocked.getStoredModelMock.mockReset().mockReturnValue({ providerID: "p", modelID: "m" });
    mocked.updateAgentMock.mockReset();
    mocked.updateModelMock.mockReset();
    mocked.getKeyboardMock.mockReset().mockReturnValue(undefined);
    settingsStoreMock.getCurrentProject.mockReset().mockReturnValue(toolsProject);
    settingsStoreMock.getSwapProject.mockReset().mockReturnValue(undefined);
  });

  it("switches to the stored swap project when it still exists", async () => {
    settingsStoreMock.getSwapProject.mockReturnValue(primigenumProject.worktree);

    const ctx = createContext();
    await handleSwapProjectButton(ctx, swapDeps());

    expect(mocked.switchToProjectMock).toHaveBeenCalledWith(
      ctx,
      primigenumProject,
      "project_swapped",
      {
        ensureEventSubscription: mocked.ensureEventSubscriptionMock,
        presentation: mocked.presentation,
      },
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      t("projects.selected", { project: "primigenum" }),
      expect.objectContaining({ reply_markup: { keyboard: [[{ text: "mock" }]] } }),
    );
  });

  it("attaches the target project's most recent session after the switch", async () => {
    mocked.attachLatestProjectSessionMock.mockResolvedValue("Latest work");
    mocked.getKeyboardMock.mockReturnValue({ keyboard: [[{ text: "refreshed" }]] });

    const ctx = createContext();
    await handleSwapProjectButton(ctx, swapDeps());

    expect(mocked.attachLatestProjectSessionMock).toHaveBeenCalledWith({
      bot,
      chatId: 42,
      directory: primigenumProject.worktree,
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });
    expect(mocked.updateAgentMock).toHaveBeenCalledWith("build");
    expect(mocked.updateModelMock).toHaveBeenCalledWith({ providerID: "p", modelID: "m" });
    expect(ctx.reply).toHaveBeenCalledWith(
      t("projects.selected", { project: "primigenum" }),
      expect.objectContaining({ reply_markup: { keyboard: [[{ text: "refreshed" }]] } }),
    );
    expect(ctx.reply).toHaveBeenCalledWith(t("sessions.selected", { title: "Latest work" }));
  });

  it("tells the user when the target project has no sessions", async () => {
    const ctx = createContext();
    await handleSwapProjectButton(ctx, swapDeps());

    expect(ctx.reply).toHaveBeenCalledWith(
      t("sessions.none_in_project", { project: "primigenum" }),
    );
    expect(mocked.updateAgentMock).not.toHaveBeenCalled();
  });

  it("still confirms the switch when landing on a session fails", async () => {
    mocked.attachLatestProjectSessionMock.mockRejectedValue(new Error("boom"));

    const ctx = createContext();
    await handleSwapProjectButton(ctx, swapDeps());

    expect(ctx.reply).toHaveBeenCalledWith(
      t("projects.selected", { project: "primigenum" }),
      expect.anything(),
    );
    expect(ctx.reply).not.toHaveBeenCalledWith(t("projects.select_error"));
  });

  it("falls back to the folder name when the target project has no name", async () => {
    mocked.getProjectsMock.mockResolvedValue([
      toolsProject,
      { id: "primigenum", worktree: "/home/user/primigenum", name: "" },
    ]);

    const ctx = createContext();
    await handleSwapProjectButton(ctx, swapDeps());

    expect(ctx.reply).toHaveBeenCalledWith(
      t("projects.selected", { project: "primigenum" }),
      expect.anything(),
    );
  });

  it("falls back to the most recent other project when the stored target is gone", async () => {
    settingsStoreMock.getSwapProject.mockReturnValue("/home/user/deleted");

    const ctx = createContext();
    await handleSwapProjectButton(ctx, swapDeps());

    expect(mocked.switchToProjectMock).toHaveBeenCalledWith(
      ctx,
      primigenumProject,
      "project_swapped",
      expect.objectContaining({ presentation: mocked.presentation }),
    );
  });

  it("replies that there is no other project when only one is known", async () => {
    mocked.getProjectsMock.mockResolvedValue([toolsProject]);

    const ctx = createContext();
    await handleSwapProjectButton(ctx, swapDeps());

    expect(mocked.switchToProjectMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("projects.swap_unavailable"));
  });

  it("warns when the switch discards queued prompts", async () => {
    // The real switch clears the queue (clearSession); the mocked one mimics that
    // so the handler can tell the user how many prompts were dropped.
    promptQueue.add(createIncomingPrompt("queued while busy"));
    mocked.switchToProjectMock.mockImplementation(async () => {
      promptQueue.clear("session_cleared");
      return { keyboard: [[{ text: "mock" }]] };
    });

    const ctx = createContext();
    await handleSwapProjectButton(ctx, swapDeps());

    expect(ctx.reply).toHaveBeenCalledWith(t("queue.discarded", { count: "1" }));
  });

  it("reports a failure reply when the switch throws", async () => {
    mocked.switchToProjectMock.mockRejectedValue(new Error("boom"));

    const ctx = createContext();
    await handleSwapProjectButton(ctx, swapDeps());

    expect(ctx.reply).toHaveBeenCalledWith(t("projects.select_error"));
  });
});
