import { Context, InlineKeyboard } from "grammy";
import {
  formatVariantForDisplay,
  getAvailableVariants,
} from "../../app/services/variant-selection-service.js";
import type { ModelInfo } from "../../app/types/model.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

/**
 * Build inline keyboard with available variants
 * @param currentVariant Current variant for highlighting
 * @param providerID Provider ID
 * @param modelID Model ID
 * @returns InlineKeyboard with variant selection buttons
 */
export async function buildVariantSelectionMenu(
  currentVariant: string,
  providerID: string,
  modelID: string,
): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const variants = await getAvailableVariants(providerID, modelID);

  if (variants.length === 0) {
    logger.warn("[VariantHandler] No variants found");
    return keyboard;
  }

  // Offer only real variants (not disabled): the synthetic "default" row is
  // not shown when the model has a configured default (e.g. reasoningEffort).
  const activeVariants = variants.filter((v) => !v.disabled && v.id !== "default");

  if (activeVariants.length === 0) {
    logger.warn("[VariantHandler] No selectable variants found");
    return keyboard;
  }

  // Add button for each variant (one per row)
  activeVariants.forEach((variant) => {
    const isActive = variant.id === currentVariant;
    const label = formatVariantForDisplay(variant.id);
    const labelWithCheck = isActive ? `✅ ${label}` : label;

    keyboard.text(labelWithCheck, `variant:${variant.id}`).row();
  });

  return keyboard;
}

/**
 * Show the variant selection menu right after a model was picked.
 * Opens when the model offers at least one selectable real variant different from
 * the active one (0 variants, or a single one already active, ends at the model
 * confirmation). Any failure leaves the flow at the model confirmation instead of
 * surfacing an error.
 * @param ctx grammY context
 * @param model Model that was just applied
 * @returns true when the picker was opened
 */
export async function showVariantSelectionMenuAfterModelChange(
  ctx: Context,
  model: ModelInfo,
): Promise<boolean> {
  try {
    const currentVariant = model.variant || "default";
    const keyboard = await buildVariantSelectionMenu(
      currentVariant,
      model.providerID,
      model.modelID,
    );

    // The builder only draws real variants (no synthetic "default" row); read the
    // variant ids back from the buttons to offer the choice when any drawn variant
    // differs from the active one.
    const drawnVariants = keyboard.inline_keyboard
      .flat()
      .map((button) => button.callback_data)
      .filter((data): data is string => typeof data === "string" && data.startsWith("variant:"))
      .map((data) => data.slice("variant:".length));

    const hasChoice =
      drawnVariants.length > 1 ||
      (drawnVariants.length === 1 && drawnVariants[0] !== currentVariant);

    if (!hasChoice) {
      logger.debug(
        `[VariantHandler] No variant choice for ${model.providerID}/${model.modelID}, menu skipped`,
      );
      return false;
    }

    const displayName = formatVariantForDisplay(currentVariant);
    const text = t("variant.menu.current", { name: displayName });

    await replyWithInlineMenu(ctx, {
      menuKind: "variant",
      text,
      keyboard,
    });

    return true;
  } catch (err) {
    logger.error("[VariantHandler] Error showing variant menu after model change:", err);
    return false;
  }
}
