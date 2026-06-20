import { beforeEach, describe, expect, it, vi } from "#vitest";
import { mockDep } from "../helpers/mock-dep.js";
import { loadSut } from "../helpers/sut-loader.js";

const mocked = {
  healthMock: vi.fn(),
  warmupSessionDirectoryCacheMock: vi.fn(),
  reconcileStoredModelSelectionMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerWarnMock: vi.fn(),
};

mockDep(
  "../../src/opencode/client.ts",
  () => ({
    opencodeClient: {
      global: {
        health: mocked.healthMock,
      },
    },
  }),
  import.meta.url,
);

mockDep(
  "../../src/app/services/session-cache-service.ts",
  () => ({
    __resetSessionDirectoryCacheForTests: vi.fn(),
    warmupSessionDirectoryCache: mocked.warmupSessionDirectoryCacheMock,
  }),
  import.meta.url,
);

mockDep(
  "../../src/app/services/model-selection-service.ts",
  () => ({
    reconcileStoredModelSelection: mocked.reconcileStoredModelSelectionMock,
  }),
  import.meta.url,
);

mockDep(
  "../../src/utils/logger.ts",
  () => ({
    logger: {
      debug: mocked.loggerDebugMock,
      warn: mocked.loggerWarnMock,
    },
  }),
  import.meta.url,
);

const sut = loadSut<typeof import("../../src/opencode/ready-refresh.js")>(
  "../../src/opencode/ready-refresh.ts",
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
    );
  });
});
