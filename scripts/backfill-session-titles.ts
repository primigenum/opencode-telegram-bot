#!/usr/bin/env bun
/* eslint-disable no-console -- CLI script: stdout/stderr are its user interface. */
/**
 * Backfill session titles: rename existing OpenCode sessions that still carry
 * the server's default placeholder ("New session - <ISO>") using the first
 * user prompt of each session. Read-only by default; pass --apply to write.
 *
 * Uses its own SDK client, so it does NOT need the bot's Telegram environment
 * (it never imports src/config.ts). Authentication is optional:
 *   OPENCODE_API_URL    server base URL (default http://127.0.0.1:4096)
 *   OPENCODE_USERNAME   Basic auth username (default "opencode")
 *   OPENCODE_PASSWORD   Basic auth password (no auth when unset)
 * OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD are also honoured (they
 * are the names the bot itself reads through src/config.ts).
 *
 * Usage:
 *   bun scripts/backfill-session-titles.ts [--dry-run] [--apply] [--directory <path>]
 */

import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { deriveTitleFromPrompt, isDefaultSessionTitle } from "../src/app/utils/session-title.js";

const DEFAULT_API_URL = "http://127.0.0.1:4096";
const LIST_LIMIT = 1000;

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

interface Args {
  apply: boolean;
  directory?: string;
}

interface SessionMessageLike {
  info: { role?: string; time?: { created?: number } };
  parts: Array<{ type: string; text?: string }>;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object") {
    return JSON.stringify(error);
  }
  return String(error);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--dry-run") {
      args.apply = false;
    } else if (arg === "--directory") {
      const value = argv[i + 1];
      if (!value) {
        console.error("Missing value for --directory <path>");
        process.exit(1);
      }
      args.directory = value;
      i += 1;
    } else {
      console.error(`Unknown argument: ${arg}`);
      console.error(
        "Usage: bun scripts/backfill-session-titles.ts [--dry-run] [--apply] [--directory <path>]",
      );
      process.exit(1);
    }
  }
  return args;
}

function createClient(): { client: OpencodeClient; baseUrl: string } {
  const baseUrl = process.env.OPENCODE_API_URL?.trim() || DEFAULT_API_URL;
  const username =
    process.env.OPENCODE_USERNAME ?? process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  const password = process.env.OPENCODE_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD;
  const headers = password
    ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }
    : undefined;
  return { client: createOpencodeClient({ baseUrl, headers }), baseUrl };
}

/** Oldest user message that still carries text, or null when there is none. */
function firstUserText(messages: SessionMessageLike[]): string | null {
  const users = messages
    .filter((message) => message.info.role === "user")
    .sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0));

  for (const message of users) {
    const text = message.parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("")
      .trim();
    if (text.length > 0) {
      return text;
    }
  }
  return null;
}

async function loadMessages(
  client: OpencodeClient,
  sessionId: string,
  directory: string | undefined,
): Promise<SessionMessageLike[]> {
  const { data, error } = await client.session.messages({
    sessionID: sessionId,
    ...(directory ? { directory } : {}),
  });
  if (error) {
    throw new Error(formatError(error));
  }
  return (data ?? []) as SessionMessageLike[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { client, baseUrl } = createClient();

  console.log("OpenCode session title backfill");
  console.log(`Server: ${baseUrl}`);
  console.log(`Mode:   ${args.apply ? "apply (writing changes)" : "dry-run (no changes written)"}`);
  if (args.directory) {
    console.log(`Filter: directory = ${args.directory}`);
  }
  console.log("");

  let sessions;
  try {
    const { data, error } = await client.session.list({
      roots: true,
      limit: LIST_LIMIT,
      ...(args.directory ? { directory: args.directory } : {}),
    });
    if (error || !data) {
      console.error(`Failed to list sessions: ${formatError(error)}`);
      process.exit(1);
    }
    sessions = data;
  } catch (err) {
    console.error(`Failed to reach the OpenCode server at ${baseUrl}: ${formatError(err)}`);
    process.exit(1);
  }

  const scanned = sessions.length;
  if (scanned >= LIST_LIMIT) {
    console.warn(
      `Warning: session list returned ${scanned} entries (limit ${LIST_LIMIT}); more sessions may exist.`,
    );
  }

  const defaults = sessions.filter((session) => isDefaultSessionTitle(session.title));

  let renamed = 0;
  let skippedNoText = 0;
  let skippedError = 0;

  console.log(`Scanned ${scanned} root session(s); ${defaults.length} have the default title.`);
  console.log("");

  for (const [index, session] of defaults.entries()) {
    const label = `[${index + 1}/${defaults.length}] ${session.id}`;
    const directory = session.directory || args.directory;
    try {
      const messages = await loadMessages(client, session.id, directory);
      const prompt = firstUserText(messages);
      const title = prompt ? deriveTitleFromPrompt(prompt) : null;

      if (title === null) {
        skippedNoText += 1;
        console.log(`${label}: skipped (no user text)`);
        continue;
      }

      if (!args.apply) {
        renamed += 1;
        console.log(`${label}: would rename "${session.title}" -> "${title}"`);
        continue;
      }

      const { error: updateError } = await client.session.update({
        sessionID: session.id,
        ...(directory ? { directory } : {}),
        title,
      });
      if (updateError) {
        skippedError += 1;
        console.error(`${label}: update failed (${formatError(updateError)})`);
        continue;
      }

      renamed += 1;
      console.log(`${label}: renamed -> "${title}"`);
    } catch (err) {
      skippedError += 1;
      console.error(`${label}: error (${formatError(err)})`);
    }
  }

  console.log("");
  console.log("Summary");
  console.log(`  scanned:  ${scanned}`);
  console.log(`  default:  ${defaults.length}`);
  console.log(`  renamed:  ${renamed}${args.apply ? "" : " (dry-run)"}`);
  console.log(
    `  skipped:  ${skippedNoText + skippedError} (no text: ${skippedNoText}, errors: ${skippedError})`,
  );
}

main().catch((err) => {
  console.error(`Fatal: ${formatError(err)}`);
  process.exit(1);
});
