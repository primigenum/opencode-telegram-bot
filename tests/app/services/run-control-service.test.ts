import { beforeEach, describe, expect, it, vi } from "#vitest";

import { loadSut } from "#helpers/sut-loader.js";
const mocked = vi.hoisted(() => ({
  reconcileBusyStateNowMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("#src/app/services/busy-reconciliation-service.ts", () => ({
  reconcileBusyStateNow: mocked.reconcileBusyStateNowMock,
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocked.loggerWarnMock,
    error: vi.fn(),
  },
}));

const { attachManager } = await loadSut<typeof import("#src/app/managers/attach-manager.js")>(
  "#src/app/managers/attach-manager.ts",
  import.meta.url,
);
const { foregroundSessionState } = await loadSut<typeof import("#src/app/managers/foreground-session-state-manager.js")>(
  "#src/app/managers/foreground-session-state-manager.ts",
  import.meta.url,
);
const { reconcileForegroundBusyState } = await loadSut<typeof import("#src/app/services/run-control-service.js")>(
  "#src/app/services/run-control-service.ts",
  import.meta.url,
);

describe("app/services/run-control-service", () => {
  beforeEach(() => {
    foregroundSessionState.__resetForTests();
    attachManager.__resetForTests();
    mocked.reconcileBusyStateNowMock.mockReset();
    mocked.reconcileBusyStateNowMock.mockResolvedValue(undefined);
    mocked.loggerWarnMock.mockReset();
  });

  it("uses non-throttled reconciliation for foreground busy directories", async () => {
    foregroundSessionState.markBusy("session-1", "D:/repo");

    await reconcileForegroundBusyState();

    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledWith("D:/repo");
    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledTimes(1);
  });

  it("continues checking other directories when one on-demand reconciliation fails", async () => {
    foregroundSessionState.markBusy("session-1", "D:/repo-a");
    foregroundSessionState.markBusy("session-2", "D:/repo-b");
    const error = new Error("status failed");
    mocked.reconcileBusyStateNowMock.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);

    await reconcileForegroundBusyState();

    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledWith("D:/repo-a");
    expect(mocked.reconcileBusyStateNowMock).toHaveBeenCalledWith("D:/repo-b");
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[BusyGuard] Failed to reconcile foreground busy state",
      error,
    );
  });
});
