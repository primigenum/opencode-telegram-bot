import { describe, expect, it } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { createTelegramBotOptions } = await loadSut<typeof import("#src/bot/telegram-client-options.js")>(
  "#src/bot/telegram-client-options.ts",
  import.meta.url,
);

function makeTelegramConfig(overrides: Partial<Parameters<typeof createTelegramBotOptions>[0]> = {}) {
  return {
    apiRoot: "",
    proxySecret: "",
    proxyUrl: "",
    forceIpv4: false,
    ...overrides,
  };
}

describe("createTelegramBotOptions", () => {
  it("does not configure an agent for direct Telegram API requests by default", () => {
    const options = createTelegramBotOptions(makeTelegramConfig());

    expect(options.client).toBeUndefined();
  });

  it("sets compress flag when IPv4 mode is enabled (Bun has no agent-level IPv4 pinning)", () => {
    const options = createTelegramBotOptions(makeTelegramConfig({ forceIpv4: true }));

    expect(options.client?.baseFetchConfig?.compress).toBe(true);
    // Bun's native fetch doesn't expose agent-level IPv4 enforcement
    expect(options.client?.baseFetchConfig?.agent).toBeUndefined();
  });

  it("keeps reverse-proxy options when IPv4 mode is enabled", () => {
    const options = createTelegramBotOptions(
      makeTelegramConfig({
        apiRoot: "https://tg-proxy.example.com",
        proxySecret: "secret-abc",
        forceIpv4: true,
      }),
    );

    expect(options.client?.apiRoot).toBe("https://tg-proxy.example.com");
    expect(options.client?.fetch).toBeTypeOf("function");
    expect(options.client?.baseFetchConfig?.compress).toBe(true);
    expect(options.client?.baseFetchConfig?.agent).toBeUndefined();
  });

  it("keeps forward proxy wiring when IPv4 mode is also enabled", () => {
    const options = createTelegramBotOptions(
      makeTelegramConfig({
        proxyUrl: "https://proxy.example.com:8443",
        forceIpv4: true,
      }),
    );

    expect(options.client?.baseFetchConfig?.proxy).toBe("https://proxy.example.com:8443");
    expect(options.client?.baseFetchConfig?.compress).toBe(true);
  });
});
