import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";

const mocked = vi.hoisted(() => ({
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
  },
}));

const sut = await loadSut<typeof import("#src/opencode/ready-lifecycle.js")>(
  "#src/opencode/ready-lifecycle.ts",
  import.meta.url,
);

describe("opencode/ready-lifecycle", () => {
  beforeEach(() => {
    sut.opencodeReadyLifecycle.__resetForTests();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
  });

  it("calls ready handlers on unavailable to ready transition", async () => {
    const handler = vi.fn();
    sut.opencodeReadyLifecycle.onReady(handler);

    const emitted = await sut.opencodeReadyLifecycle.notifyReady("startup");

    expect(emitted).toBe(true);
    expect(handler).toHaveBeenCalledWith("startup");
  });

  it("does not call handlers for repeated ready notification", async () => {
    const handler = vi.fn();
    sut.opencodeReadyLifecycle.onReady(handler);

    await sut.opencodeReadyLifecycle.notifyReady("first");
    const emitted = await sut.opencodeReadyLifecycle.notifyReady("second");

    expect(emitted).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unavailable resets state for the next ready notification", async () => {
    const handler = vi.fn();
    sut.opencodeReadyLifecycle.onReady(handler);

    await sut.opencodeReadyLifecycle.notifyReady("first");
    sut.opencodeReadyLifecycle.notifyUnavailable("offline");
    await sut.opencodeReadyLifecycle.notifyReady("second");

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("logs handler errors and continues running remaining handlers", async () => {
    const failingHandler = vi.fn().mockRejectedValue(new Error("boom"));
    const nextHandler = vi.fn();
    sut.opencodeReadyLifecycle.onReady(failingHandler);
    sut.opencodeReadyLifecycle.onReady(nextHandler);

    await sut.opencodeReadyLifecycle.notifyReady("startup");

    expect(nextHandler).toHaveBeenCalledWith("startup");
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[OpenCodeReady] Ready handler failed: reason=startup",
      expect.any(Error),
    );
  });
});
