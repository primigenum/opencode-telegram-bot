import { beforeAll } from "bun:test";
import { fileURLToPath } from "bun";

export function loadSut<T extends object>(relativePath: string, fromUrl: string = import.meta.url): T {
  const stripped = relativePath.replace(/\.(ts|tsx|js|jsx)$/, "");
  const candidates = [
    stripped + ".ts",
    stripped + ".tsx",
    stripped + ".js",
    stripped + ".jsx",
  ];
  let absPath: string | null = null;
  for (const candidate of candidates) {
    try {
      absPath = fileURLToPath(new URL(candidate, fromUrl));
      break;
    } catch {
      // continue
    }
  }
  if (!absPath) {
    throw new Error(`Cannot resolve ${relativePath} from ${fromUrl}`);
  }
  let instance: T;
  beforeAll(async () => {
    instance = (await import(absPath as string)) as T;
  });
  return new Proxy({} as T, {
    get(_target, prop) {
      if (!instance) {
        throw new Error(`SUT not loaded yet: ${absPath}`);
      }
      return instance[prop as keyof T];
    },
  });
}
