import { beforeEach, describe, expect, it, vi } from "#vitest";
import * as actualSettingsStore from "#src/app/stores/settings-store.js";
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

const mocked = {
  appAgentsMock: vi.fn(),
  sessionMessagesMock: vi.fn(),
  getCurrentProjectMock: vi.fn(() => currentProject),
  getCurrentSessionMock: vi.fn(() => currentSession),
  getCurrentAgentMock: vi.fn(() => currentAgent),
  setCurrentAgentMock: vi.fn((agentName: string) => {
    currentAgent = agentName;
  }),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  setCurrentProject: (project?: { id: string; worktree: string; name: string }) => {
    currentProject = project;
  },
  setCurrentSession: (session?: { id: string; directory: string; title: string }) => {
    currentSession = session;
  },
  setCurrentAgent: (agentName?: string) => {
    currentAgent = agentName;
  },
};

mockDep(
  "#src/opencode/client.ts",
  () => ({
    opencodeClient: {
      app: {
        agents: mocked.appAgentsMock,
      },
      session: {
        messages: mocked.sessionMessagesMock,
      },
    },
  }),
  import.meta.url,
);

mockDep(
  "#src/app/stores/settings-store.ts",
  () => ({
    ...actualSettingsStore,
    getCurrentProject: mocked.getCurrentProjectMock,
    getCurrentAgent: mocked.getCurrentAgentMock,
    setCurrentAgent: mocked.setCurrentAgentMock,
  }),
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
    mocked.setCurrentProject(undefined);
    mocked.setCurrentSession(undefined);
    mocked.setCurrentAgent(undefined);
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
