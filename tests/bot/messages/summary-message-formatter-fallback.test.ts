import { beforeEach, describe, expect, it, vi } from "#vitest";
import { mockDep } from "#helpers/mock-dep.js";
import { loadSut } from "#helpers/sut-loader.js";

const mocked = {
  convertToTelegramMarkdownV2: vi.fn(),
};

mockDep(
  "#src/bot/render/markdown-to-telegram-v2.ts",
  () => ({
    convertToTelegramMarkdownV2: mocked.convertToTelegramMarkdownV2,
  }),
  import.meta.url,
);

const sut = loadSut<typeof import("#src/bot/messages/summary-message-formatter.js")>(
  "#src/bot/messages/summary-message-formatter.ts",
  import.meta.url,
);

describe("bot/messages/summary-message-formatter markdown fallback", () => {
  beforeEach(() => {
    mocked.convertToTelegramMarkdownV2.mockReset();
  });

  it("keeps summary delivery alive when markdown conversion fails", async () => {
    mocked.convertToTelegramMarkdownV2.mockImplementation(() => {
      throw new Error("conversion failed");
    });

    expect(sut.formatSummaryWithMode("**raw** text!", "markdown")).toEqual(["**raw** text!"]);
    expect(mocked.convertToTelegramMarkdownV2).toHaveBeenCalledOnce();
  });
});
