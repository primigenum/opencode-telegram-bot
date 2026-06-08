import { Context, InlineKeyboard } from "grammy";
import {
  selectModel,
  fetchCurrentModel,
  getModelSelectionLists,
  searchModels,
} from "../../model/manager.js";
import { formatModelForDisplay } from "../../model/types.js";
import type { FavoriteModel, ModelInfo, ModelSelectionLists } from "../../model/types.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { logger } from "../../utils/logger.js";
import { createMainKeyboard } from "../ui/keyboard/keyboard.js";
import { getStoredAgent, resolveProjectAgent } from "../../agent/manager.js";
import { pinnedMessageManager } from "../ui/pinned/manager.js";
import { keyboardManager } from "../ui/keyboard/manager.js";
import {
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "./inline-menu.js";
import { interactionManager } from "../../interaction/manager.js";
import { t } from "../../i18n/index.js";

const MODEL_SEARCH_CALLBACK = "model:search";
const MODEL_SEARCH_AGAIN_CALLBACK = "model:search:again";
const MODEL_SEARCH_CANCEL_CALLBACK = "model:search:cancel";

function buildModelSelectionMenuText(modelLists: ModelSelectionLists): string {
  const lines = [t("model.menu.select"), t("model.menu.favorites_title")];

  if (modelLists.favorites.length === 0) {
    lines.push(t("model.menu.favorites_empty"));
  }

  lines.push(t("model.menu.recent_title"));

  if (modelLists.recent.length === 0) {
    lines.push(t("model.menu.recent_empty"));
  }

  return lines.join("\n");
}

interface ModelSearchMetadata {
  flow: string;
  stage: string;
  messageId?: number;
}

function parseModelSearchMetadata(): ModelSearchMetadata | null {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;

  if (flow !== "model-search" || typeof stage !== "string") {
    return null;
  }

  const messageId =
    typeof state.metadata.messageId === "number" ? state.metadata.messageId : undefined;

  return { flow, stage, messageId };
}

/**
 * Shared logic for applying a model selection and updating UI.
 * Used by both the regular inline menu flow and the search results flow.
 */
async function applyModelSelectionAndNotify(
  ctx: Context,
  modelInfo: ModelInfo,
): Promise<void> {
  if (ctx.chat) {
    keyboardManager.initialize(ctx.api, ctx.chat.id);
  }

  selectModel(modelInfo);
  keyboardManager.updateModel(modelInfo);
  await pinnedMessageManager.refreshContextLimit();

  const currentAgent = await resolveProjectAgent(getStoredAgent());
  const contextInfo =
    pinnedMessageManager.getContextInfo() ??
    (pinnedMessageManager.getContextLimit() > 0
      ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
      : null);

  keyboardManager.updateAgent(currentAgent);

  if (contextInfo) {
    keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
  }

  const variantName = formatVariantForButton(modelInfo.variant || "default");
  const keyboard = createMainKeyboard(
    currentAgent,
    modelInfo,
    contextInfo ?? undefined,
    variantName,
  );
  const displayName = formatModelForDisplay(modelInfo.providerID, modelInfo.modelID);

  await ctx.answerCallbackQuery({ text: t("model.changed_callback", { name: displayName }) });
  await ctx.reply(t("model.changed_message", { name: displayName }), {
    reply_markup: keyboard,
  });
  await ctx.deleteMessage().catch(() => {});
}

/**
 * Handle model selection callback from the inline menu.
 * Skips search-related callbacks (handled separately).
 * @returns true if handled, false otherwise
 */
export async function handleModelSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith("model:")) {
    return false;
  }

  // Skip search callbacks — handled by handleModelSearchCallback / handleModelSearchResults
  if (
    callbackQuery.data === MODEL_SEARCH_CALLBACK ||
    callbackQuery.data === MODEL_SEARCH_AGAIN_CALLBACK ||
    callbackQuery.data === MODEL_SEARCH_CANCEL_CALLBACK
  ) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "model");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[ModelHandler] Received callback: ${callbackQuery.data}`);

  try {
    // Parse callback data: "model:providerID:modelID"
    const parts = callbackQuery.data.split(":");
    if (parts.length < 3) {
      logger.error(`[ModelHandler] Invalid callback data format: ${callbackQuery.data}`);
      clearActiveInlineMenu("model_select_invalid_callback");
      await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
      return true;
    }

    const providerID = parts[1];
    const modelID = parts.slice(2).join(":"); // Handle model IDs that may contain ":"

    const modelInfo: ModelInfo = {
      providerID,
      modelID,
      variant: "default",
    };

    clearActiveInlineMenu("model_selected");
    await applyModelSelectionAndNotify(ctx, modelInfo);

    return true;
  } catch (err) {
    clearActiveInlineMenu("model_select_error");
    logger.error("[ModelHandler] Error handling model select:", err);
    await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
    return false;
  }
}

/**
 * Build inline keyboard with favorite and recent models, plus a search button at the top.
 */
export async function buildModelSelectionMenu(
  currentModel?: ModelInfo,
  modelLists?: ModelSelectionLists,
): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const lists = modelLists ?? (await getModelSelectionLists());
  const favorites = lists.favorites;
  const recent = lists.recent;

  // Search button — always present as first row
  keyboard.text(t("model.search.button"), MODEL_SEARCH_CALLBACK).row();

  if (favorites.length === 0 && recent.length === 0) {
    logger.warn("[ModelHandler] No model choices found in favorites/recent");
    return keyboard;
  }

  const addButton = (model: FavoriteModel, prefix: string): void => {
    const isActive =
      currentModel &&
      model.providerID === currentModel.providerID &&
      model.modelID === currentModel.modelID;

    const label = `${prefix} ${model.providerID}/${model.modelID}`;
    const labelWithCheck = isActive ? `✅ ${label}` : label;

    keyboard.text(labelWithCheck, `model:${model.providerID}:${model.modelID}`).row();
  };

  favorites.forEach((model) => addButton(model, "⭐"));
  recent.forEach((model) => addButton(model, "🕘"));

  return keyboard;
}

/**
 * Show model selection menu
 */
export async function showModelSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentModel = fetchCurrentModel();
    const modelLists = await getModelSelectionLists();
    const keyboard = await buildModelSelectionMenu(currentModel, modelLists);

    // keyboard always has at least the search button, so length > 0
    const text = buildModelSelectionMenuText(modelLists);

    await replyWithInlineMenu(ctx, {
      menuKind: "model",
      text,
      keyboard,
    });
  } catch (err) {
    logger.error("[ModelHandler] Error showing model menu:", err);
    await ctx.reply(t("model.menu.error"));
  }
}

// ─── Model search handlers ────────────────────────────────────────────────

/**
 * Handle the search button callback (model:search) from the inline menu.
 * Transitions the interaction to text-input mode and prompts the user.
 */
export async function handleModelSearchCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  if (data !== MODEL_SEARCH_CALLBACK) {
    return false;
  }

  const isActive = await ensureActiveInlineMenu(ctx, "model");
  if (!isActive) {
    return true;
  }

  await ctx.answerCallbackQuery().catch(() => {});
  await ctx.deleteMessage().catch(() => {});

  // Start a new interaction for search text input
  // interactionManager.start() clears any existing interaction automatically
  interactionManager.start({
    kind: "custom",
    expectedInput: "text",
    metadata: {
      flow: "model-search",
      stage: "input",
    },
  });

  await ctx.reply(t("model.search.prompt"));

  logger.debug("[ModelHandler] Model search prompt shown");
  return true;
}

/**
 * Handle text input for model search.
 * Searches the full provider catalog and shows results (or "not found").
 */
export async function handleModelSearchTextInput(ctx: Context): Promise<boolean> {
  const meta = parseModelSearchMetadata();
  if (!meta || meta.stage !== "input") {
    return false;
  }

  const text = ctx.message?.text;
  if (!text) {
    return false;
  }

  logger.debug(`[ModelHandler] Model search query: "${text}"`);

  try {
    const results = await searchModels(text);

    const keyboard = new InlineKeyboard();

    for (const model of results) {
      const label = `${model.providerID}/${model.modelID}`;
      keyboard.text(label, `model:${model.providerID}:${model.modelID}`).row();
    }

    keyboard.row();
    keyboard.text(t("model.search.search_again"), MODEL_SEARCH_AGAIN_CALLBACK);
    keyboard.text(t("inline.button.cancel"), MODEL_SEARCH_CANCEL_CALLBACK);

    const replyText =
      results.length === 0
        ? t("model.search.no_results", { query: text })
        : t("model.search.results_title", { query: text });

    const sent = await ctx.reply(replyText, { reply_markup: keyboard });

    // Transition to results stage (callback-only)
    interactionManager.transition({
      expectedInput: "callback",
      metadata: {
        flow: "model-search",
        stage: "results",
        messageId: sent.message_id,
      },
    });

    return true;
  } catch (err) {
    logger.error("[ModelHandler] Model search error:", err);
    await ctx.reply(t("model.search.error"));
    interactionManager.clear("model_search_error");
    return true;
  }
}

/**
 * Handle callbacks from the search results menu:
 * - model:search:cancel — clears interaction, deletes message
 * - model:search:again — delegates to handleModelSearchCallback
 * - model:provider:model — selects the model from search results
 */
export async function handleModelSearchResults(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  const meta = parseModelSearchMetadata();
  if (!meta || meta.stage !== "results") {
    return false;
  }

  // Verify message ID matches to reject stale callbacks
  const callbackMessageId = ctx.callbackQuery?.message?.message_id;
  if (meta.messageId !== undefined && callbackMessageId !== meta.messageId) {
    await ctx
      .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
      .catch(() => {});
    return true;
  }

  // Cancel
  if (data === MODEL_SEARCH_CANCEL_CALLBACK) {
    interactionManager.clear("model_search_cancelled");
    await ctx.answerCallbackQuery({ text: t("inline.cancelled_callback") }).catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    return true;
  }

  // Search again — inline implementation
  if (data === MODEL_SEARCH_AGAIN_CALLBACK) {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});

    interactionManager.start({
      kind: "custom",
      expectedInput: "text",
      metadata: {
        flow: "model-search",
        stage: "input",
      },
    });

    await ctx.reply(t("model.search.prompt"));

    logger.debug("[ModelHandler] Model search prompt shown (search again)");
    return true;
  }

  // Model selection from search results
  if (data.startsWith("model:")) {
    const parts = data.split(":");
    if (parts.length < 3) {
      return true;
    }

    const providerID = parts[1];
    const modelID = parts.slice(2).join(":");

    const modelInfo: ModelInfo = {
      providerID,
      modelID,
      variant: "default",
    };

    interactionManager.clear("model_search_selected");
    await applyModelSelectionAndNotify(ctx, modelInfo);
    return true;
  }

  return false;
}
