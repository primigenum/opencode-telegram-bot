import { beforeAll, beforeEach, describe, expect, it, vi } from "#vitest";
import { fileURLToPath } from "bun";
import { registerMock } from "../../helpers/mock-plugin.js";

const mocked = {
  getAvailableAgentsMock: vi.fn(),
};

registerMock(
  fileURLToPath(import.meta.resolve("../../../src/app/services/agent-selection-service")),
  () => ({
    fetchCurrentAgent: vi.fn(),
    getAvailableAgents: mocked.getAvailableAgentsMock,
    selectAgent: vi.fn(),
    getStoredAgent: vi.fn(),
  }),
);

let buildAgentSelectionMenu: typeof import("../../../src/bot/menus/agent-selection-menu.js").buildAgentSelectionMenu;

beforeAll(async () => {
  ({ buildAgentSelectionMenu } = await import("../../../src/bot/menus/agent-selection-menu.ts"));
});

describe("bot agent selection", () => {
  beforeEach(() => {
    mocked.getAvailableAgentsMock.mockReset();
  });

  it("highlights the selected agent without uppercasing its name", async () => {
    mocked.getAvailableAgentsMock.mockResolvedValueOnce([
      { name: "reviewer", mode: "primary" },
      { name: "build", mode: "primary" },
    ]);

    const keyboard = await buildAgentSelectionMenu("reviewer");

    expect(keyboard.inline_keyboard[0]?.[0]?.text).toBe("✅ 🤖 Reviewer");
    expect(keyboard.inline_keyboard[1]?.[0]?.text).toBe("🛠️ Build");
  });
});
