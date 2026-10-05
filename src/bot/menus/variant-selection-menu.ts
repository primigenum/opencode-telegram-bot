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

  // Filter only active variants (not disabled)
  const activeVariants = variants.filter((v) => !v.disabled);

  if (activeVariants.length === 0) {
    logger.warn("[VariantHandler] No active variants found");
    // If no active variants, show default at least
    keyboard.text(`✅ ${formatVariantForDisplay("default")}`, "variant:default").row();
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
 * Opens only when the model offers more than one selectable variant; any failure
 * leaves the flow at the model confirmation instead of surfacing an error.
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

    // The builder leaves a trailing empty row, so count the rows that carry a button
    const drawnVariants = keyboard.inline_keyboard.filter((row) => row.length > 0).length;

    if (drawnVariants < 2) {
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
