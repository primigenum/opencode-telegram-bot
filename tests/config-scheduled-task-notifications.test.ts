import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { createConfig } = await loadSut<typeof import("#src/config.js")>(
  "#src/config.ts",
  import.meta.url,
);

describe("config scheduled task notifications", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("SCHEDULED_TASK_DISABLE_NOTIFICATION", "");
  });

  it("keeps scheduled task notifications enabled by default", () => {
    const config = createConfig(process.env);

    expect(config.bot.scheduledTaskNotificationsSilent).toBe(false);
  });

  it("parses SCHEDULED_TASK_DISABLE_NOTIFICATION as a boolean", () => {
    vi.stubEnv("SCHEDULED_TASK_DISABLE_NOTIFICATION", "true");

    const config = createConfig(process.env);

    expect(config.bot.scheduledTaskNotificationsSilent).toBe(true);
  });

  it("falls back to enabled notifications on invalid values", () => {
    vi.stubEnv("SCHEDULED_TASK_DISABLE_NOTIFICATION", "banana");

    const config = createConfig(process.env);

    expect(config.bot.scheduledTaskNotificationsSilent).toBe(false);
  });
});
