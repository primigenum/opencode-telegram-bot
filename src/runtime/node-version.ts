const MINIMUM_NODE_MAJOR = 22;

/**
 * Returns an error message when the running Node.js is too old, otherwise null.
 *
 * Must be checked before any module that loads a native addon is imported:
 * better-sqlite3 crashes the process with SIGSEGV on Node.js 20, and such a
 * crash cannot be caught by try/catch.
 */
export function getUnsupportedNodeVersionMessage(
  version: string = process.versions.node,
): string | null {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);

  if (!Number.isInteger(major) || major >= MINIMUM_NODE_MAJOR) {
    return null;
  }

  return [
    `OpenCode Telegram Bot requires Node.js ${MINIMUM_NODE_MAJOR} or newer, but the current version is v${version}.`,
    "Update Node.js and try again: https://nodejs.org",
  ].join("\n");
}
