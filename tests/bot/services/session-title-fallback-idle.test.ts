import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "#vitest";
import type { Bot, Context } from "grammy";
import type { Event } from "@opencode-ai/sdk/v2";
import { setRuntimeMode } from "../../../src/runtime/mode.js";
import { resetSingletonState } from "../../helpers/reset-singleton-state.js";

/**
 * Verifies the session-idle hook of the title fallback end to end through the
 * real event pipeline: real summaryAggregator -> real event-subscription-service
 * -> real session-title-fallback-service -> the real OpenCode SDK client (the
 * only thing intercepted is global fetch, so the HTTP method, URL and body are
 * asserted exactly as they would hit the server).
 */

const mocked = vi.hoisted(() => ({
  subscribeToEvents: vi.fn(),
  stopEventListening: vi.fn(),
}));

vi.mock("#src/opencode/events.ts", () => ({
  subscribeToEvents: mocked.subscribeToEvents,
  stopEventListening: mocked.stopEventListening,
}));

vi.mock("#src/app/services/busy-reconciliation-service.ts", () => ({
  reconcileBusyState: vi.fn(),
  reconcileBusyStateNow: vi.fn(),
  __resetBusyReconciliationForTests: vi.fn(),
  setResponseStreamerForReconciliation: vi.fn(),
  setPromptResponseModeClearerForReconciliation: vi.fn(),
}));

type FetchCall = { method: string; url: string; body: string };

const DEFAULT_TITLE = "New session - 2026-10-01T10:00:00.000Z";
const SESSION_ID = "session-1";
const DIRECTORY = "D:/repo";

let fetchCalls: FetchCall[] = [];
/** Title the fake server reports for GET /session/{id}. */
let serverTitle = DEFAULT_TITLE;
/** When set, every request rejects with this error (simulates the server being down). */
let fetchFailure: Error | null = null;

function installFetchStub(): void {
  fetchCalls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input as string, init);
    fetchCalls.push({
      method: request.method,
      url: request.url,
      body: await request.clone().text(),
    });

    if (fetchFailure) {
      throw fetchFailure;
    }

    const payload =
      request.method === "PATCH"
        ? { id: SESSION_ID, title: serverTitle }
        : { id: SESSION_ID, title: serverTitle };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function patchCalls(): FetchCall[] {
  return fetchCalls.filter((call) => call.method === "PATCH");
}

function sessionGets(): FetchCall[] {
  return fetchCalls.filter(
    (call) => call.method === "GET" && call.url.includes(`/session/${SESSION_ID}`),
  );
}

function createFakeBot(): { bot: Bot<Context>; api: Record<string, ReturnType<typeof vi.fn>> } {
  const api = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
    sendRichMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
    sendMessageDraft: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue({ message_id: 101 }),
  };

  return { bot: { api } as unknown as Bot<Context>, api };
}

type Aggregator = { setSession(sessionId: string): void; processEvent(event: Event): void };

function emitAssistantMessage(aggregator: Aggregator): void {
  aggregator.processEvent({
    type: "message.updated",
    properties: {
      info: {
        id: "message-1",
        sessionID: SESSION_ID,
        role: "assistant",
        time: { created: Date.now() },
      },
    },
  } as unknown as Event);
}

function emitSessionIdle(aggregator: Aggregator): void {
  aggregator.processEvent({
    type: "session.idle",
    properties: { sessionID: SESSION_ID },
  } as unknown as Event);
}

function emitSessionError(aggregator: Aggregator): void {
  aggregator.processEvent({
    type: "session.error",
    properties: { sessionID: SESSION_ID, error: { message: "boom" } },
  } as unknown as Event);
}

describe("bot/services session title fallback on session idle", () => {
  let tempHome: string;
  let activeService: { cleanup(reason: string): void } | null = null;
  let onSessionTitleUpdate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", await mkdtemp(path.join(os.tmpdir(), "title-fallback-")));
    tempHome = process.env.OPENCODE_TELEGRAM_HOME!;
    setRuntimeMode("installed");

    mocked.subscribeToEvents.mockReset();
    mocked.stopEventListening.mockReset();
    mocked.subscribeToEvents.mockResolvedValue(undefined);

    serverTitle = DEFAULT_TITLE;
    fetchFailure = null;
    installFetchStub();

    const [
      settingsStore,
      { foregroundSessionState },
      { assistantRunState },
      { attachManager },
      abortSuppression,
      { externalUserInputSuppressionManager },
      titleFallback,
      { pinnedMessageManager },
    ] = await Promise.all([
      import("../../../src/app/stores/settings-store.js"),
      import("../../../src/app/managers/foreground-session-state-manager.js"),
      import("../../../src/app/managers/assistant-run-state-manager.js"),
      import("../../../src/app/managers/attach-manager.js"),
      import("../../../src/app/managers/abort-suppression-manager.js"),
      import("../../../src/app/managers/external-input-suppression-manager.js"),
      import("../../../src/app/services/session-title-fallback-service.js"),
      import("../../../src/bot/pinned/pinned-message-manager.js"),
    ]);
    settingsStore.__resetSettingsForTests();
    foregroundSessionState.__resetForTests();
    assistantRunState.__resetForTests();
    attachManager.__resetForTests();
    abortSuppression.__resetUserAbortErrorSuppressionForTests();
    externalUserInputSuppressionManager.__resetForTests();
    titleFallback.__resetSessionTitleFallbackForTests();
    await resetSingletonState();

    vi.spyOn(pinnedMessageManager, "isInitialized").mockReturnValue(true);
    onSessionTitleUpdate = vi
      .spyOn(pinnedMessageManager, "onSessionTitleUpdate")
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeService?.cleanup("test_cleanup");
    activeService = null;

    const settingsStore = await import("../../../src/app/stores/settings-store.js");
    settingsStore.__resetSettingsForTests();
    vi.unstubAllEnvs();
    await rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function setupService(): Promise<{
    aggregator: Aggregator;
    service: {
      setTelegramContext(bot: Bot<Context> | null, chatId: number | null): void;
      clearRuntimeState(reason: string): void;
      cleanup(reason: string): void;
    };
  }> {
    const [{ createEventSubscriptionService }, { summaryAggregator }, sessionService] =
      await Promise.all([
        import("../../../src/bot/services/event-subscription-service.js"),
        import("../../../src/app/managers/summary-aggregation-manager.js"),
        import("../../../src/app/services/session-service.js"),
      ]);

    sessionService.setCurrentSession({
      id: SESSION_ID,
      title: DEFAULT_TITLE,
      directory: DIRECTORY,
    });

    const { bot } = createFakeBot();
    const service = createEventSubscriptionService();
    activeService = service;
    service.clearRuntimeState("test_setup");
    service.setTelegramContext(bot, 42);
    await service.ensureEventSubscription(DIRECTORY);
    summaryAggregator.setSession(SESSION_ID);
    emitAssistantMessage(summaryAggregator);

    return { aggregator: summaryAggregator, service };
  }

  it("renames through session.update and propagates the title to the bot state", async () => {
    const titleFallback =
      await import("../../../src/app/services/session-title-fallback-service.js");
    const sessionService = await import("../../../src/app/services/session-service.js");
    titleFallback.registerBotCreatedSession(SESSION_ID, DIRECTORY);
    titleFallback.scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");

    const { aggregator } = await setupService();
    emitSessionIdle(aggregator);

    await vi.waitFor(() => expect(patchCalls()).toHaveLength(1));

    expect(sessionGets()).toHaveLength(1);
    expect(sessionGets()[0].url).toContain(`/session/${SESSION_ID}`);
    expect(sessionGets()[0].url).toContain("directory=D%3A%2Frepo");
    expect(JSON.parse(patchCalls()[0].body)).toEqual({ title: "Fix the login bug" });
    expect(sessionService.getCurrentSession()?.title).toBe("Fix the login bug");
    expect(onSessionTitleUpdate).toHaveBeenCalledWith("Fix the login bug");
  });

  it("leaves a real OpenCode title untouched", async () => {
    const titleFallback =
      await import("../../../src/app/services/session-title-fallback-service.js");
    const sessionService = await import("../../../src/app/services/session-service.js");
    titleFallback.registerBotCreatedSession(SESSION_ID, DIRECTORY);
    titleFallback.scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");
    serverTitle = "Login refactor";

    const { aggregator } = await setupService();
    sessionService.setCurrentSession({
      id: SESSION_ID,
      title: "Login refactor",
      directory: DIRECTORY,
    });
    emitSessionIdle(aggregator);

    await vi.waitFor(() => expect(sessionGets()).toHaveLength(1));
    expect(patchCalls()).toHaveLength(0);
    expect(onSessionTitleUpdate).not.toHaveBeenCalled();
    expect(sessionService.getCurrentSession()?.title).toBe("Login refactor");
  });

  it("does not touch a session that was never registered by the bot", async () => {
    const { aggregator } = await setupService();
    emitSessionIdle(aggregator);

    // No session.get either: the hook is a pure no-op, the idle flow continues.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fetchCalls).toHaveLength(0);
    expect(onSessionTitleUpdate).not.toHaveBeenCalled();
  });

  it("does not rename again on a second idle", async () => {
    const titleFallback =
      await import("../../../src/app/services/session-title-fallback-service.js");
    titleFallback.registerBotCreatedSession(SESSION_ID, DIRECTORY);
    titleFallback.scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");

    const { aggregator } = await setupService();
    emitSessionIdle(aggregator);
    await vi.waitFor(() => expect(patchCalls()).toHaveLength(1));

    // Server kept the placeholder (client-only rename in the stub): a second
    // idle must not re-run the update.
    emitSessionIdle(aggregator);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(patchCalls()).toHaveLength(1);
    expect(sessionGets()).toHaveLength(1);
  });

  it("does not break the idle flow when the server is unreachable", async () => {
    const titleFallback =
      await import("../../../src/app/services/session-title-fallback-service.js");
    const sessionService = await import("../../../src/app/services/session-service.js");
    const { foregroundSessionState } =
      await import("../../../src/app/managers/foreground-session-state-manager.js");
    titleFallback.registerBotCreatedSession(SESSION_ID, DIRECTORY);
    titleFallback.scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");
    fetchFailure = new Error("connect ECONNREFUSED");

    const { aggregator } = await setupService();
    emitSessionIdle(aggregator);

    await vi.waitFor(() => expect(foregroundSessionState.isBusy(SESSION_ID)).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(patchCalls()).toHaveLength(0);
    expect(sessionService.getCurrentSession()?.title).toBe(DEFAULT_TITLE);
    expect(onSessionTitleUpdate).not.toHaveBeenCalled();
  });

  it("drops the pending rename on session error", async () => {
    const titleFallback =
      await import("../../../src/app/services/session-title-fallback-service.js");
    titleFallback.registerBotCreatedSession(SESSION_ID, DIRECTORY);
    titleFallback.scheduleSessionTitleFallback(SESSION_ID, "Fix the login bug");

    const { aggregator } = await setupService();
    emitSessionError(aggregator);
    await new Promise((resolve) => setTimeout(resolve, 60));

    emitSessionIdle(aggregator);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(fetchCalls).toHaveLength(0);
  });
});
