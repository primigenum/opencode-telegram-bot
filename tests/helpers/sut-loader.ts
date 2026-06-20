const ALIASES: Record<string, string> = {
  "#src/": "/src/",
  "#tests/": "/tests/",
  "#helpers/": "/tests/helpers/",
};

function resolveAlias(path: string): string {
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (path.startsWith(alias)) {
      return target + path.slice(alias.length);
    }
  }
  return path;
}

function resolveAbsPath(relativePath: string, fromUrl: string): string {
  const resolved = resolveAlias(relativePath);
  const stripped = resolved.replace(/\.(ts|tsx|js|jsx)$/, "");
  const testFilePath = new URL(fromUrl).pathname;
  const projectRoot = testFilePath.replace(/\/tests\/.*$/, "");
  const baseUrl = `file://${projectRoot}/`;
  const candidates = [
    stripped + ".ts",
    stripped + ".tsx",
    stripped + ".js",
    stripped + ".jsx",
  ];
  for (const candidate of candidates) {
    try {
      const resolvedCandidate = candidate.startsWith("/")
        ? `${baseUrl}${candidate.slice(1)}`
        : candidate;
      return new URL(resolvedCandidate, baseUrl).pathname;
    } catch {
      // continue
    }
  }
  throw new Error(`Cannot resolve ${relativePath} (resolved: ${resolved}) from ${fromUrl}`);
}

/**
 * Loads a SUT (system under test) module immediately. The SUT is loaded
 * via dynamic import BEFORE any other code in the calling test file body
 * runs, so vi.mock(...) calls in the body are applied to the SUT's static
 * imports. Returns the module namespace directly — use it like a normal
 * import:
 *
 *   const sut = await loadSut<typeof import("#src/foo.js")>("#src/foo.ts", import.meta.url);
 *   sut.doSomething();
 *
 * Path can be a relative path or a #src/* / #tests/* / #helpers/* alias.
 */
export async function loadSut<T extends object>(
  relativePath: string,
  fromUrl: string = import.meta.url,
): Promise<T> {
  const absPath = resolveAbsPath(relativePath, fromUrl);
  return (await import(absPath)) as T;
}
