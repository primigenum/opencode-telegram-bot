import { beforeEach, describe, expect, it } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { clearAllInteractionState } = await loadSut<typeof import("#src/app/managers/interaction-manager.js")>(
  "#src/app/managers/interaction-manager.ts",
  import.meta.url,
);
const { interactionManager } = await loadSut<typeof import("#src/app/managers/interaction-manager.js")>(
  "#src/app/managers/interaction-manager.ts",
  import.meta.url,
);
const { questionManager } = await loadSut<typeof import("#src/app/managers/question-manager.js")>(
  "#src/app/managers/question-manager.ts",
  import.meta.url,
);
const { permissionManager } = await loadSut<typeof import("#src/app/managers/permission-manager.js")>(
  "#src/app/managers/permission-manager.ts",
  import.meta.url,
);
const { renameManager } = await loadSut<typeof import("#src/app/managers/rename-manager.js")>(
  "#src/app/managers/rename-manager.ts",
  import.meta.url,
);
import type { Question } from "#src/app/types/question.js";
import type { PermissionRequest } from "#src/app/types/permission.js";

const TEST_QUESTION: Question = {
  header: "Q1",
  question: "Pick one option",
  options: [
    { label: "Yes", description: "accept" },
    { label: "No", description: "decline" },
  ],
};

const TEST_PERMISSION: PermissionRequest = {
  id: "perm-1",
  sessionID: "session-1",
  permission: "bash",
  patterns: ["npm test"],
  metadata: {},
  always: [],
};

describe("app/managers/interaction-cleanup", () => {
  beforeEach(() => {
    clearAllInteractionState("test_setup");
  });

  it("clears all interaction-related managers", () => {
    questionManager.startQuestions([TEST_QUESTION], "req-1");
    permissionManager.startPermission(TEST_PERMISSION, 101);
    renameManager.startWaiting("session-1", "D:/repo", "Old title");
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
      metadata: { sessionId: "session-1" },
    });

    clearAllInteractionState("test_cleanup");

    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("allows starting new interaction after cleanup", () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: { menuKind: "model", messageId: 1 },
    });

    clearAllInteractionState("first_cleanup");

    interactionManager.start({
      kind: "question",
      expectedInput: "callback",
      metadata: { questionIndex: 0 },
    });

    expect(interactionManager.getSnapshot()?.kind).toBe("question");
  });
});
