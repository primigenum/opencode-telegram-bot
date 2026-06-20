import { beforeEach, describe, expect, it, vi } from "#vitest";

import { loadSut } from "#helpers/sut-loader.js";
const mocked = vi.hoisted(() => ({
  createBotMock: vi.fn(),
  cleanupBotRuntimeMock: vi.fn(),
  autoRestartStartMock: vi.fn(),
  autoRestartStopMock: vi.fn(),
  notifyOpencodeReadyIfHealthyMock: vi.fn(),
  registerOpenCodeReadyRefreshHandlerMock: vi.fn(),
  loadSettingsMock: vi.fn(),
  scheduledTaskInitializeMock: vi.fn(),
  scheduledTaskShutdownMock: vi.fn(),
  reconcileStoredModelSelectionMock: vi.fn(),
  clearServiceStateFileMock: vi.fn(),
  isServiceChildProcessMock: vi.fn(),
  getServiceStateFilePathFromEnvMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  initializeLoggerMock: vi.fn(),
  getLogFilePathMock: vi.fn(),
  config: {
    opencode: {
      apiUrl: "http://localhost:4096",
    },
    telegram: {
      allowedUserId: 123,
    },
  },
}));

vi.mock("#src/bot/index.ts", () => ({
  cleanupBotRuntime: mocked.cleanupBotRuntimeMock,
  createBot: mocked.createBotMock,
}));

vi.mock("#src/config.ts", () => ({
  config: mocked.config,
}));

vi.mock("#src/opencode/auto-restart.ts", () => ({
  opencodeAutoRestartService: {
    start: mocked.autoRestartStartMock,
    stop: mocked.autoRestartStopMock,
  },
}));

vi.mock("#src/opencode/ready-refresh.ts", () => ({
  notifyOpencodeReadyIfHealthy: mocked.notifyOpencodeReadyIfHealthyMock,
  registerOpenCodeReadyRefreshHandler: mocked.registerOpenCodeReadyRefreshHandlerMock,
}));

vi.mock("#src/app/stores/settings-store.ts", () => ({
  loadSettings: mocked.loadSettingsMock,
}));

vi.mock("#src/app/services/scheduled-task-runtime-service.ts", () => ({
  scheduledTaskRuntime: {
    initialize: mocked.scheduledTaskInitializeMock,
    shutdown: mocked.scheduledTaskShutdownMock,
  },
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  reconcileStoredModelSelection: mocked.reconcileStoredModelSelectionMock,
}));

vi.mock("#src/runtime/mode.ts", () => ({
  getRuntimeMode: () => "source",
}));

vi.mock("#src/runtime/paths.ts", () => ({
  getRuntimePaths: () => ({ envFilePath: ".env" }),
}));

vi.mock("#src/runtime/service/manager.ts", () => ({
  clearServiceStateFile: mocked.clearServiceStateFileMock,
}));

vi.mock("#src/runtime/service/env.ts", () => ({
  getServiceStateFilePathFromEnv: mocked.getServiceStateFilePathFromEnvMock,
  isServiceChildProcess: mocked.isServiceChildProcessMock,
}));

vi.mock("#src/utils/logger.ts", () => ({
  getLogFilePath: mocked.getLogFilePathMock,
  initializeLogger: mocked.initializeLoggerMock,
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

const { startBotApp } = await loadSut<typeof import("#src/app/bootstrap/start-bot-app.js")>(
  "#src/app/bootstrap/start-bot-app.ts",
  import.meta.url,
);

function createBot() {
  return {
    api: {
      deleteWebhook: vi.fn().mockResolvedValue(undefined),
      getWebhookInfo: vi.fn().mockResolvedValue({ url: "" }),
    },
    start: vi.fn().mockImplementation(async ({ onStart }) => {
      onStart?.({ username: "test_bot" });
    }),
    stop: vi.fn(),
  };
}

async function flushBackgroundTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("app/start-bot-app", () => {
  beforeEach(() => {
    mocked.createBotMock.mockReset();
    mocked.cleanupBotRuntimeMock.mockReset();
    mocked.autoRestartStartMock.mockReset();
    mocked.autoRestartStopMock.mockReset();
    mocked.notifyOpencodeReadyIfHealthyMock.mockReset();
    mocked.registerOpenCodeReadyRefreshHandlerMock.mockReset();
    mocked.loadSettingsMock.mockReset();
    mocked.scheduledTaskInitializeMock.mockReset();
    mocked.scheduledTaskShutdownMock.mockReset();
    mocked.reconcileStoredModelSelectionMock.mockReset();
    mocked.clearServiceStateFileMock.mockReset();
    mocked.isServiceChildProcessMock.mockReset();
    mocked.getServiceStateFilePathFromEnvMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.initializeLoggerMock.mockReset();
    mocked.getLogFilePathMock.mockReset();

    mocked.createBotMock.mockReturnValue(createBot());
    mocked.autoRestartStartMock.mockResolvedValue(false);
    mocked.notifyOpencodeReadyIfHealthyMock.mockResolvedValue(false);
    mocked.loadSettingsMock.mockResolvedValue(undefined);
    mocked.scheduledTaskInitializeMock.mockResolvedValue(undefined);
    mocked.reconcileStoredModelSelectionMock.mockResolvedValue(undefined);
    mocked.isServiceChildProcessMock.mockReturnValue(false);
    mocked.initializeLoggerMock.mockResolvedValue(undefined);
    mocked.getLogFilePathMock.mockReturnValue(null);
  });

  it("registers ready refresh and performs startup health notification", async () => {
    await startBotApp();
    await flushBackgroundTasks();

    expect(mocked.registerOpenCodeReadyRefreshHandlerMock).toHaveBeenCalledTimes(1);
    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup");
  });

  it("runs startup health notification even when auto-restart handled startup", async () => {
    mocked.autoRestartStartMock.mockResolvedValue(true);

    await startBotApp();
    await flushBackgroundTasks();

    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup");
  });

  it("starts Telegram polling without waiting for OpenCode startup checks", async () => {
    let resolveAutoRestart: (value: boolean) => void = () => undefined;
    mocked.autoRestartStartMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveAutoRestart = resolve;
      }),
    );
    const bot = createBot();
    mocked.createBotMock.mockReturnValue(bot);

    await startBotApp();

    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(mocked.notifyOpencodeReadyIfHealthyMock).not.toHaveBeenCalled();

    resolveAutoRestart(false);
    await flushBackgroundTasks();
    expect(mocked.notifyOpencodeReadyIfHealthyMock).toHaveBeenCalledWith("startup");
  });
});
