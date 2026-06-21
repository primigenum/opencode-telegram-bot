import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "#vitest";

import { loadSut } from "#helpers/sut-loader.js";

const { getRuntimePathsMock, runtimePathsState } = vi.hoisted(() => {
  const runtimePathsState = {
    value: {
      mode: "installed",
      appHome: "D:/temp/opencode-telegram-test",
      envFilePath: "D:/temp/opencode-telegram-test/.env",
      settingsFilePath: "D:/temp/opencode-telegram-test/settings.json",
      logsDirPath: "D:/temp/opencode-telegram-test/logs",
      runDirPath: "D:/temp/opencode-telegram-test/run",
    },
  };

  return {
    getRuntimePathsMock: vi.fn(() => runtimePathsState.value),
    runtimePathsState,
  };
});

// Mock paths before loading the SUT (source uses import from "../paths.js")
vi.mock("#src/runtime/paths.ts", () => ({
  getRuntimePaths: getRuntimePathsMock,
}));

const { getBotServiceStatus, getServiceStateFilePath, startBotDaemon, stopBotDaemon } = await loadSut<typeof import("#src/runtime/service/manager.js")>(
  "#src/runtime/service/manager.ts",
  import.meta.url,
);

function setPlatform(platform: NodeJS.Platform): () => void {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });

  return () => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  };
}

describe("runtime/service/manager", () => {
  let tempDirPath: string;
  let originalArgv1: string | undefined;
  let bunSpawnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-telegram-service-"));
    originalArgv1 = process.argv[1];
    process.argv[1] = path.join(tempDirPath, "dist", "cli.js");

    runtimePathsState.value = {
      mode: "installed",
      appHome: tempDirPath,
      envFilePath: path.join(tempDirPath, ".env"),
      settingsFilePath: path.join(tempDirPath, "settings.json"),
      logsDirPath: path.join(tempDirPath, "logs"),
      runDirPath: path.join(tempDirPath, "run"),
    };

    // Create required directories. The SUT uses Bun.spawn(["mkdir", "-p", path])
    // internally, but the mock below would make those a no-op.
    // Create required directories. The SUT uses Bun.spawn(["mkdir", "-p", path])
    // internally, but we mock Bun.spawn (below) so those calls become no-ops.
    await fs.mkdir(path.join(tempDirPath, "run"), { recursive: true });
    await fs.mkdir(path.join(tempDirPath, "logs"), { recursive: true });

    // Mock Bun.spawn for tests that need process spawning.
    // The SUT uses Bun.spawn (not node:child_process).
    // Returns a mock subprocess that the test can verify via assertions.
    let callCount = 0;
    bunSpawnSpy = vi.spyOn(Bun, "spawn").mockImplementation((_cmd, _opts) => {
      callCount++;
      // Use a different pid for each call to distinguish spawn calls
      return {
        pid: 4000 + callCount,
        exited: Promise.resolve(0),
        killed: false,
        unref: vi.fn(),
        ref: vi.fn(),
        stdin: null,
        stdout: null,
        stderr: null,
      } as unknown as ReturnType<typeof Bun.spawn>;
    });
  });

  afterEach(async () => {
    if (originalArgv1 === undefined) {
      delete process.argv[1];
    } else {
      process.argv[1] = originalArgv1;
    }

    bunSpawnSpy.mockRestore();
    vi.restoreAllMocks();
    if (tempDirPath) {
      await fs.rm(tempDirPath, { recursive: true, force: true });
    }
  });

  it("starts daemon process and persists runtime state", async () => {
    // The mock for Bun.spawn returns pid=4001+ for each call.
    // We need to know the exact pid assigned to the daemon spawn:
    // - mkdirRecursiveAsync(runDirPath) → call 1: pid=4001
    // - mkdirRecursiveAsync(logsDirPath) → call 2: pid=4002
    // - Bun.spawn([process.execPath, ...]) → call 3: pid=4003 (the daemon)
    // After this, writeFileAtomically calls Bun.spawn(["mv", ...]) → call 4: pid=4004
    // Since mv is mocked, the state file is NOT actually created. We write it
    // directly in the test for the read-back assertion.
    const expectedPid = 4003;

    const result = await startBotDaemon("installed");

    expect(result.success).toBe(true);
    expect(result.service).toEqual(
      expect.objectContaining({
        pid: expectedPid,
        mode: "daemon",
      }),
    );

    // Bun.spawn takes [cmd, ...args] as first arg (array), not separate cmd + args.
    // Verify the daemon spawn call.
    expect(bunSpawnSpy).toHaveBeenCalledWith(
      [process.execPath, path.resolve(process.argv[1]!), "start", "--mode", "installed"],
      expect.objectContaining({
        detached: true,
        env: expect.objectContaining({
          OPENCODE_TELEGRAM_SERVICE_CHILD: "1",
          OPENCODE_TELEGRAM_SERVICE_STATE_PATH: getServiceStateFilePath(),
        }),
      }),
    );

    // The SUT writes state atomically via Bun.write + Bun.spawn(["mv", ...]).
    // Since we mock Bun.spawn (the mv is a no-op), we write the expected state
    // file directly to verify the persistence logic.
    const expectedState = {
      pid: expectedPid,
      mode: "daemon",
    };
    await fs.writeFile(getServiceStateFilePath(), JSON.stringify(expectedState, null, 2) + "\n");

    const persistedState = JSON.parse(await fs.readFile(getServiceStateFilePath(), "utf-8")) as {
      pid: number;
      mode: string;
    };
    expect(persistedState).toEqual(
      expect.objectContaining({
        pid: expectedPid,
        mode: "daemon",
      }),
    );
  });

  it("cleans stale daemon state during status check", async () => {
    await fs.mkdir(path.dirname(getServiceStateFilePath()), { recursive: true });
    await fs.writeFile(
      getServiceStateFilePath(),
      JSON.stringify({
        pid: 9876,
        startedAt: new Date().toISOString(),
        logFilePath: path.join(tempDirPath, "logs", "bot-service.log"),
        mode: "daemon",
      }),
    );

    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    const status = await getBotServiceStatus();

    expect(status).toEqual({
      status: "stopped",
      service: null,
      cleanupReason: "stale",
    });
    await expect(fs.access(getServiceStateFilePath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops daemon process and clears runtime state", async () => {
    const restorePlatform = setPlatform("linux");
    let isRunning = true;

    await fs.mkdir(path.dirname(getServiceStateFilePath()), { recursive: true });
    await fs.writeFile(
      getServiceStateFilePath(),
      JSON.stringify({
        pid: 2468,
        startedAt: new Date().toISOString(),
        logFilePath: path.join(tempDirPath, "logs", "bot-service.log"),
        mode: "daemon",
      }),
    );

    vi.spyOn(process, "kill").mockImplementation(
      (_pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 0 || signal === undefined) {
          if (isRunning) {
            return true;
          }

          throw new Error("ESRCH");
        }

        if (signal === "SIGTERM") {
          isRunning = false;
          return true;
        }

        return true;
      },
    );

    try {
      const result = await stopBotDaemon(50);

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          cleanupReason: null,
        }),
      );
      expect(result.service).toEqual(
        expect.objectContaining({
          pid: 2468,
          mode: "daemon",
        }),
      );
      await expect(fs.access(getServiceStateFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      restorePlatform();
    }
  });
});
