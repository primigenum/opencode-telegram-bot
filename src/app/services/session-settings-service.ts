/**
 * Session Settings Service - adopts the agent and model a session last ran with
 */
import type { Session } from "@opencode-ai/sdk/v2";
import { selectAgent } from "./agent-selection-service.js";
import { getStoredModel, selectModel } from "./model-selection-service.js";
import { resolveVariant } from "./variant-selection-service.js";
import { logger } from "../../utils/logger.js";

/**
 * Apply the agent and model stored on a session to the current settings.
 * Agent and model are adopted independently: a session that carries only one of
 * them changes only that one, and a session that was never prompted changes
 * nothing.
 *
 * The variant is adopted with the model, hybrid: an explicit session variant
 * wins; otherwise the effective variant is kept when the adopted model is the
 * current one, and the adopted model's configured default is used otherwise.
 * "default" is only stored when nothing else can be resolved.
 * @param session Session to read the settings from
 */
export function applySessionSettings(session: Session): void {
  const model = session.model;

  if (session.agent) {
    selectAgent(session.agent);
  }

  let appliedVariant: string | undefined;
  if (model?.providerID && model.id) {
    const current = getStoredModel();
    const sameModel = current.providerID === model.providerID && current.modelID === model.id;
    const explicitVariant =
      model.variant && model.variant !== "default" ? model.variant : undefined;
    appliedVariant = sameModel
      ? resolveVariant(model.providerID, model.id, explicitVariant ?? current.variant)
      : resolveVariant(model.providerID, model.id, explicitVariant);

    selectModel({
      providerID: model.providerID,
      modelID: model.id,
      variant: appliedVariant,
    });
  }

  if (!session.agent && !model) {
    logger.debug(`[SessionSettings] Session ${session.id} carries no agent or model to pull`);
    return;
  }

  logger.info(
    `[SessionSettings] Pulled from session ${session.id}: agent=${session.agent ?? "unchanged"}, model=${
      model?.providerID && model.id
        ? `${model.providerID}/${model.id} (${appliedVariant})`
        : "unchanged"
    }`,
  );
}
