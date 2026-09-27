import { beforeEach, describe, expect, it, vi } from "#vitest";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";
import { loadSut } from "#helpers/sut-loader.js";

const menuState = vi.hoisted(() => ({ agents: [] as string[] }));

const mocked = {
  getAvailableAgentsMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  selectAgentForCurrentProjectMock: vi.fn(),
  applyAgentConfiguredSettingsMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearActiveInlineMenuMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateAgentMock: vi.fn(),
  keyboardUpdateModelMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardGetStateMock: vi.fn(),
  pinnedRefreshContextLimitMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(),
  pinnedGetContextLimitMock: vi.fn(),
  pinnedRefreshMock: vi.fn(),
  createMainKeyboardMock: vi.fn(),
  switchedMock: vi.fn(),
  showVariantMenuAfterModelChangeMock: vi.fn(),
  replyWithInlineMenuMock: vi.fn(),
};

vi.mock("#src/app/services/agent-selection-service.ts", () => ({
  fetchCurrentAgent: vi.fn(),
  getAvailableAgents: mocked.getAvailableAgentsMock,
  selectAgentForCurrentProject: mocked.selectAgentForCurrentProjectMock,
  applyAgentConfiguredSettings: mocked.applyAgentConfiguredSettingsMock,
  getStoredAgent: vi.fn(),
  resolveProjectAgent: vi.fn(),
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  getStoredModel: mocked.getStoredModelMock,
  selectModel: vi.fn(),
  reconcileStoredModelSelection: vi.fn(),
  getFavoriteModels: vi.fn(() => []),
  getModelSelectionLists: vi.fn(),
  __resetModelCatalogCacheForTests: vi.fn(),
  getProviders: vi.fn(async () => []),
  getProviderModels: vi.fn(async () => []),
  searchModels: vi.fn(async () => []),
  fetchCurrentModel: vi.fn(),
}));

vi.mock("#src/bot/menus/inline-menu.ts", () => ({
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  clearActiveInlineMenu: mocked.clearActiveInlineMenuMock,
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
  appendInlineMenuCancelButton: vi.fn(),
  INLINE_MENU_CANCEL_PREFIX: "inline:cancel:",
  LEGACY_CONTEXT_CANCEL_CALLBACK: "compact:cancel",
  isInlineMenuKind: vi.fn(() => false),
}));

vi.mock("#src/bot/keyboards/keyboard-manager.ts", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateAgent: mocked.keyboardUpdateAgentMock,
    updateModel: mocked.keyboardUpdateModelMock,
    updateContext: mocked.keyboardUpdateContextMock,
    getState: mocked.keyboardGetStateMock,
  },
}));

vi.mock("#src/bot/keyboards/main-reply-keyboard.ts", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));

vi.mock("#src/bot/pinned/pinned-message-manager.ts", () => ({
  pinnedMessageManager: {
    refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
    getContextLimit: mocked.pinnedGetContextLimitMock,
    refresh: mocked.pinnedRefreshMock,
  },
}));

vi.mock("#src/bot/callbacks/feedback.ts", () => ({
  switched: mocked.switchedMock,
  failure: vi.fn(),
}));

vi.mock("#src/bot/menus/variant-selection-menu.ts", () => ({
  buildVariantSelectionMenu: vi.fn(),
  showVariantSelectionMenu: vi.fn(),
  showVariantSelectionMenuAfterModelChange: mocked.showVariantMenuAfterModelChangeMock,
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocked.loggerWarnMock,
    error: vi.fn(),
  },
}));

vi.mock("#src/app/stores/settings-store.ts", () => {
  const mock = createSettingsStoreMock();
  mock.getMenuAgents = vi.fn(() => menuState.agents);
  return mock;
});

const { buildAgentSelectionMenu, showAgentSelectionMenu } = await loadSut<
  typeof import("#src/bot/menus/agent-selection-menu.js")
>("#src/bot/menus/agent-selection-menu.ts", import.meta.url);
const { handleAgentSelect } = await loadSut<
  typeof import("#src/bot/callbacks/agent-selection-callback-handler.js")
>("#src/bot/callbacks/agent-selection-callback-handler.ts", import.meta.url);
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);
const { getAgentDisplayName } = await loadSut<typeof import("#src/app/types/agent.js")>(
  "#src/app/types/agent.ts",
  import.meta.url,
);

function mockContext(overrides: Record<string, unknown> = {}) {
  return {
    callbackQuery: undefined,
    message: undefined,
    chat: { id: 123 },
    api: {},
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 999 }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as import("grammy").Context;
}

describe("bot agent selection", () => {
  beforeEach(() => {
    mocked.getAvailableAgentsMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.selectAgentForCurrentProjectMock.mockReset();
    mocked.applyAgentConfiguredSettingsMock.mockReset();
    mocked.getStoredModelMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.clearActiveInlineMenuMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateAgentMock.mockReset();
    mocked.keyboardUpdateModelMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.keyboardGetStateMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReset();
    mocked.pinnedGetContextLimitMock.mockReset();
    mocked.pinnedRefreshMock.mockReset();
    mocked.createMainKeyboardMock.mockReset();
    mocked.switchedMock.mockReset();
    mocked.showVariantMenuAfterModelChangeMock.mockReset();
    mocked.replyWithInlineMenuMock.mockReset();

    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
    mocked.applyAgentConfiguredSettingsMock.mockResolvedValue(false);
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "opencode-go",
      modelID: "kimi",
      variant: "high",
    });
    mocked.pinnedGetContextLimitMock.mockReturnValue(0);
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.keyboardGetStateMock.mockReturnValue({ variantName: "💡 High" });
    mocked.createMainKeyboardMock.mockReturnValue({});
    mocked.switchedMock.mockResolvedValue(undefined);
    mocked.pinnedRefreshMock.mockResolvedValue(undefined);
    mocked.pinnedRefreshContextLimitMock.mockResolvedValue(undefined);
    menuState.agents = [];
  });

  it("shows only the allowlisted agents in allowlist order", async () => {
    mocked.getAvailableAgentsMock.mockResolvedValueOnce([
      { name: "build", mode: "primary" },
      { name: "executor", mode: "all" },
      { name: "boss", mode: "primary" },
    ]);
    menuState.agents = ["boss", "executor"];

    const keyboard = await buildAgentSelectionMenu();

    expect(keyboard.inline_keyboard.map((row) => row[0]?.callback_data)).toEqual([
      "agent:boss",
      "agent:executor",
    ]);
  });

  it("shows every available agent when no allowlist is configured", async () => {
    mocked.getAvailableAgentsMock.mockResolvedValueOnce([
      { name: "build", mode: "primary" },
      { name: "boss", mode: "primary" },
    ]);

    const keyboard = await buildAgentSelectionMenu();

    expect(keyboard.inline_keyboard.map((row) => row[0]?.callback_data)).toEqual([
      "agent:build",
      "agent:boss",
    ]);
  });

  it("ignores allowlisted names that are not available and warns", async () => {
    mocked.getAvailableAgentsMock.mockResolvedValueOnce([{ name: "boss", mode: "primary" }]);
    menuState.agents = ["boss", "ghost"];

    const keyboard = await buildAgentSelectionMenu();

    expect(keyboard.inline_keyboard.map((row) => row[0]?.callback_data)).toEqual(["agent:boss"]);
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('"ghost"'));
  });

  it("replies with the empty menu message when the allowlist matches no available agent", async () => {
    mocked.getAvailableAgentsMock.mockResolvedValueOnce([{ name: "boss", mode: "primary" }]);
    menuState.agents = ["ghost"];

    const ctx = mockContext();
    await showAgentSelectionMenu(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("agent.menu.empty"));
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });

  it("highlights the selected agent without uppercasing its name", async () => {
    mocked.getAvailableAgentsMock.mockResolvedValueOnce([
      { name: "reviewer", mode: "primary" },
      { name: "build", mode: "primary" },
    ]);

    const keyboard = await buildAgentSelectionMenu("reviewer");

    expect(keyboard.inline_keyboard[0]?.[0]?.text).toBe("✅ 🤖 Reviewer");
    expect(keyboard.inline_keyboard[1]?.[0]?.text).toBe("🛠️ Build");
  });

  it("applies configured settings, confirms with the existing line, and does not open the variant menu", async () => {
    mocked.applyAgentConfiguredSettingsMock.mockResolvedValueOnce(true);
    const keyboard = { kind: "main" };
    mocked.createMainKeyboardMock.mockReturnValue(keyboard);

    const ctx = mockContext({
      callbackQuery: { data: "agent:plan" },
    });

    const result = await handleAgentSelect(ctx);

    expect(result).toBe(true);
    expect(mocked.selectAgentForCurrentProjectMock).toHaveBeenCalledWith("plan");
    expect(mocked.applyAgentConfiguredSettingsMock).toHaveBeenCalledWith("plan");
    expect(mocked.createMainKeyboardMock).toHaveBeenCalledWith(
      "plan",
      { providerID: "opencode-go", modelID: "kimi", variant: "high" },
      undefined,
      "💡 High",
    );
    expect(mocked.switchedMock).toHaveBeenCalledWith(
      ctx,
      t("agent.changed_message", { name: getAgentDisplayName("plan") }),
      keyboard,
    );
    expect(mocked.pinnedRefreshMock).toHaveBeenCalledOnce();
    expect(mocked.showVariantMenuAfterModelChangeMock).not.toHaveBeenCalled();
  });

  it("refreshes the pinned dashboard when only a variant was applied", async () => {
    mocked.applyAgentConfiguredSettingsMock.mockResolvedValueOnce(true);

    const ctx = mockContext({
      callbackQuery: { data: "agent:plan" },
    });

    await handleAgentSelect(ctx);

    expect(mocked.pinnedRefreshMock).toHaveBeenCalledOnce();
    expect(mocked.showVariantMenuAfterModelChangeMock).not.toHaveBeenCalled();
  });

  it("does not refresh the pinned dashboard when neither model nor variant was applied", async () => {
    const ctx = mockContext({
      callbackQuery: { data: "agent:plan" },
    });

    await handleAgentSelect(ctx);

    expect(mocked.pinnedRefreshMock).not.toHaveBeenCalled();
    expect(mocked.showVariantMenuAfterModelChangeMock).not.toHaveBeenCalled();
  });
});
