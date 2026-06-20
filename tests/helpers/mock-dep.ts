import { fileURLToPath } from "bun";
import { registerMock } from "./mock-plugin.js";

export function mockDep(
  relativePath: string,
  factory: () => Record<string, unknown>,
  fromUrl: string = import.meta.url,
): void {
  const stripped = relativePath.replace(/\.(ts|tsx|js|jsx)$/, "");
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    try {
      const absPath = fileURLToPath(new URL(stripped + ext, fromUrl));
      const absStripped = absPath.replace(/\.(ts|tsx|js|jsx)$/, "");
      registerMock(absStripped, factory);
      registerMock(absPath, factory);
      return;
    } catch {
      // continue
    }
  }
  throw new Error(`Cannot resolve ${relativePath} from ${fromUrl}`);
}
