import { describe, expect, it } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { formatModelForButton, formatModelForDisplay } = await loadSut<typeof import("#src/app/types/model.js")>(
  "#src/app/types/model.ts",
  import.meta.url,
);

describe("model/types", () => {
  it("formats model for button without truncation", () => {
    expect(formatModelForButton("openai", "gpt-4o")).toBe("🤖 openai\ngpt-4o");
  });

  it("truncates model for button when text is too long", () => {
    const result = formatModelForButton(
      "very-long-provider-name",
      "very-long-model-name-v2-preview",
    );

    expect(result.startsWith("🤖 ")).toBe(true);
    expect(result.endsWith("...")).toBe(true);
    expect(result).toBe("🤖 very-long-pr...\nvery-long-model-n...");
  });

  it("formats model for display", () => {
    expect(formatModelForDisplay("anthropic", "claude-sonnet")).toBe("anthropic / claude-sonnet");
  });
});
