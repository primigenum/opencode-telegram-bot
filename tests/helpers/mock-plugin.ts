import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { plugin } from "bun";

interface MockEntry {
  factoryKey: string;
  originalPath: string;
  filePath: string;
}

const mocks = new Map<string, MockEntry>();
let counter = 0;

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

function stripExt(path: string): string {
  return path.replace(/\.(ts|tsx|js|jsx)$/, "");
}

function buildSyntheticSource(factoryKey: string): string {
  return [
    `// Auto-generated test mock — DO NOT EDIT`,
    `const __f = globalThis[${JSON.stringify(factoryKey)}];`,
    `for (const __k of Object.keys(__f())) {`,
    `  Object.defineProperty(exports, __k, {`,
    `    enumerable: true,`,
    `    get() { return __f()[__k]; },`,
    `  });`,
    `}`,
  ].join("\n");
}

export function registerMock(absPath: string, factory: () => Record<string, unknown>): void {
  if (mocks.has(absPath)) return;
  counter += 1;
  const factoryKey = `__bunTestMockFactory_${counter}__`;
  (globalThis as Record<string, unknown>)[factoryKey] = factory;
  // Write the synthetic module to a real file on disk. The plugin
  // returns this file path from onResolve, so bun reads it like any
  // other module — no virtual namespace, no onLoad filter gotchas.
  const cacheDir = join(process.cwd(), "node_modules", ".bun-test-mocks");
  mkdirSync(cacheDir, { recursive: true });
  const filePath = join(cacheDir, `mock-${counter}.mjs`);
  writeFileSync(filePath, buildSyntheticSource(factoryKey));
  const entry: MockEntry = { factoryKey, originalPath: absPath, filePath };
  mocks.set(absPath, entry);
  const stripped = stripExt(absPath);
  if (!mocks.has(stripped)) mocks.set(stripped, entry);
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    if (absPath.endsWith(ext)) continue;
    const alt = stripped + ext;
    if (!mocks.has(alt)) mocks.set(alt, entry);
  }
}

export function clearMocks(): void {
  for (const entry of mocks.values()) {
    rmSync(entry.filePath, { force: true });
    delete (globalThis as Record<string, unknown>)[entry.factoryKey];
  }
  mocks.clear();
  counter = 0;
}

plugin({
  name: "test-mock-loader",
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => {
      const resolved = resolveSpecifier(args.path, args.importer);
      const candidates = [resolved, stripExt(resolved)];
      for (const tryPath of candidates) {
        const entry = mocks.get(tryPath);
        if (entry) {
          // Return the file as a file:// URL. Bun treats it as a file
          // and reads its contents. The file references globalThis via
          // getters so test mutations to the shared mock state are
          // reflected on every access.
          return { path: `file://${entry.filePath}` };
        }
      }
      return undefined;
    });
  },
});
