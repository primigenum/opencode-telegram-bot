/**
 * Invalid-JSON case for the OpenCode CLI config reader (plan T6, case iv).
 *
 * Kept in its own file: the reader resolves its config path and caches the
 * parsed result at module scope, and `bun test --isolate` gives each test file
 * a fresh module instance. The valid-JSONC cases live in
 * variant-selection-service.test.ts.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";

const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: { config: { providers: vi.fn() } },
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  getStoredModel: vi.fn(),
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
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);

vi.mock("#src/utils/logger.ts", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: loggerWarnMock, error: vi.fn() },
}));

const fakeHome = await mkdtemp(path.join(os.tmpdir(), "bot-variant-invalid-"));
await mkdir(path.join(fakeHome, ".config", "opencode"), { recursive: true });
await writeFile(
  path.join(fakeHome, ".config", "opencode", "opencode.jsonc"),
  `{ "provider": { "opencode-go": { "models": {`,
  "utf-8",
);
process.env.HOME = fakeHome;

const variantSut = await loadSut<typeof import("#src/app/services/variant-selection-service.js")>(
  "#src/app/services/variant-selection-service.ts",
  import.meta.url,
);

describe("getDefaultVariantFromConfig — invalid JSON config", () => {
  it("returns undefined and warns once when the config cannot be parsed", () => {
    expect(
      variantSut.getDefaultVariantFromConfig("opencode-go", "deepseek-v4.1-flash"),
    ).toBeUndefined();
    expect(
      variantSut.getDefaultVariantFromConfig("opencode-go", "deepseek-v4.1-flash"),
    ).toBeUndefined();

    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
  });
});
