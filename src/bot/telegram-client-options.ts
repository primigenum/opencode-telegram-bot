import type { Bot, Context } from "grammy";
import { logger } from "../utils/logger.js";

export interface TelegramClientConfig {
  apiRoot: string;
  proxySecret: string;
  proxyUrl: string;
  forceIpv4: boolean;
}

export type TelegramBotOptions = NonNullable<ConstructorParameters<typeof Bot<Context>>[1]>;

export function createTelegramBotOptions(telegram: TelegramClientConfig): TelegramBotOptions {
  const botOptions: TelegramBotOptions = {};

  if (telegram.apiRoot || telegram.proxySecret) {
    botOptions.client = botOptions.client ?? {};
    if (telegram.apiRoot) {
      botOptions.client.apiRoot = telegram.apiRoot;
      logger.info(`[Bot] Using custom Telegram API root: ${telegram.apiRoot}`);
    }
    if (telegram.proxySecret) {
      // Inject the shared-secret header via a custom fetch wrapper instead of
      // baseFetchConfig.headers, because grammY's client spreads
      // `{...baseFetchConfig, ...config}` and the per-request config.headers
      // (Content-Type/Length) wipes out anything we put on baseFetchConfig.
      const proxySecret = telegram.proxySecret;
      botOptions.client.fetch = (
        url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const existing = (init?.headers as Record<string, string> | undefined) ?? {};
        const merged = { ...existing, "X-Proxy-Secret": proxySecret };
        return fetch(url, { ...init, headers: merged });
      };
      logger.info(`[Bot] Sending X-Proxy-Secret header to Telegram API root`);
    }
  }

  if (telegram.proxyUrl) {
    const proxyUrl = telegram.proxyUrl;

    if (proxyUrl.startsWith("socks")) {
      logger.warn(
        `[Bot] SOCKS proxy (${proxyUrl.replace(/\/\/.*@/, "//***@")}) is not supported by Bun's fetch — falling back to direct connection`,
      );
    } else {
      logger.info(`[Bot] Using HTTP/HTTPS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
      botOptions.client = botOptions.client ?? {};
      botOptions.client.baseFetchConfig = {
        proxy: proxyUrl,
        compress: true,
      };
    }
  } else if (telegram.forceIpv4) {
    // Bun's native fetch doesn't expose an IPv4-enforcement option.
    // If DNS resolution prefers IPv6, consider setting `--network-preference ipv4`
    // or configuring the system resolver.
    botOptions.client = botOptions.client ?? {};
    botOptions.client.baseFetchConfig = {
      ...(botOptions.client.baseFetchConfig ?? {}),
      compress: true,
    };
    logger.info(`[Bot] IPv4 enforcement requested — Bun does not support agent-level IPv4 pinning`);
  }

  return botOptions;
}
