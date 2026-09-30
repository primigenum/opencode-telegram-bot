import type { Bot, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { attachToSession } from "./attach-service.js";
import { applySessionSettings } from "./session-settings-service.js";
import { setCurrentSession } from "./session-service.js";
import type { SessionInfo } from "../types/session.js";
import { logger } from "../../utils/logger.js";

export interface AttachLatestProjectSessionDeps {
  bot: Bot<Context>;
  chatId: number;
  directory: string;
  ensureEventSubscription: (directory: string) => Promise<void>;
}

export interface AttachSessionByIdDeps {
  bot: Bot<Context>;
  chatId: number;
  sessionId: string;
  directory: string;
  ensureEventSubscription: (directory: string) => Promise<void>;
}

/**
 * Attach one session of a project by id, adopting its agent and model like the
 * sessions menu does.
 * @returns the attached session, or null when the session no longer exists
 */
export async function attachSessionById(deps: AttachSessionByIdDeps): Promise<SessionInfo | null> {
  const { data: session, error } = await opencodeClient.session.get({
    sessionID: deps.sessionId,
    directory: deps.directory,
  });

  if (error || !session) {
    if (error) {
      logger.warn(
        `[ProjectSession] Failed to load session ${deps.sessionId} in ${deps.directory}:`,
        error,
      );
    }
    return null;
  }

  const sessionInfo: SessionInfo = {
    id: session.id,
    title: session.title,
    directory: deps.directory,
  };

  setCurrentSession(sessionInfo);
  applySessionSettings(session);
  await attachToSession({
    bot: deps.bot,
    chatId: deps.chatId,
    session: sessionInfo,
    ensureEventSubscription: deps.ensureEventSubscription,
  });

  logger.info(
    `[ProjectSession] Attached session: session=${session.id}, directory=${deps.directory}`,
  );
  return sessionInfo;
}

/**
 * Attach the most recently updated session of a project directory.
 * Used after switching projects: a switch that lands on no session strands the
 * chat with no pinned session and no prompt target. Mirrors selecting a session
 * from the sessions menu: the session's agent and model are adopted too.
 * @returns the attached session, or null when the directory has no sessions
 */
export async function attachLatestProjectSession(
  deps: AttachLatestProjectSessionDeps,
): Promise<SessionInfo | null> {
  const { data: sessions, error } = await opencodeClient.session.list({
    directory: deps.directory,
    limit: 1,
    roots: true,
  });

  const latest = sessions?.[0];
  if (error || !latest) {
    if (error) {
      logger.warn(
        `[ProjectSession] Failed to load sessions for directory: ${deps.directory}`,
        error,
      );
    } else {
      logger.info(`[ProjectSession] No sessions to attach in directory: ${deps.directory}`);
    }
    return null;
  }

  return attachSessionById({ ...deps, sessionId: latest.id });
}
