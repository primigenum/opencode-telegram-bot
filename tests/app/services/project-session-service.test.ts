import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Bot, Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";

const mocked = vi.hoisted(() => ({
  sessionListMock: vi.fn(),
  sessionGetMock: vi.fn(),
  attachToSessionMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  applySessionSettingsMock: vi.fn(),
  ensureEventSubscriptionMock: vi.fn(),
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: {
    session: {
      list: mocked.sessionListMock,
      get: mocked.sessionGetMock,
    },
  },
}));

vi.mock("#src/app/services/attach-service.ts", () => ({
  attachToSession: mocked.attachToSessionMock,
  detachAttachedSession: vi.fn(),
  markAttachedSessionBusy: vi.fn(),
  markAttachedSessionIdle: vi.fn(),
  restoreAttachedCurrentSession: vi.fn(),
  configureAttachPresentation: vi.fn(),
}));

vi.mock("#src/app/services/session-service.ts", () => ({
  setCurrentSession: mocked.setCurrentSessionMock,
  getCurrentSession: vi.fn(() => null),
  clearSession: vi.fn(),
}));

vi.mock("#src/app/services/session-settings-service.ts", () => ({
  applySessionSettings: mocked.applySessionSettingsMock,
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { attachLatestProjectSession, attachSessionById } = await loadSut<
  typeof import("#src/app/services/project-session-service.js")
>("#src/app/services/project-session-service.ts", import.meta.url);

function createBot(): Bot<Context> {
  return { api: { sendMessage: vi.fn() } } as unknown as Bot<Context>;
}

function attachDeps() {
  return {
    bot: createBot(),
    chatId: 777,
    directory: "D:\\Projects\\Repo",
    ensureEventSubscription: mocked.ensureEventSubscriptionMock,
  };
}

describe("app/services/project-session-service", () => {
  beforeEach(() => {
    mocked.sessionListMock.mockReset();
    mocked.sessionListMock.mockResolvedValue({ data: [], error: null });
    mocked.sessionGetMock.mockReset();
    mocked.sessionGetMock.mockResolvedValue({
      data: { id: "session-latest", title: "Latest work" },
      error: null,
    });
    mocked.attachToSessionMock.mockReset();
    mocked.attachToSessionMock.mockResolvedValue(undefined);
    mocked.setCurrentSessionMock.mockReset();
    mocked.applySessionSettingsMock.mockReset();
    mocked.ensureEventSubscriptionMock.mockReset();
  });

  it("attaches the most recently updated session and adopts its settings", async () => {
    const latest = {
      id: "session-latest",
      title: "Latest work",
      agent: "boss",
      model: { providerID: "opencode-go", modelID: "m", variant: "max" },
    };
    mocked.sessionListMock.mockResolvedValue({ data: [latest], error: null });
    mocked.sessionGetMock.mockResolvedValue({ data: latest, error: null });
    const deps = attachDeps();

    const attached = await attachLatestProjectSession(deps);

    expect(attached).toEqual({
      id: "session-latest",
      title: "Latest work",
      directory: deps.directory,
    });
    expect(mocked.sessionListMock).toHaveBeenCalledWith({
      directory: deps.directory,
      limit: 1,
      roots: true,
    });
    expect(mocked.sessionGetMock).toHaveBeenCalledWith({
      sessionID: "session-latest",
      directory: deps.directory,
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-latest",
      title: "Latest work",
      directory: deps.directory,
    });
    expect(mocked.applySessionSettingsMock).toHaveBeenCalledWith(latest);
    expect(mocked.attachToSessionMock).toHaveBeenCalledWith({
      bot: deps.bot,
      chatId: 777,
      session: {
        id: "session-latest",
        title: "Latest work",
        directory: deps.directory,
      },
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });
  });

  it("returns null without touching the current session when there are no sessions", async () => {
    const title = await attachLatestProjectSession(attachDeps());

    expect(title).toBeNull();
    expect(mocked.setCurrentSessionMock).not.toHaveBeenCalled();
    expect(mocked.attachToSessionMock).not.toHaveBeenCalled();
  });

  it("returns null when the sessions request fails", async () => {
    mocked.sessionListMock.mockResolvedValue({ data: undefined, error: new Error("boom") });

    const title = await attachLatestProjectSession(attachDeps());

    expect(title).toBeNull();
    expect(mocked.attachToSessionMock).not.toHaveBeenCalled();
  });

  it("attaches a single session by id", async () => {
    const bot = createBot();
    mocked.sessionGetMock.mockResolvedValue({
      data: { id: "session-x", title: "Saved one" },
      error: null,
    });

    const attached = await attachSessionById({
      bot,
      chatId: 777,
      sessionId: "session-x",
      directory: "D:\\Projects\\Repo",
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });

    expect(attached).toEqual({
      id: "session-x",
      title: "Saved one",
      directory: "D:\\Projects\\Repo",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-x",
      title: "Saved one",
      directory: "D:\\Projects\\Repo",
    });
    expect(mocked.attachToSessionMock).toHaveBeenCalledWith({
      bot,
      chatId: 777,
      session: { id: "session-x", title: "Saved one", directory: "D:\\Projects\\Repo" },
      ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    });
  });

  it("returns null and attaches nothing when the session no longer exists", async () => {
    mocked.sessionGetMock.mockResolvedValue({ data: undefined, error: new Error("not found") });

    const title = await attachSessionById({
      ...attachDeps(),
      sessionId: "session-gone",
    });

    expect(title).toBeNull();
    expect(mocked.setCurrentSessionMock).not.toHaveBeenCalled();
    expect(mocked.attachToSessionMock).not.toHaveBeenCalled();
  });
});
