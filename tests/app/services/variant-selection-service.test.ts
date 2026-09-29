import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";

const mocked = vi.hoisted(() => ({
  getStoredModelMock: vi.fn(),
  getCurrentModelMock: vi.fn(),
  setCurrentModelMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: {
    config: { providers: vi.fn() },
  },
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

const settingsStoreMock = createSettingsStoreMock();
settingsStoreMock.getCurrentModel = mocked.getCurrentModelMock;
settingsStoreMock.setCurrentModel = mocked.setCurrentModelMock;
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: vi.fn(),
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: vi.fn(),
  },
}));

// The config reader resolves OPENCODE_CONFIG_PATH and parses the file at module
// scope, so HOME must point at the fixture before loadSut runs.
const fakeHome = await mkdtemp(path.join(os.tmpdir(), "bot-variant-jsonc-"));
await mkdir(path.join(fakeHome, ".config", "opencode"), { recursive: true });
await writeFile(
  path.join(fakeHome, ".config", "opencode", "opencode.jsonc"),
  `{
  // comments and trailing commas are valid JSONC
  "provider": {
    "opencode-go": {
      /* model-level defaults */
      "models": {
        "deepseek-v4.1-flash": { "options": { "reasoningEffort": "max" } }, // keep max
      },
    },
    "edge": {
      "models": {
        "edge-model": { "options": { "reasoningEffort": "max,},]" } },
      },
    },
  },
  "mcp": { "servers": [ "playwright", "filesystem", ], },
}
`,
  "utf-8",
);
process.env.HOME = fakeHome;

const variantSut = await loadSut<typeof import("#src/app/services/variant-selection-service.js")>(
  "#src/app/services/variant-selection-service.ts",
  import.meta.url,
);
const { setCurrentVariant } = variantSut;

describe("setCurrentVariant", () => {
  beforeEach(() => {
    mocked.getStoredModelMock.mockReset();
    mocked.getCurrentModelMock.mockReset();
    mocked.setCurrentModelMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerInfoMock.mockReset();
  });

  it("persists the fallback model when settings have no currentModel", () => {
    mocked.getCurrentModelMock.mockReturnValue(undefined);
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "default",
    });

    setCurrentVariant("low");

    expect(mocked.setCurrentModelMock).toHaveBeenCalledWith({
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      variant: "low",
    });
  });

  it("does not write when the fallback model has no provider or id", () => {
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "",
      modelID: "",
      variant: "default",
    });

    setCurrentVariant("low");

    expect(mocked.setCurrentModelMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalled();
  });
});

// ── JSONC robustness of the CLI config reader ─────────────────────
// The fixture above mixes comments, object/array trailing commas and an
// embedded ",} ,]" string, so a single parse exercises cases (i)-(iii).
// Case (iv) (invalid JSON) lives in its own file: the parsed config is cached
// per module and only "--isolate" gives a fresh module per test file.

describe("getDefaultVariantFromConfig — JSONC robustness", () => {
  it("parses a config mixing comments and trailing commas in objects and arrays", () => {
    expect(variantSut.getDefaultVariantFromConfig("opencode-go", "deepseek-v4.1-flash")).toBe("max");
  });

  it("keeps string values that contain ,} or ,] intact", () => {
    expect(variantSut.getDefaultVariantFromConfig("edge", "edge-model")).toBe("max,},]");
  });
});
