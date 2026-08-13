import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import type { PhotoHandlerDeps } from "#src/bot/handlers/photo-handler.js";

const flushPendingPromptMock = vi.hoisted(() => vi.fn());

vi.mock("#src/bot/handlers/message-merger.ts", () => ({
  flushPendingPrompt: flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));

const configMock = {
  telegram: {
    token: "bot-token-xyz",
    allowedUserId: 123456789,
    apiRoot: "",
    proxyUrl: "",
    proxySecret: "",
    forceIpv4: false,
  },
  opencode: {
    apiUrl: "http://localhost:4096",
    username: "opencode",
    password: "",
    autoRestartEnabled: false,
    monitorIntervalSec: 300,
    model: {
      provider: "test-provider",
      modelId: "test-model",
    },
  },
  server: {
    logLevel: "info",
  },
  bot: {
    sessionsListLimit: 10,
    messagesListLimit: 10,
    projectsListLimit: 10,
    commandsListLimit: 10,
    taskLimit: 10,
    scheduledTaskExecutionTimeoutMinutes: 120,
    scheduledTaskNotificationsSilent: false,
    responseStreamThrottleMs: 1000,
    responseStreamingMode: "edit",
    bashToolDisplayMaxLength: 128,
    locale: "en",
    hideThinkingMessages: false,
    hideToolCallMessages: false,
    hideToolFileMessages: false,
    trackBackgroundSessions: true,
    messageFormatMode: "markdown",
  },
  files: {
    maxFileSizeKb: 100,
  },
  open: {
    browserRoots: "",
  },
  stt: {
    apiUrl: "",
    apiKey: "",
    model: "whisper-large-v3-turbo",
    language: "",
    notePrompt: "",
  },
  vision: {
    apiUrl: "http://127.0.0.1:8082/v1",
    model: "lfm2.5-vl-3b",
  },
  tts: {
    apiUrl: "",
    apiKey: "",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    voice: "alloy",
  },
};;

vi.mock("#src/config.ts", () => ({
  config: configMock,
}));

async function getSut() {
  return loadSut<typeof import("#src/bot/handlers/photo-handler.js")>(
    "#src/bot/handlers/photo-handler.ts",
    import.meta.url,
  );
}

async function getT() {
  return loadSut<typeof import("#src/i18n/index.js")>("#src/i18n/index.ts", import.meta.url);
}

function createPhotoContext(caption = "Describe this"): { ctx: Context; replyMock: ReturnType<typeof vi.fn> } {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 100 });
  const ctx = {
    chat: { id: 777 },
    message: {
      caption,
      photo: [
        { file_id: "small-photo", file_unique_id: "small", width: 320, height: 240 },
        { file_id: "large-photo", file_unique_id: "large", width: 1280, height: 960 },
      ],
    },
    reply: replyMock,
    api: {},
  } as unknown as Context;

  return { ctx, replyMock };
}

function createDeps(overrides: Partial<PhotoHandlerDeps> = {}): {
  deps: PhotoHandlerDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  getCapabilitiesMock: ReturnType<typeof vi.fn>;
  describeImageMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("photo-bytes"),
    filePath: "photos/file.jpg",
  });
  const getCapabilitiesMock = vi.fn().mockResolvedValue({ input: { image: true } });
  const describeImageMock = vi
    .fn()
    .mockResolvedValue({ ok: true, description: "A photo showing a salon booking." });
  const deps: PhotoHandlerDeps = {
    bot: {} as PhotoHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    getModelCapabilities: getCapabilitiesMock,
    getStoredModel: vi.fn(() => ({ providerID: "test-provider", modelID: "test-model" })),
    processPrompt: processPromptMock,
    describeImage: describeImageMock,
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, getCapabilitiesMock, describeImageMock };
}

describe("bot/handlers/photo-handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    flushPendingPromptMock.mockClear();
  });

  it("downloads the largest photo and sends it as a file part", async () => {
    const { ctx, replyMock } = createPhotoContext();
    const { deps, processPromptMock, downloadMock } = createDeps();

    const { handlePhotoMessage } = await getSut();
    await handlePhotoMessage(ctx, deps);

    expect(flushPendingPromptMock).toHaveBeenCalledWith(777);
    expect(replyMock).toHaveBeenCalledWith((await getT()).t("bot.photo_downloading"));
    expect(downloadMock).toHaveBeenCalledWith(ctx.api, "large-photo");
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      "Describe this",
      deps,
      [
        expect.objectContaining({
          type: "file",
          mime: "image/jpeg",
          filename: "photo.jpg",
          url: expect.stringMatching(/^data:image\/jpeg;base64,/),
        }),
      ],
    );
  });

  it("describes the photo with the local vision model when the model does not support images", async () => {
    const { ctx, replyMock } = createPhotoContext("Use this caption");
    const { deps, processPromptMock, downloadMock, describeImageMock } = createDeps({
      getModelCapabilities: vi.fn().mockResolvedValue({ input: { image: false } }),
    });

    const { handlePhotoMessage } = await getSut();
    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith((await getT()).t("bot.photo_vision_describing"));
    expect(downloadMock).toHaveBeenCalledWith(ctx.api, "large-photo");
    expect(describeImageMock).toHaveBeenCalledWith(Buffer.from("photo-bytes"), "image/jpeg");
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining("Use this caption"),
      deps,
    );
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining("A photo showing a salon booking."),
      deps,
    );
  });

  it("reports an error when the local vision service is unavailable", async () => {
    const { ctx, replyMock } = createPhotoContext("Use this caption");
    const { deps, processPromptMock } = createDeps({
      getModelCapabilities: vi.fn().mockResolvedValue({ input: { image: false } }),
      describeImage: vi.fn().mockResolvedValue({ ok: false, error: "fetch failed" }),
    });

    const { handlePhotoMessage } = await getSut();
    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith((await getT()).t("bot.photo_vision_fallback_error"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("describes a photo without caption using only the local vision text", async () => {
    const { ctx } = createPhotoContext("");
    const { deps, processPromptMock } = createDeps({
      getModelCapabilities: vi.fn().mockResolvedValue({ input: { image: false } }),
    });

    const { handlePhotoMessage } = await getSut();
    await handlePhotoMessage(ctx, deps);

    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      expect.not.stringContaining("Caption"),
      deps,
    );
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining("A photo showing a salon booking."),
      deps,
    );
  });
});
