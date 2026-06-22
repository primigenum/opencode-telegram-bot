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

/**
 * Creates a plain object that exposes the given SUT keys as thin wrappers
 * that delegate to the SUT at call time. Useful when the test wants to
 * destructure SUT exports at the module body (e.g. `const { foo } = bindSut(sut, ...)`)
 * and `loadSut`'s Promise can't be awaited in the right position.
 *
 * Prefer `loadSut` + property access (`sut.x(...)`) over `bindSut` when
 * possible — under bun, `mock.module` does not always replace the SUT's
 * static imports with the mock factory's exports, so destructuring
 * captures whatever the factory returned at the time `mock.module` was
 * called (which can be a snapshot that doesn't reflect later mutations).
 */
export function bindSut<T extends object, K extends keyof T>(
  sut: T,
  keys: readonly K[],
): Pick<T, K> {
  const bound: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    (bound as Record<K, unknown>)[key] = (...args: unknown[]) => {
      const value = (sut as Record<K, unknown>)[key];
      if (typeof value === "function") {
        return (value as (...a: unknown[]) => unknown)(...args);
      }
      return value;
    };
  }
  return bound as Pick<T, K>;
}
