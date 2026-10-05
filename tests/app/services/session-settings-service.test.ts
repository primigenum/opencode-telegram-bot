import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Session } from "@opencode-ai/sdk/v2";
import { loadSut } from "#helpers/sut-loader.js";

const mocks = vi.hoisted(() => {
  const state = { configVariant: undefined as string | undefined };
  const resolveVariant = vi.fn(
    (_providerID: string, _modelID: string, storedVariant?: string) =>
      storedVariant && storedVariant !== "default"
        ? storedVariant
        : (state.configVariant ?? "default"),
  );
  return {
    selectAgent: vi.fn(),
    selectModel: vi.fn(),
    getStoredModel: vi.fn(),
    state,
    resolveVariant,
  };
});

vi.mock("#src/app/services/agent-selection-service.ts", () => ({
  selectAgent: mocks.selectAgent,
  getAvailableAgents: vi.fn(async () => []),
  resolveProjectAgent: vi.fn(async () => "build"),
  fetchCurrentAgent: vi.fn(async () => "build"),
  applyAgentConfiguredSettings: vi.fn(async () => false),
  getStoredAgent: vi.fn(() => "build"),
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  selectModel: mocks.selectModel,
  getStoredModel: mocks.getStoredModel,
  reconcileStoredModelSelection: vi.fn(),
  getFavoriteModels: vi.fn(() => []),
  getModelSelectionLists: vi.fn(),
  __resetModelCatalogCacheForTests: vi.fn(),
  getProviders: vi.fn(async () => []),
  getProviderModels: vi.fn(async () => []),
  searchModels: vi.fn(async () => []),
  fetchCurrentModel: vi.fn(),
}));

vi.mock("#src/app/services/variant-selection-service.ts", () => ({
  resolveVariant: mocks.resolveVariant,
  // Used by the globally-loaded keyboard/prompt modules during singleton reset.
  formatVariantForButton: vi.fn((variantId: string) => variantId),
  formatVariantForDisplay: vi.fn((variantId: string) => variantId),
  getCurrentVariant: vi.fn(() => "default"),
  getDefaultVariantFromConfig: vi.fn(() => undefined),
  getAvailableVariants: vi.fn(async () => []),
  validateVariantForModel: vi.fn(async () => true),
  setCurrentVariant: vi.fn(),
}));

const { applySessionSettings } = await loadSut<typeof import("#src/app/services/session-settings-service.js")>(
  "#src/app/services/session-settings-service.ts",
  import.meta.url,
);

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    slug: "session-1",
    projectID: "project-1",
    directory: "D:\\Projects\\Repo",
    title: "Session 1",
    version: "1.0.0",
    time: { created: 1, updated: 2 },
    ...overrides,
  } as Session;
}

describe("app/services/session-settings-service", () => {
  beforeEach(() => {
    mocks.selectAgent.mockClear();
    mocks.selectModel.mockClear();
    mocks.state.configVariant = undefined;
    mocks.getStoredModel.mockReset().mockReturnValue({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "max",
    });
  });

  it("adopts the agent and the model a session carries", () => {
    applySessionSettings(
      makeSession({
        agent: "plan",
        model: { providerID: "opencode-go", id: "deepseek-v4-flash", variant: "high" },
      }),
    );

    expect(mocks.selectAgent).toHaveBeenCalledWith("plan");
    expect(mocks.selectModel).toHaveBeenCalledWith({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "high",
    });
  });

  it("changes only the agent when the session carries no model", () => {
    applySessionSettings(makeSession({ agent: "plan" }));

    expect(mocks.selectAgent).toHaveBeenCalledWith("plan");
    expect(mocks.selectModel).not.toHaveBeenCalled();
  });

  it("keeps the effective variant when the session carries the same model without a variant", () => {
    applySessionSettings(
      makeSession({ model: { providerID: "opencode-go", id: "deepseek-v4-flash" } }),
    );

    expect(mocks.selectAgent).not.toHaveBeenCalled();
    expect(mocks.selectModel).toHaveBeenCalledWith({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "max",
    });
  });

  it("adopts an explicit session variant", () => {
    applySessionSettings(
      makeSession({
        model: { providerID: "opencode-go", id: "deepseek-v4-flash", variant: "low" },
      }),
    );

    expect(mocks.selectModel).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "low" }),
    );
  });

  it("resolves the adopted model's configured default when the model changes", () => {
    mocks.state.configVariant = "max";
    mocks.getStoredModel.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-4o",
      variant: "high",
    });

    applySessionSettings(
      makeSession({ model: { providerID: "opencode-go", id: "deepseek-v4.1-flash" } }),
    );

    expect(mocks.selectModel).toHaveBeenCalledWith({
      providerID: "opencode-go",
      modelID: "deepseek-v4.1-flash",
      variant: "max",
    });
  });

  it("falls back to \"default\" only when nothing can be resolved", () => {
    mocks.getStoredModel.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-4o",
      variant: "default",
    });

    applySessionSettings(
      makeSession({ model: { providerID: "opencode-go", id: "deepseek-v4.1-flash" } }),
    );

    expect(mocks.selectModel).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "default" }),
    );
  });

  it("resolves the configured default when the stored variant is \"default\"", () => {
    mocks.state.configVariant = "max";
    mocks.getStoredModel.mockReturnValue({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "default",
    });

    applySessionSettings(
      makeSession({ model: { providerID: "opencode-go", id: "deepseek-v4-flash" } }),
    );

    expect(mocks.selectModel).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "max" }),
    );
  });

  it("leaves the current settings untouched for a session that was never prompted", () => {
    applySessionSettings(makeSession());

    expect(mocks.selectAgent).not.toHaveBeenCalled();
    expect(mocks.selectModel).not.toHaveBeenCalled();
  });

  it("ignores a model that names no provider or no id", () => {
    applySessionSettings(makeSession({ model: { providerID: "", id: "" } }));

    expect(mocks.selectModel).not.toHaveBeenCalled();
  });
});
