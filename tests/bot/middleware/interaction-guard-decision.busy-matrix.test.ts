import { beforeEach, describe, expect, it } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
const { resolveInteractionGuardDecision } = await loadSut<typeof import("#src/bot/middleware/interaction-guard-decision.js")>(
  "#src/bot/middleware/interaction-guard-decision.ts",
  import.meta.url,
);
const { interactionManager } = await loadSut<typeof import("#src/app/managers/interaction-manager.js")>(
  "#src/app/managers/interaction-manager.ts",
  import.meta.url,
);
const { foregroundSessionState } = await loadSut<typeof import("#src/app/managers/foreground-session-state-manager.js")>(
  "#src/app/managers/foreground-session-state-manager.ts",
  import.meta.url,
);

// Regression net for the saved-sessions busy gate: only the queue and saved
// menus may pass the busy branch, and no other inline menu kind may join them.
const BUSY_BLOCKED_MENU_KINDS = [
  "agent",
  "context",
  "ls",
  "model",
  "open",
  "project",
  "session",
  "settings",
  "variant",
  "worktree",
] as const;

function createContext({
  text,
  callbackData,
  document,
}: {
  text?: string;
  callbackData?: string;
  document?: boolean;
}): Context {
  const message: Record<string, unknown> = {};

  if (text !== undefined) {
    message.text = text;
  }

  if (document) {
    message.document = { file_id: "doc-file-id" };
  }

  return {
    message:
      Object.keys(message).length > 0 ? (message as unknown as Context["message"]) : undefined,
    callbackQuery:
      callbackData !== undefined ? ({ data: callbackData } as Context["callbackQuery"]) : undefined,
  } as Context;
}

function startInlineMenu(menuKind: string): void {
  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: { menuKind, messageId: 5 },
  });
}

describe("interaction guard busy matrix", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    foregroundSessionState.__resetForTests();
  });

  it("keeps every inline menu other than queue and saved blocked while busy", () => {
    for (const menuKind of BUSY_BLOCKED_MENU_KINDS) {
      interactionManager.clear("test_setup");
      foregroundSessionState.__resetForTests();
      foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
      startInlineMenu(menuKind);

      const decision = resolveInteractionGuardDecision(
        createContext({ callbackData: `${menuKind}:action:1` }),
      );

      expect({ menuKind, allow: decision.allow, busy: decision.busy }).toEqual({
        menuKind,
        allow: false,
        busy: true,
      });
    }
  });

  it("blocks saved-menu callbacks when the saved menu is not the active one", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    startInlineMenu("queue");

    const decision = resolveInteractionGuardDecision(createContext({ callbackData: "saved:open:s1" }));

    // Allowed by the busy branch (queue menu is busy-allowed), but the saved
    // handler itself drops it through ensureActiveInlineMenu; the guard alone
    // must not treat a stale saved menu as active.
    expect(decision.allow).toBe(true);
    expect(decision.busy).toBe(true);

    interactionManager.clear("test_setup");
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const withoutMenu = resolveInteractionGuardDecision(
      createContext({ callbackData: "saved:open:s1" }),
    );

    expect(withoutMenu.allow).toBe(false);
    expect(withoutMenu.busy).toBe(true);
  });

  it("keeps /sessions and /projects blocked while busy", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    for (const command of ["/sessions", "/projects"]) {
      const decision = resolveInteractionGuardDecision(createContext({ text: command }));

      expect({ command, allow: decision.allow, reason: decision.reason, busy: decision.busy }).toEqual(
        { command, allow: false, reason: "command_not_allowed", busy: true },
      );
    }
  });

  it("keeps prompts, documents, and orphan callbacks blocked while busy", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const textDecision = resolveInteractionGuardDecision(createContext({ text: "hello there" }));
    const documentDecision = resolveInteractionGuardDecision(createContext({ document: true }));
    const callbackDecision = resolveInteractionGuardDecision(
      createContext({ callbackData: "saved:open:s1" }),
    );

    expect(textDecision.allow).toBe(false);
    expect(textDecision.busy).toBe(true);
    expect(documentDecision.allow).toBe(false);
    expect(documentDecision.busy).toBe(true);
    expect(callbackDecision.allow).toBe(false);
    expect(callbackDecision.busy).toBe(true);
  });

  it("does not let the saved-sessions button hijack a pending question", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    interactionManager.start({
      kind: "question",
      expectedInput: "callback",
    });

    const decision = resolveInteractionGuardDecision(createContext({ text: "⭐ Sessions" }));

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("expected_callback");
    expect(decision.busy).toBe(true);
  });
});
