import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactProgressStreamer } from "../../../src/bot/streaming/compact-progress-streamer.js";

describe("bot/streaming/compact-progress-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends one progress message and finalizes it in place", async () => {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    streamer.updateThinking("s1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\n💭 Thinking...");
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith(
      "s1",
      10,
      "✅ Finished Work\ntool calls: 0 · changed files: 0",
    );
  });

  it("counts unique tool calls and changed files", async () => {
    const sendText = vi.fn().mockResolvedValue(20);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 100, sendText, editText });

    streamer.updateActivity("s1", "working");
    streamer.addToolCall("s1", "call-1");
    streamer.addToolCall("s1", "call-1");
    streamer.addToolCall("s1", "call-2");
    streamer.addFileChange("s1", "src/a.ts");
    streamer.addFileChange("s1", "src/a.ts");
    streamer.addFileChange("s1", "src/b.ts");

    await streamer.finalize("s1");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(
      "s1",
      "✅ Finished Work\ntool calls: 2 · changed files: 2",
    );
    expect(editText).not.toHaveBeenCalled();
  });

  it("does not create a message when finalizing an inactive session", async () => {
    const sendText = vi.fn().mockResolvedValue(20);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 0, sendText, editText });

    await streamer.finalize("s1");

    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
  });

  it("throttles progress edits", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(30);
    const editText = vi.fn().mockResolvedValue(undefined);
    const streamer = new CompactProgressStreamer({ throttleMs: 100, sendText, editText });

    streamer.updateActivity("s1", "first");
    streamer.updateActivity("s1", "second");

    expect(sendText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "⏳ Working\nsecond");
  });
});
