import { describe, expect, it } from "#vitest";
import {
  MAX_SESSION_TITLE_LENGTH,
  deriveTitleFromPrompt,
  isDefaultSessionTitle,
} from "#src/app/utils/session-title.js";

describe("app/utils/session-title", () => {
  describe("isDefaultSessionTitle", () => {
    it("matches the server placeholders", () => {
      expect(isDefaultSessionTitle("New session - 2026-10-01T10:00:00.000Z")).toBe(true);
      expect(isDefaultSessionTitle("Child session - 2026-10-01T10:00:00.000Z")).toBe(true);
    });

    it("rejects real titles and near-miss placeholders", () => {
      expect(isDefaultSessionTitle("Fix the login bug")).toBe(false);
      expect(isDefaultSessionTitle("New session")).toBe(false);
      // Starts like the placeholder but the timestamp is not the strict ISO form.
      expect(isDefaultSessionTitle("New session - 2026-10-01T10:00:00Z")).toBe(false);
      expect(isDefaultSessionTitle("New session - yesterday")).toBe(false);
      expect(isDefaultSessionTitle("My New session - 2026-10-01T10:00:00.000Z")).toBe(false);
    });

    // Titles captured from the live OpenCode server (GET /session) on
    // 2026-10-01, all still holding the placeholder: the strict pattern must
    // keep recognising the real format, not just a hand-written sample.
    it("matches the placeholder format actually observed on the server", () => {
      for (const title of [
        "New session - 2026-09-26T15:22:47.443Z",
        "New session - 2026-09-26T15:22:21.907Z",
        "New session - 2026-09-18T09:08:47.024Z",
        "New session - 2026-09-18T09:08:42.889Z",
        "New session - 2026-09-10T06:20:51.719Z",
      ]) {
        expect(isDefaultSessionTitle(title)).toBe(true);
      }
    });
  });

  describe("deriveTitleFromPrompt", () => {
    it("uses the first non-empty line of a multiline prompt", () => {
      expect(deriveTitleFromPrompt("\n\nFix the login bug\nmore context")).toBe(
        "Fix the login bug",
      );
    });

    it("collapses internal whitespace", () => {
      expect(deriveTitleFromPrompt("Fix   the\t\tlogin    bug")).toBe("Fix the login bug");
    });

    it("returns null for empty or whitespace-only text", () => {
      expect(deriveTitleFromPrompt("")).toBeNull();
      expect(deriveTitleFromPrompt("   \n\t  ")).toBeNull();
    });

    it("keeps short titles untouched", () => {
      expect(deriveTitleFromPrompt("Review README")).toBe("Review README");
    });

    it("truncates long titles on a word boundary with an ellipsis", () => {
      const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi";
      const title = deriveTitleFromPrompt(text);

      expect(title).not.toBeNull();
      expect(title!.endsWith("…")).toBe(true);
      expect(title!.length).toBeLessThanOrEqual(MAX_SESSION_TITLE_LENGTH);
      expect(title!.slice(0, -1).endsWith(" ")).toBe(false);
      expect(title).toBe("alpha beta gamma delta epsilon zeta eta theta iota kappa…");
    });

    it("truncates unbroken text without a word boundary", () => {
      const title = deriveTitleFromPrompt("x".repeat(200));

      expect(title).toBe(`${"x".repeat(MAX_SESSION_TITLE_LENGTH - 1)}…`);
      expect(title!.length).toBe(MAX_SESSION_TITLE_LENGTH);
    });

    it("keeps a title that is exactly at the cap and truncates one char more", () => {
      const exact = "a".repeat(MAX_SESSION_TITLE_LENGTH);
      expect(deriveTitleFromPrompt(exact)).toBe(exact);

      const over = `${"a".repeat(MAX_SESSION_TITLE_LENGTH)} b`;
      const title = deriveTitleFromPrompt(over);

      expect(title).toBe(`${"a".repeat(MAX_SESSION_TITLE_LENGTH - 1)}…`);
      expect(title!.length).toBe(MAX_SESSION_TITLE_LENGTH);
    });

    it("never exceeds the cap when the first word alone fills the window", () => {
      const title = deriveTitleFromPrompt(`${"z".repeat(70)} short tail`);

      expect(title).toBe(`${"z".repeat(MAX_SESSION_TITLE_LENGTH - 1)}…`);
      expect(title!.length).toBe(MAX_SESSION_TITLE_LENGTH);
    });

    it("does not leave a dangling space before the ellipsis", () => {
      const title = deriveTitleFromPrompt("one two three four five six seven eight nine ten");

      expect(title!.length).toBeLessThanOrEqual(MAX_SESSION_TITLE_LENGTH);
      expect(title!.slice(0, -1).endsWith(" ")).toBe(false);
    });

    it("splits on CRLF too", () => {
      expect(deriveTitleFromPrompt("first line\r\nsecond line")).toBe("first line");
    });

    it("never leaves a dangling surrogate when truncating emojis", () => {
      const title = deriveTitleFromPrompt(`${"👍".repeat(50)} tail words here`);

      expect(title).not.toBeNull();
      expect(title!.endsWith("…")).toBe(true);
      expect(title!.length).toBeLessThanOrEqual(MAX_SESSION_TITLE_LENGTH);
      // Strip well-formed surrogate pairs; any surrogate left is a broken one.
      const withoutPairs = title!.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
      expect(/[\uD800-\uDFFF]/.test(withoutPairs)).toBe(false);
    });

    it("keeps a short emoji title untouched", () => {
      expect(deriveTitleFromPrompt("👍👍 deploy the fix")).toBe("👍👍 deploy the fix");
    });
  });
});
