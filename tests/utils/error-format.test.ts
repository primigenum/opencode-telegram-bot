import { describe, expect, it } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { formatErrorDetails } = await loadSut<typeof import("#src/utils/error-format.js")>(
  "#src/utils/error-format.ts",
  import.meta.url,
);

describe("utils/error-format", () => {
  it("formats Error instances using stack or message", () => {
    const error = new Error("boom");
    const details = formatErrorDetails(error);

    expect(details).toContain("boom");
  });

  it("returns fallback text for empty object-like errors", () => {
    expect(formatErrorDetails({})).toBe("unknown error");
  });

  it("clips very long error details", () => {
    const details = formatErrorDetails("x".repeat(100), 16);

    expect(details).toHaveLength(16);
    expect(details.endsWith("...")).toBe(true);
  });
});
