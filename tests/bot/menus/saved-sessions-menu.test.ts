import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";
import { InlineKeyboard } from "grammy";

const mocked = vi.hoisted(() => ({
  replyWithInlineMenuMock: vi.fn(),
}));

const settingsStoreMock = createSettingsStoreMock();
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);
vi.mock("#src/bot/menus/inline-menu.js", () => ({
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
}));

const {
  buildSavedSessionsDeleteCallback,
  buildSavedSessionsMenuView,
  buildSavedSessionsOpenCallback,
  parseSavedSessionsCallback,
  showSavedSessionsMenu,
} = await loadSut<typeof import("#src/bot/menus/saved-sessions-menu.js")>(
  "#src/bot/menus/saved-sessions-menu.ts",
  import.meta.url,
);

const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

const WORKTREE = "/workspace/project-a";

function createContext(): Context {
  return {
    chat: { id: 42 },
    reply: vi.fn().mockResolvedValue({ message_id: 7 }),
  } as unknown as Context;
}

function buttonLabels(keyboard: InlineKeyboard): string[][] {
  return keyboard.inline_keyboard.map((row) => row.map((button) => button.text));
}

function callbackData(keyboard: InlineKeyboard): Array<string | undefined> {
  return keyboard.inline_keyboard.flat().map((button) => button.callback_data);
}

describe("bot/menus/saved-sessions-menu", () => {
  beforeEach(() => {
    mocked.replyWithInlineMenuMock.mockReset().mockResolvedValue(1);
    settingsStoreMock.getCurrentProject.mockReset().mockReturnValue({
      id: "project-a",
      worktree: WORKTREE,
      name: "project-a",
    });
    settingsStoreMock.getCurrentSession.mockReset().mockReturnValue(undefined);
    settingsStoreMock.getSavedSessions.mockReset().mockReturnValue([]);
    settingsStoreMock.isSessionSaved.mockReset().mockReturnValue(false);
  });

  it("offers to save the current session when it is not bookmarked", () => {
    settingsStoreMock.getCurrentSession.mockReturnValue({
      id: "ses-current",
      title: "Current",
      directory: WORKTREE,
    });

    const { text, keyboard } = buildSavedSessionsMenuView(WORKTREE);

    expect(buttonLabels(keyboard)[0]).toEqual([t("saved.save_current")]);
    expect(callbackData(keyboard)[0]).toBe("saved:save");
    expect(text).toContain(t("saved.title", { count: "0" }));
    expect(text).toContain(t("saved.empty"));
  });

  it("offers to remove the current session when it is already bookmarked", () => {
    settingsStoreMock.getCurrentSession.mockReturnValue({
      id: "ses-current",
      title: "Current",
      directory: WORKTREE,
    });
    settingsStoreMock.isSessionSaved.mockReturnValue(true);

    const { keyboard } = buildSavedSessionsMenuView(WORKTREE);

    expect(buttonLabels(keyboard)[0]).toEqual([t("saved.remove_current")]);
    expect(callbackData(keyboard)[0]).toBe("saved:unsave");
  });

  it("lists saved sessions with open and delete buttons", () => {
    settingsStoreMock.getSavedSessions.mockReturnValue([
      { id: "ses-one", title: "First work", directory: WORKTREE },
      {
        id: "ses-two",
        title: "A very long session title that should be truncated somewhere",
        directory: WORKTREE,
      },
    ]);

    const { text, keyboard } = buildSavedSessionsMenuView(WORKTREE);
    const labels = buttonLabels(keyboard);

    expect(labels[0]?.[0]).toBe("▶️ 1. First work");
    expect(labels[1]?.[0]).toContain("A very long session title");
    expect(labels[1]?.[0]?.endsWith("…")).toBe(true);
    expect(labels[0]?.[1]).toBe("🗑");
    expect(callbackData(keyboard)).toContain(buildSavedSessionsOpenCallback("ses-two"));
    expect(callbackData(keyboard)).toContain(buildSavedSessionsDeleteCallback("ses-two"));
    expect(text).toContain(t("saved.title", { count: "2" }));
    expect(text).toContain(t("saved.hint"));
  });

  it("hides the save button when the current session belongs to another project", () => {
    settingsStoreMock.getCurrentSession.mockReturnValue({
      id: "ses-other",
      title: "Other project",
      directory: "/workspace/project-b",
    });

    const { keyboard } = buildSavedSessionsMenuView(WORKTREE);

    expect(callbackData(keyboard)).not.toContain("saved:save");
  });

  it("parses its own callbacks only", () => {
    expect(parseSavedSessionsCallback("saved:save")).toEqual({ action: "save", sessionId: null });
    expect(parseSavedSessionsCallback("saved:open:ses-1")).toEqual({
      action: "open",
      sessionId: "ses-1",
    });
    expect(parseSavedSessionsCallback("saved:delete:ses-1")).toEqual({
      action: "delete",
      sessionId: "ses-1",
    });
    expect(parseSavedSessionsCallback("saved:open:")).toBeNull();
    expect(parseSavedSessionsCallback("queue:delete:queued-1")).toBeNull();
  });

  it("opens the menu for the current project", async () => {
    const ctx = createContext();

    await expect(showSavedSessionsMenu(ctx)).resolves.toBe(true);

    expect(mocked.replyWithInlineMenuMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ menuKind: "saved" }),
    );
  });

  it("asks for a project before opening the menu without one", async () => {
    settingsStoreMock.getCurrentProject.mockReturnValue(undefined);
    const ctx = createContext();

    await expect(showSavedSessionsMenu(ctx)).resolves.toBe(false);

    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("sessions.select_project_first"));
  });
});
