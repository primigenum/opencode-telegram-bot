import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";

const mocked = vi.hoisted(() => ({
  sessionGetMock: vi.fn(),
  sessionUpdateMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: {
    session: {
      get: mocked.sessionGetMock,
      update: mocked.sessionUpdateMock,
    },
  },
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

const {
  registerBotCreatedSession,
  scheduleSessionTitleFallback,
  applyScheduledSessionTitle,
  clearSessionTitleFallback,
  __resetSessionTitleFallbackForTests,
} = await loadSut<typeof import("#src/app/services/session-title-fallback-service.js")>(
  "#src/app/services/session-title-fallback-service.ts",
  import.meta.url,
);

const SESSION_ID = "session-1";
const DIRECTORY = "D:\\Projects\\Repo";
const DEFAULT_TITLE = "New session - 2026-10-01T10:00:00.000Z";

describe("app/services/session-title-fallback-service", () => {
  beforeEach(() => {
    __resetSessionTitleFallbackForTests();
    mocked.sessionGetMock.mockReset();
    mocked.sessionUpdateMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();
  });

  it("renames a registered session once the server still holds the default title", async () => {
    registerBotCreatedSession(SESSION_ID, DIRECTORY);
    scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: { id: SESSION_ID, title: DEFAULT_TITLE },
      error: null,
    });
    mocked.sessionUpdateMock.mockResolvedValueOnce({
      data: { id: SESSION_ID, title: "Fix the login bug" },
      error: null,
    });

    const result = await applyScheduledSessionTitle(SESSION_ID);

    expect(mocked.sessionGetMock).toHaveBeenCalledWith({
      sessionID: SESSION_ID,
      directory: DIRECTORY,
    });
    expect(mocked.sessionUpdateMock).toHaveBeenCalledWith({
      sessionID: SESSION_ID,
      directory: DIRECTORY,
      title: "Fix the login bug",
    });
    expect(result).toEqual({ renamed: true, title: "Fix the login bug", directory: DIRECTORY });
  });

  it("discards the pending title when OpenCode already produced a real one", async () => {
    registerBotCreatedSession(SESSION_ID, DIRECTORY);
    scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: { id: SESSION_ID, title: "Login refactor" },
      error: null,
    });

    const result = await applyScheduledSessionTitle(SESSION_ID);

    expect(mocked.sessionUpdateMock).not.toHaveBeenCalled();
    expect(result).toEqual({ renamed: false, directory: DIRECTORY });
  });

  it("does nothing when the session was not registered", async () => {
    scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");

    expect(await applyScheduledSessionTitle(SESSION_ID)).toBeNull();
    expect(mocked.sessionGetMock).not.toHaveBeenCalled();
    expect(mocked.sessionUpdateMock).not.toHaveBeenCalled();
  });

  it("consumes the registration so a second prompt cannot reschedule", async () => {
    registerBotCreatedSession(SESSION_ID, DIRECTORY);
    scheduleSessionTitleFallback(SESSION_ID, "First prompt");
    scheduleSessionTitleFallback(SESSION_ID, "Second prompt");

    mocked.sessionGetMock.mockResolvedValueOnce({
      data: { id: SESSION_ID, title: DEFAULT_TITLE },
      error: null,
    });
    mocked.sessionUpdateMock.mockResolvedValueOnce({
      data: { id: SESSION_ID, title: "First prompt" },
      error: null,
    });

    await applyScheduledSessionTitle(SESSION_ID);

    expect(mocked.sessionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "First prompt" }),
    );
  });

  it("does not throw and discards when the get call fails", async () => {
    registerBotCreatedSession(SESSION_ID, DIRECTORY);
    scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");
    mocked.sessionGetMock.mockRejectedValueOnce(new Error("network down"));

    const result = await applyScheduledSessionTitle(SESSION_ID);

    expect(result).toEqual({ renamed: false, directory: DIRECTORY });
    expect(mocked.loggerWarnMock).toHaveBeenCalled();
  });

  it("does not throw and discards when the update call fails", async () => {
    registerBotCreatedSession(SESSION_ID, DIRECTORY);
    scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: { id: SESSION_ID, title: DEFAULT_TITLE },
      error: null,
    });
    mocked.sessionUpdateMock.mockRejectedValueOnce(new Error("update failed"));

    const result = await applyScheduledSessionTitle(SESSION_ID);

    expect(result).toEqual({ renamed: false, directory: DIRECTORY });
    expect(mocked.loggerWarnMock).toHaveBeenCalled();
  });

  it("clearSessionTitleFallback cancels a scheduled rename", async () => {
    registerBotCreatedSession(SESSION_ID, DIRECTORY);
    scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");

    clearSessionTitleFallback(SESSION_ID, "session_error");

    expect(await applyScheduledSessionTitle(SESSION_ID)).toBeNull();
    expect(mocked.sessionUpdateMock).not.toHaveBeenCalled();
  });

  it("keeps the registration when the prompt yields no usable text", async () => {
    registerBotCreatedSession(SESSION_ID, DIRECTORY);
    scheduleSessionTitleFallback(SESSION_ID, "   \n\t ");

    expect(await applyScheduledSessionTitle(SESSION_ID)).toBeNull();
    expect(mocked.sessionGetMock).not.toHaveBeenCalled();

    // A later prompt with real text must still be able to seed the title.
    scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: { id: SESSION_ID, title: DEFAULT_TITLE },
      error: null,
    });
    mocked.sessionUpdateMock.mockResolvedValueOnce({
      data: { id: SESSION_ID, title: "Fix the login bug" },
      error: null,
    });

    expect(await applyScheduledSessionTitle(SESSION_ID)).toEqual({
      renamed: true,
      title: "Fix the login bug",
      directory: DIRECTORY,
    });
  });

  // The OpenCode SDK resolves HTTP failures into `{ data, error }` instead of
  // rejecting, so both shapes have to stay non-fatal.
  it("does not throw and discards when the SDK returns an error payload", async () => {
    registerBotCreatedSession(SESSION_ID, DIRECTORY);
    scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: undefined,
      error: { message: "Not Found", status: 404 },
    });

    const result = await applyScheduledSessionTitle(SESSION_ID);

    expect(result).toEqual({ renamed: false, directory: DIRECTORY });
    expect(mocked.sessionUpdateMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalled();
  });

  it("does not throw and discards when the update returns an error payload", async () => {
    registerBotCreatedSession(SESSION_ID, DIRECTORY);
    scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");
    mocked.sessionGetMock.mockResolvedValueOnce({
      data: { id: SESSION_ID, title: DEFAULT_TITLE },
      error: null,
    });
    mocked.sessionUpdateMock.mockResolvedValueOnce({
      data: undefined,
      error: { message: "Bad Request", status: 400 },
    });

    const result = await applyScheduledSessionTitle(SESSION_ID);

    expect(result).toEqual({ renamed: false, directory: DIRECTORY });
    expect(mocked.loggerWarnMock).toHaveBeenCalled();
  });

  it("does not rename a second time when idle is emitted twice", async () => {
    registerBotCreatedSession(SESSION_ID, DIRECTORY);
    scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");
    mocked.sessionGetMock.mockResolvedValue({
      data: { id: SESSION_ID, title: DEFAULT_TITLE },
      error: null,
    });
    mocked.sessionUpdateMock.mockResolvedValue({
      data: { id: SESSION_ID, title: "Fix the login bug" },
      error: null,
    });

    expect(await applyScheduledSessionTitle(SESSION_ID)).toMatchObject({ renamed: true });
    expect(await applyScheduledSessionTitle(SESSION_ID)).toBeNull();

    expect(mocked.sessionGetMock).toHaveBeenCalledTimes(1);
    expect(mocked.sessionUpdateMock).toHaveBeenCalledTimes(1);
  });
});
