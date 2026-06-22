import { afterEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";

// Capture real timer refs at module level (before vi.useFakeTimers can override).
const _$rt = globalThis.setTimeout;

const { ToolCallStreamer } = await loadSut<typeof import("#src/bot/streaming/tool-call-streamer.js")>(
  "#src/bot/streaming/tool-call-streamer.ts",
  import.meta.url,
);

/**
 * Patch setTimeout to fire on the next microtask (0 real delay) while
 * advancing a fake Date.now clock by the requested delay. Returns a
 * restore() function callable in `finally` to revert globals.
 * Uses the module-level real setTimeout reference so it works regardless
 * of bun's useFakeTimers state.
 */
function accelerateTime(): { restore: () => void } {
  const _rt = _$rt;
  const _origDn = Date.now;
  let _ft = _origDn();
  Date.now = () => _ft;
  globalThis.setTimeout = ((cb: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if ((ms ?? 0) > 0) _ft += ms!;
    return _rt(cb, 0, ...args);
  }) as typeof globalThis.setTimeout;
  return {
    restore() {
      globalThis.setTimeout = _rt;
      Date.now = _origDn;
    },
  };
}

describe("bot/streaming/tool-call-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles tool updates and sends the combined latest text", async () => {
    const { restore } = accelerateTime();
    try {
      let nextMessageId = 1;
      const sendText = vi.fn(async () => nextMessageId++);
      const editText = vi.fn().mockResolvedValue(undefined);
      const deleteText = vi.fn().mockResolvedValue(undefined);
      const streamer = new ToolCallStreamer({
        throttleMs: 200,
        sendText,
        editText,
        deleteText,
      });

      streamer.append("s1", "first");
      streamer.append("s1", "second");

      await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1), { timeout: 1000 });

      expect(sendText).toHaveBeenCalledWith("s1", "first\n\nsecond");
      expect(editText).not.toHaveBeenCalled();
      expect(deleteText).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("edits the existing streamed message when new tool lines arrive", async () => {
    const { restore } = accelerateTime();
    try {
    const sendText = vi.fn().mockResolvedValue(10);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "first");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "second");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    expect(editText).toHaveBeenCalledWith("s1", 10, "first\n\nsecond");
    } finally {
      restore();
    }
  });

  it("keeps todo updates in a separate message stream", async () => {
    const { restore } = accelerateTime();
    try {
    const sendText = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "regular tool");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "todo tool", "todo");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    streamer.append("s1", "regular tool update");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "regular tool");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "todo tool");
    expect(editText).toHaveBeenCalledWith("s1", 10, "regular tool\n\nregular tool update");
    } finally {
      restore();
    }
  });

  it("keeps subagent updates in a separate replace-by-prefix stream", async () => {
    const { restore } = accelerateTime();
    try {
    const sendText = vi.fn().mockResolvedValueOnce(20).mockResolvedValueOnce(21);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "regular tool");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "subagent", "subagent card", "subagent");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    streamer.replaceByPrefix("s1", "subagent", "subagent card updated", "subagent");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "regular tool");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "subagent card");
    expect(editText).toHaveBeenCalledWith("s1", 21, "subagent card updated");
    } finally {
      restore();
    }
  });

  it("creates continuation messages when the stream exceeds Telegram limits", async () => {
    const { restore } = accelerateTime();
    try {
    let nextMessageId = 100;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "a".repeat(3000));
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "b".repeat(3000));
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(editText).toHaveBeenCalledTimes(1);
    for (const call of sendText.mock.calls) {
      const [, text] = call as unknown as [string, string];
      expect(text.length).toBeLessThanOrEqual(4000);
    }
    } finally {
      restore();
    }
  });

  it("replaces retry text by prefix inside the active stream", async () => {
    const { restore } = accelerateTime();
    try {
    const sendText = vi.fn().mockResolvedValue(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "tool one");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "🔁", "🔁 Retry attempt 1");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    streamer.replaceByPrefix("s1", "🔁", "🔁 Retry attempt 2");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(2);
    });

    expect(editText).toHaveBeenLastCalledWith("s1", 1, "tool one\n\n🔁 Retry attempt 2");
    } finally {
      restore();
    }
  });

  it("starts a new tool stream after a file boundary break", async () => {
    const { restore } = accelerateTime();
    try {
    let nextMessageId = 50;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "before file");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    await streamer.breakSession("s1", "tool_file_boundary");

    streamer.append("s1", "after file");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "after file");
    } finally {
      restore();
    }
  });

  it("starts a new tool stream after an assistant reply boundary break", async () => {
    const { restore } = accelerateTime();
    try {
    let nextMessageId = 60;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "before reply");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    await streamer.breakSession("s1", "assistant_message_completed");

    streamer.append("s1", "after reply");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "after reply");
    } finally {
      restore();
    }
  });

  it("flushes all stream keys for the same session", async () => {
    const { restore } = accelerateTime();
    try {
    const sendText = vi.fn().mockResolvedValueOnce(30).mockResolvedValueOnce(31);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 200,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "regular tool");
    streamer.append("s1", "todo tool", "todo");

    await streamer.flushSession("s1", "manual_flush");

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "regular tool");
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "todo tool");
    } finally {
      restore();
    }
  });

  it("cancels throttled tool sends when clearing all streams", async () => {
    const { restore } = accelerateTime();
    try {
    const sendText = vi.fn().mockResolvedValue(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 200,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "pending");
    streamer.clearAll("abort_command");

    await vi.advanceTimersByTimeAsync(500);

    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("cancels retry-after resend when the session is cleared", async () => {
    const { restore } = accelerateTime();
    try {
    const sendText = vi
      .fn()
      .mockRejectedValueOnce(new Error("429: retry after 1"))
      .mockResolvedValueOnce(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "hello");
    // First macrotask: first send completes and schedules retry
    await new Promise((r) => setTimeout(r, 0));

    // Cancel the session BEFORE the retry fires
    streamer.clearSession("s1", "abort_command");

    // Second macrotask: retry fires but sees cancelled=true
    await new Promise((r) => setTimeout(r, 0));

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("routes new tool calls into a fresh stream while a break flush is still finishing", async () => {
    const { restore } = accelerateTime();
    try {
    const editResolution: { current: null | (() => void) } = { current: null };
    const sendText = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11);
    const editText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          editResolution.current = resolve;
        }),
    );
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.append("s1", "before break");
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.append("s1", "forces edit");
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    const breakPromise = streamer.breakSession("s1", "thinking_started");
    streamer.append("s1", "after break");

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    if (editResolution.current) {
      editResolution.current();
    }
    await expect(breakPromise).resolves.toBeUndefined();

    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "after break");
    } finally {
      restore();
    }
  });
});
