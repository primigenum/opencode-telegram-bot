import { afterEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const _$rt = globalThis.setTimeout;

function accelerateTime(): { restore: () => void } {
  const _origDn = Date.now;
  let _ft = _origDn();
  Date.now = () => _ft;
  globalThis.setTimeout = ((cb: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if ((ms ?? 0) > 0) _ft += ms!;
    return _$rt(cb, 0, ...args);
  }) as typeof globalThis.setTimeout;
  return {
    restore() {
      globalThis.setTimeout = _$rt;
      Date.now = _origDn;
    },
  };
}

const { getTelegramRetryAfterMs, withTelegramRateLimitRetry } = await loadSut<typeof import("#src/utils/telegram-rate-limit-retry.js")>(
  "#src/utils/telegram-rate-limit-retry.ts",
  import.meta.url,
);

describe("utils/telegram-rate-limit-retry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("extracts retry delay from Telegram error parameters", () => {
    const retryAfterMs = getTelegramRetryAfterMs({
      error_code: 429,
      parameters: {
        retry_after: 3,
      },
    });

    expect(retryAfterMs).toBe(3000);
  });

  it("retries failed operations with Telegram retry_after", async () => {
    const { restore } = accelerateTime();
    try {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("429: Too Many Requests: retry after 1"))
        .mockResolvedValueOnce("ok");

      const promise = withTelegramRateLimitRetry(operation, { maxRetries: 2 });

      await new Promise((r) => setTimeout(r, 0)); // yield for accelerated timeouts

      await expect(promise).resolves.toBe("ok");
      expect(operation).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it("does not retry non-rate-limit errors", async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error("400: Bad Request"));

    await expect(withTelegramRateLimitRetry(operation, { maxRetries: 2 })).rejects.toThrow(
      "400: Bad Request",
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
