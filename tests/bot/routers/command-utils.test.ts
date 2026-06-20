import { describe, expect, it } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { extractCommandName, isKnownCommand } = await loadSut<typeof import("#src/bot/routers/command-utils.js")>(
  "#src/bot/routers/command-utils.ts",
  import.meta.url,
);

describe("bot/routers/command-utils", () => {
  it("extracts command name from slash command", () => {
    expect(extractCommandName("/status")).toBe("status");
    expect(extractCommandName("/help@MyBot")).toBe("help");
    expect(extractCommandName("/model openai")).toBe("model");
  });

  it("returns null for non-command text", () => {
    expect(extractCommandName("hello")).toBeNull();
    expect(extractCommandName(" /")).toBeNull();
  });

  it("checks known commands set", () => {
    expect(isKnownCommand("status")).toBe(true);
    expect(isKnownCommand("start")).toBe(true);
    expect(isKnownCommand("detach")).toBe(true);
    expect(isKnownCommand("skills")).toBe(true);
    expect(isKnownCommand("foobar")).toBe(false);
  });
});
