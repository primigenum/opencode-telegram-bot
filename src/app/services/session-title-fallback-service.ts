import { opencodeClient } from "../../opencode/client.js";
import { deriveTitleFromPrompt, isDefaultSessionTitle } from "../utils/session-title.js";
import { logger } from "../../utils/logger.js";

interface RegisteredSession {
  directory: string;
}

interface ScheduledTitle {
  directory: string;
  title: string;
}

export interface ApplyScheduledTitleResult {
  renamed: boolean;
  title?: string;
  directory?: string;
}

// In-memory only: a bot restart between session creation and the first turn
// loses the pending title, which the backfill script covers.
const registeredSessions = new Map<string, RegisteredSession>();
const scheduledTitles = new Map<string, ScheduledTitle>();

/**
 * Marks a session as created by the bot, so its first text prompt may seed a
 * fallback title. Sessions not created in this run are never touched.
 */
export function registerBotCreatedSession(sessionId: string, directory: string): void {
  registeredSessions.set(sessionId, { directory });
}

/**
 * Queues the derived title for a registered session once the first prompt is
 * known. No-op when the session was not created by the bot, when a title is
 * already queued, or when the prompt yields no usable text.
 */
export function scheduleSessionTitleFallback(sessionId: string, text: string): void {
  const registered = registeredSessions.get(sessionId);
  if (!registered || scheduledTitles.has(sessionId)) {
    return;
  }

  const title = deriveTitleFromPrompt(text);
  if (title === null) {
    return;
  }

  registeredSessions.delete(sessionId);
  scheduledTitles.set(sessionId, { directory: registered.directory, title });
}

/**
 * Applies the queued title once the session goes idle: renames only when the
 * server still holds the default placeholder. Any API failure is logged and
 * discarded; this never throws and never breaks the event flow.
 */
export async function applyScheduledSessionTitle(
  sessionId: string,
): Promise<ApplyScheduledTitleResult | null> {
  const scheduled = scheduledTitles.get(sessionId);
  if (!scheduled) {
    return null;
  }
  scheduledTitles.delete(sessionId);

  const { directory, title } = scheduled;

  try {
    const { data: session, error } = await opencodeClient.session.get({
      sessionID: sessionId,
      directory,
    });

    if (error || !session) {
      logger.warn(
        `[SessionTitleFallback] Failed to load session ${sessionId} before renaming:`,
        error,
      );
      return { renamed: false, directory };
    }

    // OpenCode (or the user) already produced a real title — leave it alone.
    if (!isDefaultSessionTitle(session.title)) {
      return { renamed: false, directory };
    }

    const { data: updated, error: updateError } = await opencodeClient.session.update({
      sessionID: sessionId,
      directory,
      title,
    });

    if (updateError || !updated) {
      logger.warn(`[SessionTitleFallback] Failed to rename session ${sessionId}:`, updateError);
      return { renamed: false, directory };
    }

    logger.info(`[SessionTitleFallback] Renamed session ${sessionId} to "${title}"`);
    return { renamed: true, title, directory };
  } catch (err) {
    logger.warn(`[SessionTitleFallback] Error applying title for session ${sessionId}:`, err);
    return { renamed: false, directory };
  }
}

export function clearSessionTitleFallback(sessionId: string, reason: string): void {
  registeredSessions.delete(sessionId);
  scheduledTitles.delete(sessionId);
  logger.debug(
    `[SessionTitleFallback] Cleared fallback state for session ${sessionId} (${reason})`,
  );
}

export function __resetSessionTitleFallbackForTests(): void {
  registeredSessions.clear();
  scheduledTitles.clear();
}
