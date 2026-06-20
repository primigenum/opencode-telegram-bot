import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  warmupSessionDirectoryCacheMock: vi.fn(),
  reconcileStoredModelSelectionMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: {
    global: {
      health: mocked.healthMock,
    },
  },
}));

vi.mock("#src/app/services/session-cache-service.ts", () => ({
  __resetSessionDirectoryCacheForTests: vi.fn(),
  warmupSessionDirectoryCache: mocked.warmupSessionDirectoryCacheMock,
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  reconcileStoredModelSelection: mocked.reconcileStoredModelSelectionMock,
  getModelSelectionLists: vi.fn(),
  __resetModelCatalogCacheForTests: vi.fn(),
  getFavoriteModels: vi.fn(),
  searchModels: vi.fn(),
  fetchCurrentModel: vi.fn(),
  selectModel: vi.fn(),
  getStoredModel: vi.fn(),
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: vi.fn(),
    warn: mocked.loggerWarnMock,
    error: vi.fn(),
  },
}));

const sut = await loadSut<typeof import("#src/opencode/ready-refresh.js")>(
  "#src/opencode/ready-refresh.ts",
  import.meta.url,
);

describe("opencode/ready-refresh", () => {
  beforeEach(() => {
    mocked.healthMock.mockReset();
    mocked.warmupSessionDirectoryCacheMock.mockReset();
    mocked.reconcileStoredModelSelectionMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerWarnMock.mockReset();

    mocked.warmupSessionDirectoryCacheMock.mockResolvedValue(undefined);
    mocked.reconcileStoredModelSelectionMock.mockResolvedValue(undefined);
  });

  it("skips refresh with a short warning when OpenCode server is unavailable", async () => {
    mocked.healthMock.mockRejectedValueOnce(new Error("fetch failed"));

    const refreshed = await sut.refreshSessionCacheIfOpencodeReady("startup");

    expect(refreshed).toBe(false);
    expect(mocked.warmupSessionDirectoryCacheMock).not.toHaveBeenCalled();
    expect(mocked.reconcileStoredModelSelectionMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[OpenCodeReady] OpenCode server is not running; skipping session cache refresh: reason=startup",
    );
  });

  it("refreshes cache when OpenCode server is healthy", async () => {
    mocked.healthMock.mockResolvedValueOnce({ data: { healthy: true }, error: null });

    const refreshed = await sut.refreshSessionCacheIfOpencodeReady("startup");

    expect(refreshed).toBe(true);
    expect(mocked.warmupSessionDirectoryCacheMock).toHaveBeenCalledTimes(1);
    expect(mocked.reconcileStoredModelSelectionMock).toHaveBeenCalledWith({
      forceCatalogRefresh: true,
    });
  });

  it("logs refresh failures without throwing", async () => {
    mocked.warmupSessionDirectoryCacheMock.mockRejectedValueOnce(new Error("refresh failed"));

    await expect(
      sut.refreshSessionCacheAfterOpencodeReady("opencode_start_success"),
    ).resolves.toBeUndefined();

    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[OpenCodeReady] Failed to refresh session cache: reason=opencode_start_success",
      expect.any(Error),
    );
    expect(mocked.reconcileStoredModelSelectionMock).toHaveBeenCalledWith({
      forceCatalogRefresh: true,
    });
  });

  it("logs model refresh failures without throwing", async () => {
    mocked.reconcileStoredModelSelectionMock.mockRejectedValueOnce(new Error("model failed"));

    await expect(
      sut.refreshSessionCacheAfterOpencodeReady("opencode_start_success"),
    ).resolves.toBeUndefined();

    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[OpenCodeReady] Failed to refresh model catalog: reason=opencode_start_success",
      expect.any(Error),
    );
  });
});
