import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";

const mocked = vi.hoisted(() => ({
  getProjectsMock: vi.fn(),
  switchToProjectMock: vi.fn(),
  ensureEventSubscriptionMock: vi.fn(),
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

function createContext(): Context {
  return {
    chat: { id: 42 },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as Context;
}

describe("bot/handlers/swap-project", () => {
  beforeEach(() => {
    mocked.getProjectsMock.mockReset().mockResolvedValue([toolsProject, primigenumProject]);
    mocked.switchToProjectMock.mockReset().mockResolvedValue({ keyboard: [[{ text: "mock" }]] });
    mocked.ensureEventSubscriptionMock.mockReset();
    settingsStoreMock.getCurrentProject.mockReset().mockReturnValue(toolsProject);
    settingsStoreMock.getSwapProject.mockReset().mockReturnValue(undefined);
  });

  it("switches to the stored swap project when it still exists", async () => {
    settingsStoreMock.getSwapProject.mockReturnValue(primigenumProject.worktree);

    const ctx = createContext();
    await handleSwapProjectButton(ctx, {
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

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

  it("falls back to the folder name when the target project has no name", async () => {
    mocked.getProjectsMock.mockResolvedValue([
      toolsProject,
      { id: "primigenum", worktree: "/home/user/primigenum", name: "" },
    ]);

    const ctx = createContext();
    await handleSwapProjectButton(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      t("projects.selected", { project: "primigenum" }),
      expect.anything(),
    );
  });

  it("falls back to the most recent other project when the stored target is gone", async () => {
    settingsStoreMock.getSwapProject.mockReturnValue("/home/user/deleted");

    const ctx = createContext();
    await handleSwapProjectButton(ctx);

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
    await handleSwapProjectButton(ctx);

    expect(mocked.switchToProjectMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("projects.swap_unavailable"));
  });

  it("reports a failure reply when the switch throws", async () => {
    mocked.switchToProjectMock.mockRejectedValue(new Error("boom"));

    const ctx = createContext();
    await handleSwapProjectButton(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("projects.select_error"));
  });
});
