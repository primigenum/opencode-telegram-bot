import { fileURLToPath } from "bun";
import { registerMock } from "./mock-plugin.js";

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

export function mockDep(
  relativePath: string,
  factory: () => Record<string, unknown>,
  fromUrl: string = import.meta.url,
): void {
  const resolved = resolveAlias(relativePath);
  const stripped = resolved.replace(/\.(ts|tsx|js|jsx)$/, "");
  const testFilePath = new URL(fromUrl).pathname;
  const projectRoot = testFilePath.replace(/\/tests\/.*$/, "");
  const baseUrl = `file://${projectRoot}/`;
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    try {
      const candidate = stripped + ext;
      const resolvedCandidate = candidate.startsWith("/")
        ? `${baseUrl}${candidate.slice(1)}`
        : candidate;
      const absPath = fileURLToPath(new URL(resolvedCandidate, baseUrl));
      const absStripped = absPath.replace(/\.(ts|tsx|js|jsx)$/, "");
      registerMock(absStripped, factory);
      registerMock(absPath, factory);
      return;
    } catch {
      // continue
    }
  }
  throw new Error(`Cannot resolve ${relativePath} (resolved: ${resolved}) from ${fromUrl}`);
}
