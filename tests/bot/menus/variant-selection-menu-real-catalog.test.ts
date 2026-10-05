/**
 * Adversarial coverage for the variant picker opening rule (plan D6 + "caso h"
 * correction round): the menu must open for a model with EXACTLY ONE real
 * variant when that variant is not the active one, and stay silent otherwise.
 *
 * The suite in variant-selection-menu.test.ts mocks getAvailableVariants(), so
 * the synthetic `{ id: "default" }` entry and the API shape (model.variants) are
 * taken on faith. This file drives the REAL variant-selection-service and the
 * REAL variant-selection-menu against a REAL provider payload, mocking only the
 * SDK client, the settings store and the Telegram sender.
 */
import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context, InlineKeyboard } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";
import { defined } from "#helpers/defined.js";

const mocked = vi.hoisted(() => ({
  providersMock: vi.fn(),
  replyWithInlineMenuMock: vi.fn(),
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: { config: { providers: mocked.providersMock } },
}));

const settingsStoreMock = createSettingsStoreMock();
settingsStoreMock.getCurrentModel = vi.fn(() => undefined);
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "opencode-go", modelID: "kimi-k3" })),
  selectModel: vi.fn(),
  reconcileStoredModelSelection: vi.fn(),
  getFavoriteModels: vi.fn(() => []),
  getModelSelectionLists: vi.fn(),
  __resetModelCatalogCacheForTests: vi.fn(),
  getProviders: vi.fn(async () => []),
  getProviderModels: vi.fn(async () => []),
  searchModels: vi.fn(async () => []),
  fetchCurrentModel: vi.fn(),
}));

vi.mock("#src/bot/menus/inline-menu.ts", () => ({
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { showVariantSelectionMenuAfterModelChange } = await loadSut<
  typeof import("#src/bot/menus/variant-selection-menu.js")
>("#src/bot/menus/variant-selection-menu.ts", import.meta.url);
const { getAvailableVariants } = await loadSut<
  typeof import("#src/app/services/variant-selection-service.js")
>("#src/app/services/variant-selection-service.ts", import.meta.url);

/** Realistic provider payload: one single-variant model, one multi, one none. */
function providerPayload(): { data: unknown; error: null } {
  return {
    error: null,
    data: {
      providers: [
        {
          id: "opencode-go",
          models: {
            "kimi-k3": { variants: { max: {} } },
            "minimax-m3": { variants: { thinking: {} } },
            "deepseek-v4.1-flash": { variants: { max: {}, high: {}, low: {} } },
            "plain-model": {},
            "disabled-only": { variants: { max: { disabled: true } } },
          },
        },
      ],
    },
  };
}

function mockContext(): Context {
  return {
    chat: { id: 7 },
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as Context;
}

function sentRows(): InlineKeyboard["inline_keyboard"] {
  const call = defined(mocked.replyWithInlineMenuMock.mock.calls[0], "replyWithInlineMenu call");
  const options = call[1] as { keyboard: InlineKeyboard };
  return options.keyboard.inline_keyboard.filter((row) => row.length > 0);
}

function sentTexts(): string[] {
  return sentRows()
    .flat()
    .map((button) => button.text);
}

function sentCallbacks(): string[] {
  return sentRows()
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

describe("variant picker — real provider catalog", () => {
  beforeEach(() => {
    mocked.providersMock.mockReset().mockResolvedValue(providerPayload());
    mocked.replyWithInlineMenuMock.mockReset().mockResolvedValue(1);
  });

  it("real catalog: the synthetic default entry is prepended, proving the shape", async () => {
    await expect(getAvailableVariants("opencode-go", "kimi-k3")).resolves.toEqual([
      { id: "default" },
      { id: "max", disabled: undefined },
    ]);
  });

  it("opens with the single real variant when it is not the active one", async () => {
    const ctx = mockContext();

    const opened = await showVariantSelectionMenuAfterModelChange(ctx, {
      providerID: "opencode-go",
      modelID: "kimi-k3",
      variant: "default",
    });

    expect(opened).toBe(true);
    expect(sentRows()).toHaveLength(1);
    expect(defined(sentRows()[0]?.[0], "row 0 button").text).toBe("Max");
    expect(defined(sentRows()[0]?.[0], "row 0 button").callback_data).toBe("variant:max");
    expect(sentTexts().some((text) => text.includes("Default"))).toBe(false);
  });

  it("opens with the single real variant when the stored variant is absent", async () => {
    const ctx = mockContext();

    const opened = await showVariantSelectionMenuAfterModelChange(ctx, {
      providerID: "opencode-go",
      modelID: "minimax-m3",
    });

    expect(opened).toBe(true);
    expect(defined(sentRows()[0]?.[0], "row 0 button").callback_data).toBe("variant:thinking");
  });

  it("stays silent when the single real variant is already active", async () => {
    const ctx = mockContext();

    const opened = await showVariantSelectionMenuAfterModelChange(ctx, {
      providerID: "opencode-go",
      modelID: "kimi-k3",
      variant: "max",
    });

    expect(opened).toBe(false);
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("stays silent with zero real variants (no Default row either)", async () => {
    const ctx = mockContext();

    const opened = await showVariantSelectionMenuAfterModelChange(ctx, {
      providerID: "opencode-go",
      modelID: "plain-model",
      variant: "default",
    });

    expect(opened).toBe(false);
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });

  it("stays silent when the only real variant is disabled", async () => {
    const ctx = mockContext();

    const opened = await showVariantSelectionMenuAfterModelChange(ctx, {
      providerID: "opencode-go",
      modelID: "disabled-only",
      variant: "default",
    });

    expect(opened).toBe(false);
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });

  it("stays silent for a model missing from the provider (error path returns default only)", async () => {
    const ctx = mockContext();

    const opened = await showVariantSelectionMenuAfterModelChange(ctx, {
      providerID: "opencode-go",
      modelID: "ghost-model",
      variant: "default",
    });

    expect(opened).toBe(false);
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });

  it("opens all real variants when the model has two or more", async () => {
    const ctx = mockContext();

    const opened = await showVariantSelectionMenuAfterModelChange(ctx, {
      providerID: "opencode-go",
      modelID: "deepseek-v4.1-flash",
      variant: "high",
    });

    expect(opened).toBe(true);
    expect(sentRows()).toHaveLength(3);
    expect(sentCallbacks()).toEqual(["variant:max", "variant:high", "variant:low"]);
    expect(sentTexts()).toEqual(["Max", "✅ High", "Low"]);
  });

  it("stays silent when the provider catalog cannot be read", async () => {
    mocked.providersMock.mockResolvedValue({ error: { message: "boom" }, data: null });
    const ctx = mockContext();

    const opened = await showVariantSelectionMenuAfterModelChange(ctx, {
      providerID: "opencode-go",
      modelID: "kimi-k3",
      variant: "default",
    });

    expect(opened).toBe(false);
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });
});
