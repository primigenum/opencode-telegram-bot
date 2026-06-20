import { plugin } from "bun";

interface MockEntry {
  factory: () => Record<string, unknown>;
  exports: Record<string, unknown>;
}

const mocks = new Map<string, MockEntry>();

export function registerMock(absPath: string, factory: () => Record<string, unknown>): void {
  if (!mocks.has(absPath)) {
    const exports = factory();
    mocks.set(absPath, { factory, exports });
  }
}

export function clearMocks(): void {
  mocks.clear();
}

function resolveSpecifier(specifier: string, importer: string): string {
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
        if (mocks.has(tryPath)) {
          return { path: tryPath, namespace: "test-mock" };
        }
      }
    });
    builder.onLoad({ filter: /.*/, namespace: "test-mock" }, (args) => {
      const entry = mocks.get(args.path);
      if (!entry) {
        return { contents: "", loader: "js" };
      }
      const sym = `__test_mock__:${args.path}`;
      (globalThis as Record<string, unknown>)[sym] = entry.exports;
      const exportEntries = Object.keys(entry.exports);
      const lines = exportEntries.map((name) => {
        return `export const ${name} = globalThis[${JSON.stringify(sym)}][${JSON.stringify(name)}];`;
      });
      return { contents: lines.join("\n"), loader: "js" };
    });
  },
});
