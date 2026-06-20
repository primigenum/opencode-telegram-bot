import { beforeAll, beforeEach, describe, expect, it, vi } from "#vitest";
import { fileURLToPath } from "bun";
import { registerMock } from "#helpers/mock-plugin.js";
import { loadSut } from "#helpers/sut-loader.js";

const mocked = {
  getAvailableAgentsMock: vi.fn(),
};

registerMock(
  fileURLToPath(import.meta.resolve("#src/app/services/agent-selection-service")),
  () => ({
    fetchCurrentAgent: vi.fn(),
    getAvailableAgents: mocked.getAvailableAgentsMock,
    selectAgent: vi.fn(),
    getStoredAgent: vi.fn(),
  }),
);

const sut = await loadSut<typeof import("#src/bot/menus/agent-selection-menu.js")>(
  "#src/bot/menus/agent-selection-menu.ts",
  import.meta.url,
);

describe("bot agent selection", () => {
  beforeEach(() => {
    mocked.getAvailableAgentsMock.mockReset();
  });

  it("highlights the selected agent without uppercasing its name", async () => {
    mocked.getAvailableAgentsMock.mockResolvedValueOnce([
      { name: "reviewer", mode: "primary" },
      { name: "build", mode: "primary" },
    ]);

    const keyboard = await sut.buildAgentSelectionMenu("reviewer");

    expect(keyboard.inline_keyboard[0]?.[0]?.text).toBe("✅ 🤖 Reviewer");
    expect(keyboard.inline_keyboard[1]?.[0]?.text).toBe("🛠️ Build");
  });
});
