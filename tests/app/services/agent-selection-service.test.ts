import { beforeEach, describe, expect, it, vi } from "#vitest";
import { mockDep } from "#helpers/mock-dep.js";
import { loadSut } from "#helpers/sut-loader.js";

let currentProject:
  | {
      id: string;
      worktree: string;
      name: string;
    }
  | undefined;
let currentSession:
  | {
      id: string;
      directory: string;
      title: string;
    }
  | undefined;
let currentAgent: string | undefined;

// bun's mock.module caches the synthetic module on first load. The mock
// factory is called once. After that, the SUT's static import holds a
// reference to whatever the factory returned. If the factory returned
// `vi.fn(() => currentProject)`, the SUT ends up with a mock whose
// implementation captured `currentProject` at factory-call time, NOT at
// mock-call time — so subsequent `currentProject = ...` updates are
// invisible to the mock.
//
// Workaround: store mutable state on globalThis (per-test-file) and have
// the mock factory return plain functions that read from globalThis at
// call time.
const TEST_STATE_KEY = "__bunTestAgentState__";
interface TestState {
  currentProject:
    | {
        id: string;
        worktree: string;
        name: string;
      }
    | undefined;
  currentSession:
    | {
        id: string;
        directory: string;
        title: string;
      }
    | undefined;
  currentAgent: string | undefined;
}
const state: TestState = (globalThis as Record<string, TestState>)[TEST_STATE_KEY] ??= {
  currentProject: undefined,
  currentSession: undefined,
  currentAgent: undefined,
};

const mocked = {
  appAgentsMock: vi.fn(),
  sessionMessagesMock: vi.fn(),
  getCurrentProjectMock: vi.fn(() => {
    if (process.env.DEBUG_MOCK) console.log(`[getCurrentProjectMock] state.currentProject:`, JSON.stringify(state.currentProject));
    return state.currentProject;
  }),
  getCurrentSessionMock: vi.fn(() => state.currentSession),
  getCurrentAgentMock: vi.fn(() => state.currentAgent),
  setCurrentAgentMock: vi.fn((agentName: string) => {
    state.currentAgent = agentName;
  }),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  setCurrentProject: (project?: { id: string; worktree: string; name: string }) => {
    state.currentProject = project;
  },
  setCurrentSession: (session?: { id: string; directory: string; title: string }) => {
    state.currentSession = session;
  },
  setCurrentAgent: (agentName?: string) => {
    state.currentAgent = agentName;
  },
};

mockDep(
  "#src/opencode/client.ts",
  () => {
    if (process.env.DEBUG_MOCK) console.log("[FACTORY client.ts] called");
    return {
      opencodeClient: {
        app: {
          agents: mocked.appAgentsMock,
        },
        session: {
          messages: mocked.sessionMessagesMock,
        },
      },
    };
  },
  import.meta.url,
);

// Provide the full set of exports from settings-store so the SUT (and any
// transitive deps that import it) can destructure or call any export without
// hitting "undefined is not a function". The four exports we actually exercise
// in this test are wired to the mocks above; the rest are vi.fn() stubs.
const settingsStoreStubExports = [
  "getCurrentProject",
  "setCurrentProject",
  "clearProject",
  "getCurrentSession",
  "setCurrentSession",
  "clearSession",
  "getTtsMode",
  "setTtsMode",
  "getCurrentAgent",
  "setCurrentAgent",
  "clearCurrentAgent",
  "getCurrentModel",
  "setCurrentModel",
  "clearCurrentModel",
  "getPinnedMessageId",
  "setPinnedMessageId",
  "clearPinnedMessageId",
  "getSessionDirectoryCache",
  "setSessionDirectoryCache",
  "clearSessionDirectoryCache",
  "getScheduledTasks",
  "setScheduledTasks",
  "getScheduledTaskSessionIgnores",
  "setScheduledTaskSessionIgnores",
  "__resetSettingsForTests",
  "loadSettings",
] as const;

mockDep(
  "#src/app/stores/settings-store.ts",
  () => {
    if (process.env.DEBUG_MOCK) console.log("[FACTORY settings-store.ts] called");
    const stub: Record<string, unknown> = {};
    for (const name of settingsStoreStubExports) stub[name] = vi.fn();
    stub.getCurrentProject = mocked.getCurrentProjectMock;
    stub.getCurrentAgent = mocked.getCurrentAgentMock;
    stub.setCurrentAgent = mocked.setCurrentAgentMock;
    return stub;
  },
  import.meta.url,
);

mockDep(
  "#src/app/services/session-service.ts",
  () => ({
    getCurrentSession: mocked.getCurrentSessionMock,
  }),
  import.meta.url,
);

mockDep(
  "#src/utils/logger.ts",
  () => ({
    logger: {
      debug: mocked.loggerDebugMock,
      error: mocked.loggerErrorMock,
      info: mocked.loggerInfoMock,
      warn: mocked.loggerWarnMock,
    },
  }),
  import.meta.url,
);

const sut = await loadSut<typeof import("#src/app/services/agent-selection-service.js")>(
  "#src/app/services/agent-selection-service.ts",
  import.meta.url,
);

function createAgentResponse(
  agents: Array<{ name: string; mode: "primary" | "all" | "subagent"; hidden?: boolean }>,
) {
  return {
    data: agents,
    error: null,
  };
}

describe("agent/manager", () => {
  beforeEach(() => {
    mocked.appAgentsMock.mockReset();
    mocked.sessionMessagesMock.mockReset();
    mocked.getCurrentProjectMock.mockClear();
    mocked.getCurrentSessionMock.mockClear();
    mocked.getCurrentAgentMock.mockClear();
    mocked.setCurrentAgentMock.mockClear();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    state.currentProject = undefined;
    state.currentSession = undefined;
    state.currentAgent = undefined;
  });

  it("filters out hidden agents and subagents", async () => {
    mocked.setCurrentProject({
      id: "project-1",
      worktree: "/workspace/project-1",
      name: "project-1",
    });
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "orchestrator", mode: "primary" },
        { name: "build", mode: "primary" },
        { name: "summary", mode: "primary", hidden: true },
        { name: "general", mode: "subagent" },
      ]),
    );

    const result = await sut.getAvailableAgents();

    expect(result).toEqual([
      { name: "orchestrator", mode: "primary" },
      { name: "build", mode: "primary" },
    ]);
  });

  it("falls back to build when the preferred agent is unavailable in the project", async () => {
    mocked.setCurrentProject({
      id: "project-1",
      worktree: "/workspace/project-1",
      name: "project-1",
    });
    mocked.setCurrentAgent("orchestrator");
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "build", mode: "primary" },
        { name: "plan", mode: "primary" },
      ]),
    );

    const agents = await sut.getAvailableAgents();

    const result = await sut.resolveProjectAgent("orchestrator");

    expect(result).toBe("build");
    expect(mocked.setCurrentAgentMock).toHaveBeenCalledWith("build");
    expect(mocked.loggerWarnMock).toHaveBeenCalledOnce();
  });

  it("falls back to the first available agent when build is unavailable", async () => {
    mocked.setCurrentProject({
      id: "project-2",
      worktree: "/workspace/project-2",
      name: "project-2",
    });
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "plan", mode: "primary" },
        { name: "orchestrator", mode: "primary" },
      ]),
    );

    const result = await sut.resolveProjectAgent("build");

    expect(result).toBe("plan");
    expect(mocked.setCurrentAgentMock).toHaveBeenCalledWith("plan");
  });

  it("normalizes an invalid stored agent when there is an active project without a session", async () => {
    mocked.setCurrentProject({
      id: "project-3",
      worktree: "/workspace/project-3",
      name: "project-3",
    });
    mocked.setCurrentAgent("orchestrator");
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "build", mode: "primary" },
        { name: "plan", mode: "primary" },
      ]),
    );

    const result = await sut.fetchCurrentAgent();

    expect(result).toBe("build");
    expect(mocked.setCurrentAgentMock).toHaveBeenCalledWith("build");
    expect(mocked.sessionMessagesMock).not.toHaveBeenCalled();
  });
});
