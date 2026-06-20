import { plugin } from "bun";

interface MockEntry {
  factory: () => Record<string, unknown>;
  globalKey: string;
  uniquePath: string;
  originalPath: string;
}

// Keyed by uniquePath (so each registerMock gets its own entry even if the
// absolute path collides across test files). originalPath is the resolved
// abs path that callers will reference; uniquePath adds a per-registration
// suffix so bun doesn't share the synthetic module across files.
const mocks = new Map<string, MockEntry>();
let counter = 0;

function nextUniquePath(originalPath: string): { uniquePath: string; counter: number } {
  counter += 1;
  return { uniquePath: `${originalPath}?bunTestMock=${counter}`, counter };
}

function nextKey(counter: number): string {
  return `__bunTestMock_${counter}__`;
}

export function registerMock(absPath: string, factory: () => Record<string, unknown>): void {
  const { uniquePath, counter: c } = nextUniquePath(absPath);
  const globalKey = nextKey(c);
  (globalThis as Record<string, unknown>)[globalKey] = factory();
  mocks.set(uniquePath, { factory, globalKey, uniquePath, originalPath: absPath });
}

export function clearMocks(): void {
  for (const entry of mocks.values()) {
    delete (globalThis as Record<string, unknown>)[entry.globalKey];
  }
  mocks.clear();
  counter = 0;
}

function resolveSpecifier(specifier: string, importer: string): string {
  if (specifier.startsWith("/") || specifier.startsWith("file://")) {
    return specifier.replace(/^file:\/\//, "");
  }
  if (!importer) return specifier;
  const dir = importer.substring(0, importer.lastIndexOf("/"));
  const parts = specifier.split("/");
  const stack: string[] = dir.split("/");
  for (const part of parts) {
    if (part === "..") stack.pop();
    else if (part !== ".") stack.push(part);
  }
  return stack.join("/");
}

plugin({
  name: "test-mock-loader",
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => {
      const resolved = resolveSpecifier(args.path, args.importer);
      const stripped = resolved.replace(/\.(ts|tsx|js|jsx)$/, "");
      const candidates = [stripped, ...[".ts", ".tsx", ".js", ".jsx"].map((e) => stripped + e)];
      for (const tryPath of candidates) {
        for (const entry of mocks.values()) {
          if (entry.originalPath === tryPath) {
            return { path: entry.uniquePath, namespace: "test-mock" };
          }
        }
      }
      return undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "test-mock" }, (args) => {
      const entry = mocks.get(args.path);
      if (!entry) {
        return { contents: "", loader: "js" };
      }
      const liveExports = entry.factory();
      (globalThis as Record<string, unknown>)[entry.globalKey] = liveExports;
      const exportEntries = Object.keys(liveExports);
      const lines = exportEntries.map(
        (name) => `export const ${name} = globalThis[${JSON.stringify(entry.globalKey)}].${name};`,
      );
      return { contents: lines.join("\n"), loader: "js" };
    });
  },
});
