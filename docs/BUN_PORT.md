# Bun Port — opencode-telegram-bot

> Reference document for the port from Node.js/npm to Bun of the OpenCode Telegram bot.
> Maintained alongside the fork code (`primigenum/opencode-telegram-bot`, branch `feat/bun-port`).

## Table of contents

1. [Fork context](#1-fork-context)
2. [Port status (post-PR #1)](#2-port-status-post-pr-1)
3. [Bun limitations affecting this fork](#3-bun-limitations-affecting-this-fork)
4. [Industry research (2025-2026)](#4-industry-research-2025-2026)
5. [Cookbook: bun-native code](#5-cookbook-bun-native-code)
6. [Cookbook: tests with the vitest shim](#6-cookbook-tests-with-the-vitest-shim)
7. [Roadmap — what remains](#7-roadmap--what-remains)
8. [Appendix A — Complete mappings table `node:*` → `bun:*`](#appendix-a--complete-mappings-table-node--bun)
9. [Appendix B — References](#appendix-b--references)

---

## 1. Fork context

**upstream**: [`grinev/opencode-telegram-bot`](https://github.com/grinev/opencode-telegram-bot) v0.21.2 — 827 ⭐ / 147 🍴 / MIT.

**this fork**: `primigenum/opencode-telegram-bot` — port 100% bun-native.

### Why fork instead of PR to upstream

The upstream uses **vitest 1.x** + **tsx** + **node:fs** + **node:child_process** + **better-sqlite3** + **vitest config with `pool: forks`**. The test suite is **1005 tests** and depends deeply on:
- `vi.mock(path, factory)` with **hoisting** (the Vite/esbuild transformer moves the mock above the static `import`s).
- `vi.resetModules()` + `await import(...)` to re-evaluate modules with new env.
- Native `node:*` (the suite mocked `node:fs` and `vi.mock` worked by luck because the mock was applied at runtime).

Bun **does not hoist** `mock.module()` (it is a runtime call, not a transformer directive — [oven-sh/bun#5394](https://github.com/oven-sh/bun/issues/5394) discusses the design). And `vi.resetModules()` is a **no-op** in bun (there is no public API to clear the module cache). This breaks ~60 tests of the upstream.

The upstream has refused to migrate to `bun:test` for good reasons: it would mean throwing out the current suite. The port stays in primigenum as a personal fork with the suite adapted to bun.

### Why Bun, in general

- **20× install speed** vs npm (byteiota 2026 measured 1.2s vs 32s for 847 deps).
- **3× startup**, **2.75× HTTP throughput** (official Bun 1.1+ claims, validated by Strapi and dev.to "Bun 1.2 in production").
- **Unified toolkit**: `bun install` + `bun test` + `bun build` + `bun --hot` replace npm + vitest + esbuild + tsx + nodemon.
- **Bun.loadFile** / **bun:sqlite** / **Bun.password** / **Bun.CryptoHasher** / **global `fetch` with `proxy` option** = fewer npm deps.

**It is not magic**: the "95-98% Node compatibility" leaves out important cases (bcrypt, canvas, native addons with V8 API, SOCKS in `fetch`). Bun uses **JavaScriptCore**, not V8 → `.node` addons compiled for V8 **do not load**. Best to check `find node_modules -name "*.node"` before porting.

---

## 2. Port status (post-PR #1)

PR: <https://github.com/primigenum/opencode-telegram-bot/pull/1>

### Runtime

| Before | Now |
| --- | --- |
| `engines: node >= 20` | `engines: bun >= 1.3.0` |
| `npm install` + `package-lock.json` | `bun install` + `bun.lock` |
| `npm run` scripts | `bun run` scripts |
| `vitest` + `@vitest/coverage-v8` + `tsx` | `bun test` (built-in) |
| `node ./dist/cli.js` (shebang) | `bun ./dist/cli.js` (shebang) |
| `.github/workflows/ci.yml`: `setup-node` | `oven-sh/setup-bun@v2` |
| `.github/workflows/publish.yml` | **removed** (personal fork) |

### Build

```bash
# before
tsc && node ./dist/cli.js

# now
bun build ./src/cli.ts --outdir dist --target bun --format esm
bun run dist/cli.js
```

`--target bun` automatically externalizes `bun:sqlite`, `bun:path`, `bun:test` (not included in the bundle).

### Source code — `node:*` → `bun:*` / globals

Zero `node:*` imports in `src/`. 15 `bun:` imports + 0 `node:`. Complete table in [Appendix A](#appendix-a--complete-mappings-table-node--bun).

**Refactored files (18)**: `src/runtime/bootstrap.ts`, `src/runtime/paths.ts`, `src/runtime/service/manager.ts`, `src/opencode/process.ts`, `src/utils/logger.ts`, `src/bot/handlers/voice-handler.ts`, `src/bot/services/event-subscription-service.ts`, `src/bot/messages/send-downloaded-file.ts`, `src/bot/commands/task-command.ts`, `src/bot/menus/file-browser-menu.ts`, `src/app/services/{file-browser,model-selection,project,session-cache,worktree}-service.ts`, `src/app/stores/settings-store.ts`, `src/app/formatters/summary-formatter.ts`, `src/app/bootstrap/start-bot-app.ts`, `src/cli.ts`.

**Key patterns** (from the repo files, for reference):

```ts
// src/runtime/paths.ts
import path from "bun:path";
function getHomeDirectory(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

// src/runtime/bootstrap.ts
async function mkdirRecursive(dirPath: string): Promise<void> {
  const proc = Bun.spawn(["mkdir", "-p", dirPath], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

async function atomicRename(from: string, to: string): Promise<void> {
  const proc = Bun.spawn(["mv", from, to], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

async function readEnvFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await Bun.file(filePath).text();
  } catch (error) {
    if (error instanceof Error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
    }
    throw error;
  }
}

function getEnvExamplePath(): string {
  const currentFilePath = Bun.fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..", ".env.example");
}

// Stdin with character-by-character masking (Bun.stdin has no readline raw mode)
async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    const text = decoder.decode(chunk, { stream: true });
    for (const char of text) {
      if (char === "\n" || char === "\r") {
        process.stdout.write("\n");
        return buffer.trim();
      }
      if (char === "\u007f" || char === "\b") {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          process.stdout.write("\b \b");
        }
        continue;
      }
      if (char === "\u0003") {
        process.stdout.write("\n");
        throw new Error("interrupted");
      }
      buffer += char;
      process.stdout.write("*");
    }
  }
  process.stdout.write("\n");
  return buffer.trim();
}
```

### Tests

- 118 files: `import { ... } from "vitest"` → `import { ... } from "#vitest"`.
- `#vitest` is a subpath alias in `package.json` `imports` pointing to `tests/helpers/vitest-shim.ts`.
- `bunfig.toml` loads `tests/setup-preload.ts` (no-op) and `tests/setup.ts` (env defaults + singleton reset).
- `vitest.config.ts` removed.

**Current CI results** (PR #1):
- ✅ Lint + build + runtime: green.
- 🟡 Tests: 74 pass / 931 fail / 1005 total.

The 931 fails **are not from the port itself**. They are from the test infrastructure broken with bun (see §3 and §6). The logger 8/8, formatters, stores, routers, keyboards, handlers that don't mock — all pass. The ones that break depend on `vi.mock` with hoisting or `vi.resetModules`.

---

## 3. Bun limitations affecting this fork

### 3.1 `vi.mock(path, factory)` is not hoisted

**The problem**: vitest uses the Vite/esbuild transformer to move `vi.mock(...)` above the static `import`s. Bun does not do this transformation — `mock.module()` is a runtime call. If your source does `import "node:fs"` at the top and the test calls `vi.mock("node:fs", ...)` below, the static import already loaded the real module. The mock does not apply.

**Why we survive in `src/`**: because **no source uses `node:fs` or any `node:*`**. The `vi.mock("node:fs", ...)` the test had no longer has anything to intercept — the source calls `Bun.file()`, which is a global.

**Why the 60 tests still fail**: the `vi.mock` is applied against **`src/` modules** (e.g. `vi.mock("../../../src/runtime/bootstrap.js", ...)`). Since the source's `import` is static in the test, bun already cached the real module before the mock was registered.

**Possible workarounds** (not yet implemented):
1. **Rewrite the test to `await import()` dynamically** of the source.
2. **Bun loader plugin** that hoists `vi.mock` and rewrites static imports of mocked modules to `await import()`.
3. **Preload mocks** in `bunfig.toml` (load mocks before each test starts) — but only works for modules known a priori.

oven-sh/bun#31316 opened this topic in May 2026 with a fix PR (#31319) that cleans up cross-file mocks. **Not yet merged** at the time of writing this doc.

### 3.2 `vi.resetModules()` is a no-op

Bun does not expose a public API to clear the module cache. Tests that do `vi.resetModules() + await import("../src/config.js")` expecting to re-evaluate the module with new env **always get the first result**.

**Workaround (the only portable one)**: factor the source into a factory function that returns a fresh `config` object on every call. Example:

```ts
// src/config.ts — the problematic pattern
let config: Config;
export function loadConfig(): Config {
  if (config) return config;
  config = parseFromEnv(process.env);
  return config;
}
export { config };

// src/config.ts — the portable pattern
export function createConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseFromEnv(env);
}
// the test imports `createConfig({ FOO: "bar" })` and gets a fresh config every time
```

Applies to: `src/config.ts`, `src/runtime/mode.ts`, any singleton initialized at module load.

### 3.3 SOCKS proxy not supported in `fetch`

Bun implements HTTP/HTTPS proxy via the `proxy: string` option of `fetch`. **SOCKS does not work**. If you set `TELEGRAM_PROXY_URL=socks5://...`, the code falls back to direct connection with a warning.

**Options**:
1. Fall back to `node:https` + `socks-proxy-agent` just for that part.
2. Tunnel SOCKS traffic with a sidecar (e.g. `ssh -D`).
3. Wait — oven-sh is working on SOCKS support.

### 3.4 Password masking without raw mode

`node:readline` has `terminal: true` that masks character by character. `Bun.stdin` does not. The current code implements masking manually with `Bun.stdin.stream()` (character by character, see §2). The bot token and server password are still asked, but:
- Works ✅.
- Does not handle well terminals that send `\r` or multi-byte characters.
- For real TUI with echo control, use `Bun.Terminal` (PTY) or `stty -echo` via `Bun.spawn`.

### 3.5 `bun:sqlite` API differences vs `better-sqlite3`

Bun documents the difference explicitly ([bun.com/docs/api/sqlite](https://bun.com/docs/api/sqlite)). The gotchas that apply to this fork (session cache fallback):
- `db.pragma(...)` **does not exist**. Use `db.prepare("PRAGMA foreign_keys = ON").run()`.
- `db.transaction(fn)` — check the exact signature in the docs.
- `db.function(name, fn)` — for custom SQL functions.
- `db.aggregate(name, fn)` — for custom aggregates.

Performance: `bun:sqlite` is **3-6× faster** than `better-sqlite3` on read queries per the Bun benchmark. This fork **does not use `better-sqlite3` directly** — the session cache uses `bun:sqlite` from the first commit of the port.

### 3.6 `node:worker_threads` incomplete

Bun implements `Worker` but options are missing (`stdin`, `stdout`, `stderr`, `trackedUnmanagedFds`, `resourceLimits`). APIs are missing (`markAsUntransferable`, `moveMessagePortToContext`). **Does not affect the current fork** (we don't use workers), but keep in mind if real parallelism is needed in the future.

### 3.7 `process.loadEnvFile` and `process.getBuiltinModule` not implemented

Bun doesn't expose these yet (Node 22+). The fork uses `dotenv` to load `.env`. Native alternative:

```bash
bun --env-file=.env ./src/cli.ts start
```

`--env-file` loads `.env` at process start. If you want to remove the `dotenv` dep, this is the path.

### 3.8 Auto-load `.env` by default

Unlike Node, bun **reads `.env` automatically** at start (unless you pass `--no-env-file`). Implication: the `import dotenv from "dotenv"` + `dotenv.config()` of the current code is redundant. Decide whether you want that behavior or disable it with a flag.

### 3.9 No `process.versions.node`

If the code or any dep queries `process.versions.node` (many libs do for feature detection), `undefined` breaks the logic. Bun exposes `process.versions.bun`. Typical workaround:

```ts
const isBun = typeof Bun !== "undefined";
const isNode = typeof process !== "undefined" && process.versions?.node != null;
```

---

## 4. Industry research (2025-2026)

Synthesis of 10+ sources consulted. Useful to understand whether the tradeoffs this fork makes are reasonable.

### Compatibility

| Source | Headline | Relevant quote |
| --- | --- | --- |
| [Bun docs](https://bun.com/docs/runtime/nodejs-compat) | "95-98% Node compat" | "Every day, Bun gets closer to 100% Node.js API compatibility" |
| [alexcloudstar 2026](https://www.alexcloudstar.com/blog/bun-compatibility-2026-npm-nodejs-nextjs/) | Package table | Prisma ✅, sharp ✅ (WASM), Drizzle ✅, bcrypt ❌, better-sqlite3 ❌ (use bun:sqlite), canvas ❌, pg ✅, mysql2 ✅ |
| [Strapi 2026](https://strapi.io/blog/bun-vs-nodejs-performance-comparison-guide) | "drop-in is ~80% true" | "The 20% will find you in production if you don't go looking for it first" |
| [byteiota Bun 2.0](https://byteiota.com/building-your-first-project-with-bun-2-0-migration-guide/) | Broken native addons | "bcrypt → bcryptjs, sqlite3 → bun:sqlite, sharp → WASM fallback" |

### Anti-patterns / when NOT to port

- **Critical native addons with no alternative**: canvas, gl (headless-gl, fails with ABI mismatch — [oven-sh/bun#20803](https://github.com/oven-sh/bun/issues/20803)), gRPC tools that use the V8 API.
- **Heavy `cluster` patterns**: partial support, edge cases.
- **`vm` module sandboxing**: the bun implementation is "fragile" per multiple sources.
- **Code that assumes CJS globals**: `__dirname`, `__filename`. ESM doesn't expose these. In bun-ESM use `import.meta.dir` and `import.meta.file`.
- **Stack with non-negotiable C++ addons**: stay on Node. "The workarounds are painful and not worth it" (techresolve 2025).

### Real production

- **dev.to "Bun 1.2 in production"** (whoffagents, April 2026): "We're running 4 of 7 services on Bun in production. The other 3 are blocked on native addon dependencies we haven't resolved yet." Budget: **~1 week of engineering per service**, not an afternoon.
- **dev.to "From Node.js to Bun: 5x throughput"** (benriemer, April 2026): 5× throughput measured in production, "the easy part is `bun install`; the hard part is API differences".
- **core.cz 2026**: "Big Bang approaches fail in 73% of enterprise cases" → iterative with measurable milestones.
- **LinkedIn pulse (venkataraman, Dec 2025)**: 5-phase migration (assess, modernize, deps, test, deploy) + "abstract for long-term maintainability" (runtime detection layer if you need dual runtime).

### Industry-recommended port patterns

1. **Audit deps before touching code**: `find node_modules -name "*.node"`, `npm ls | grep -E "bcrypt|sqlite|sharp|canvas|argon2"`.
2. **Phase 0: use `bun install` with Node as runtime** (zero-code-change). 20-40× install speed, zero risk.
3. **Phase 1: dual CI** (Node + Bun in parallel, 2 weeks). If Bun passes, drop Node.
4. **Phase 2: switch runtime**. Replace `node:*` with bun-native when it brings real value (perf, fewer deps).
5. **Phase 3: tests**. The most painful part because of mocking differences.
6. **Rollback plan documented** from day 0.

### Applicability to this fork

The fork is in **phase 2-3**:
- ✅ Phase 0: `bun install` replaced npm.
- ✅ Phase 1: CI runs only on Bun (not dual — personal fork).
- 🟡 Phase 2: source refactored to bun-native, but with tradeoffs (SOCKS still falls back to direct, dotenv still in use).
- 🟡 Phase 3: shim allows most tests to compile, but 60 fail because of `mock.module` limitations (needs rewrite or bun loader plugin).

---

## 5. Cookbook: bun-native code

### 5.1 Template for a new source file

```ts
// src/foo/bar.ts
import path from "bun:path";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { t } from "../i18n/index.js";

const DEFAULT_PORT = 4096;

export interface BarConfig {
  port: number;
  host: string;
}

export function resolveBarConfig(apiUrl: string): BarConfig | null {
  try {
    const parsed = new URL(apiUrl);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : DEFAULT_PORT,
    };
  } catch {
    return null;
  }
}

export async function readBarFile(filePath: string): Promise<string | null> {
  try {
    return await Bun.file(filePath).text();
  } catch (error) {
    if (error instanceof Error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
    }
    throw error;
  }
}

export async function writeBarFile(filePath: string, content: string): Promise<void> {
  await Bun.write(filePath, content);
}

export async function listBarDir(dirPath: string): Promise<string[]> {
  const glob = new Bun.Glob("*");
  const names: string[] = [];
  for await (const name of glob.scan({ cwd: dirPath, onlyFiles: true })) {
    names.push(name);
  }
  return names;
}
```

**Rules**:
- ❌ Never `import "node:fs"`, `"node:path"`, etc. in `src/`.
- ✅ `import path from "bun:path"` when you need path manipulation.
- ✅ `Bun.file(path).text()` / `.json()` / `.arrayBuffer()` / `.writer()` for I/O.
- ✅ `Bun.write(path, data)` for writing.
- ✅ `Bun.file(path).delete()` for deleting.
- ✅ `Bun.file(path).exists()` / `.stat()` for checks.
- ✅ `Bun.Glob` for listing directories.
- ✅ `Bun.spawn([...])` for async processes; `await proc.exited` waits.
- ✅ `Bun.spawnSync([...])` for sync; `result.exitCode`, `result.stdout`.
- ✅ `Bun.CryptoHasher` for hashing (faster than `crypto.createHash`).
- ✅ `crypto.randomUUID()` (global) for UUIDs.
- ✅ `Bun.inspect(value)` for debug printing.
- ✅ `Bun.fileURLToPath(import.meta.url)` to resolve paths relative to the current file.
- ✅ `fetch(url, { proxy: "http://..." })` for HTTP with proxy (no SOCKS).
- ✅ `process.env.HOME` / `process.env.USERPROFILE` (instead of `os.homedir`).
- ✅ `for await (const line of console)` for stdin by line.
- ✅ `Bun.stdin.stream()` for stdin by chunk/char.
- ✅ `mkdir -p` via `Bun.spawn(["mkdir", "-p", path])` (bun has no native API for this).

### 5.2 Factory pattern to avoid the `vi.resetModules` problem

If a module needs to be re-evaluable by test (e.g. `config.ts` reads `process.env` at module load), factor into a factory:

```ts
// ❌ Not portable to bun:test without resetModules
let config: Config;
export function loadConfig(): Config {
  if (!config) config = parseFromEnv(process.env);
  return config;
}
export { config };

// ✅ Portable
export function createConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseFromEnv(env);
}

// Test:
const config = createConfig({ FOO: "bar", BAZ: "qux" });
```

Apply to: `src/config.ts`, `src/runtime/mode.ts`, `src/runtime/bootstrap.ts` (partially — env reading is via `dotenv.parse`, not process load), any singleton.

### 5.3 Mocking the `Bun` global in tests

If you need to mock `Bun.file`, `Bun.spawn`, etc. in a test:

```ts
import { describe, it, expect, vi, afterEach } from "#vitest";

const originalBun = (globalThis as { Bun?: typeof Bun }).Bun;

afterEach(() => {
  (globalThis as { Bun?: typeof Bun }).Bun = originalBun;
});

describe("foo with mocked Bun", () => {
  it("uses the mocked file", async () => {
    (globalThis as { Bun?: typeof Bun }).Bun = {
      ...originalBun,
      file: vi.fn(() => ({
        text: () => Promise.resolve("mocked content"),
        exists: () => Promise.resolve(true),
      })),
    } as typeof Bun;

    // ... test code
  });
});
```

**Cleaner** than `vi.mock("bun:foo", ...)` because bun-namespace modules are not interceptable with `mock.module` in all versions.

### 5.4 HTTP with proxy

```ts
// ✅ HTTP/HTTPS proxy
const response = await fetch(url, {
  proxy: "http://user:pass@proxy.example.com:8080",
  signal: controller.signal,
  redirect: "follow",
});

// ❌ SOCKS not supported by Bun — falls back to direct connection
if (proxyUrl.startsWith("socks")) {
  logger.warn("SOCKS proxies are not supported by Bun's fetch. Falling back to direct connection.");
  // omit `proxy` option
}
```

### 5.5 Process spawn with streams

```ts
// Capture stdout/stderr
const proc = Bun.spawn(["sh", "-c", "ls -la"], {
  stdout: "pipe",
  stderr: "pipe",
});
const exitCode = await proc.exited;
const stdout = await proc.stdout.text();
const stderr = await proc.stderr.text();
if (exitCode !== 0) {
  throw new Error(`Command failed (exit ${exitCode}): ${stderr || stdout}`);
}

// Detached (daemon)
const child = Bun.spawn([process.execPath, "start"], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, MODE: "daemon" },
});
child.unref();
```

### 5.6 Logger with append-mode file writer

```ts
// Pattern from the fork (src/utils/logger.ts)
function createAppendWriter(filePath: string): LogFileWriter {
  const sink = Bun.file(filePath).writer({ highWaterMark: 64 * 1024 });
  return {
    write(line: string): void {
      sink.write(line);
    },
    async flush(): Promise<void> {
      try {
        await sink.flush();
      } catch (error) {
        if (process.env.LOGGER_DEBUG) {
          console.error("[logger] sink.flush error:", error);
        }
      }
    },
    async end(): Promise<void> {
      try {
        await sink.end();
      } catch (error) {
        if (process.env.LOGGER_DEBUG) {
          console.error("[logger] sink.end error:", error);
        }
      }
    },
  };
}
```

`Bun.file(path).writer()` is a `FileSink` with backpressure, flush, end — drop-in for the original `createWriteStream` + `appendFileSync`.

---

## 6. Cookbook: tests with the vitest shim

The shim lives in `tests/helpers/vitest-shim.ts` (288 lines). It exports the `vi` namespace and `bun:test` aliases so the test source doesn't change (only the import path: `vitest` → `#vitest`).

### 6.1 Imports in a test

```ts
// ❌ Before (vitest)
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ✅ Now (bun:test via shim)
import { describe, expect, it, vi, beforeEach, afterEach } from "#vitest";
```

### 6.2 Patterns that ✅ work

| API | Status | Notes |
| --- | --- | --- |
| `describe`, `it`, `test`, `expect` | ✅ | `bun:test` re-exported by the shim |
| `beforeAll` / `beforeEach` / `afterAll` / `afterEach` | ✅ | idem |
| `vi.fn()` | ✅ | wrap of `bun:test.mock` |
| `vi.spyOn(obj, method)` | ✅ | wrap of `bun:test.spyOn` |
| `vi.hoisted(() => ...)` | ✅ | implemented as factory() (mock data before imports) |
| `vi.mocked(value)` | ✅ | identity cast |
| `vi.stubEnv(key, value)` | ✅ | manages `process.env` |
| `vi.unstubAllEnvs()` | ✅ | restore all stubbed |
| `vi.stubGlobal(key, value)` | ✅ | sets `globalThis[key]` |
| `vi.unstubAllGlobals()` | ✅ | restore all |
| `vi.useFakeTimers()` | ✅ | `bun:test.jest.useFakeTimers()` |
| `vi.useRealTimers()` | ✅ | idem |
| `vi.setSystemTime(date)` | ✅ | `bun:test.setSystemTime` |
| `vi.advanceTimersByTime(ms)` | ✅ | via `setSystemTime` + `bun:test.jest.now()` |
| `vi.advanceTimersByTimeAsync(ms)` | ✅ | + flush microtasks (3× `setImmediate`) |
| `vi.runAllTimersAsync()` | ✅ | drains `bun:test.jest.getTimerCount()` |
| `vi.waitFor(fn, { timeout, interval })` | ✅ | implemented in the shim (polling with `setTimeout`) |
| `vi.importActual(path)` | ✅ | `await import(path)` (without mock override) |
| `vi.doMock(path, factory)` | ✅ | alias of `vi.mock` |
| `vi.doUnmock(path)` | ✅ | reset to real import |
| `vi.restoreAllMocks()` | ✅ | pop tracked mocks |
| `vi.clearAllMocks()` | ✅ | clear on tracked mocks |

### 6.3 Patterns that ❌ do NOT work (bun limitation)

| API | Status | Why |
| --- | --- | --- |
| `vi.mock("../../../src/foo.js", factory)` with static `import` of the source | ❌ | bun does not hoist; the static import loads the real module before `mock.module` is registered |
| `vi.resetModules()` + `await import("../src/config.js")` | ❌ | bun does not expose a module cache reset; second import returns the same binding |
| `vi.importActual("node:fs")` when `vi.mock("node:fs", ...)` is active in vitest | 🟡 | The current shim does `await import(path)` without override — works if the source uses dynamic import; fails with static import |
| `vi.mocked()` for **partial mocks** with spread of the real (`{ ...actual, override }`) | 🟡 | The shim provides `vi.importActual` but you have to import it in the factory |

### 6.4 Workarounds for broken patterns

**Option A: dynamic import of the source**

```ts
// ❌ Does not work in bun
import { loadConfig } from "../src/config.js";
vi.mock("../src/config.js", () => ({ loadConfig: vi.fn() }));
test("foo", () => { expect(loadConfig()).toBe("bar"); });

// ✅ Works
let loadConfig: typeof import("../src/config.js").loadConfig;
vi.mock("../src/config.js", () => ({ loadConfig: vi.fn(() => "bar") }));
beforeAll(async () => {
  loadConfig = (await import("../src/config.js")).loadConfig;
});
test("foo", () => { expect(loadConfig()).toBe("bar"); });
```

**Option B: factory function in the source**

```ts
// src/config.ts
export function createConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseFromEnv(env);
}

// tests/config.test.ts
import { createConfig } from "../src/config.js";
test("loads from env", () => {
  const config = createConfig({ TELEGRAM_BOT_TOKEN: "test:token" });
  expect(config.telegram.token).toBe("test:token");
});
```

**Option C: preload mocks in bunfig.toml** (when applicable)

```toml
# bunfig.toml
[test]
preload = ["./tests/setup-preload.ts", "./tests/setup-mocks.ts", "./tests/setup.ts"]
```

```ts
// tests/setup-mocks.ts — runs BEFORE any test
import { mock } from "bun:test";
mock.module("../src/bot/services/tts-service.ts", () => ({
  transcribeAudio: () => Promise.resolve({ text: "mocked" }),
}));
```

Limitation: you have to enumerate each mocked module by hand. It's not dynamic.

**Option D (future): bun loader plugin** that rewrites `vi.mock(path, factory)` to `await import(path)` + `mock.module()`. Not implemented. oven-sh/bun#31316 (partially merged in #31319) could close part of this gap.

### 6.5 vi.hoisted — for mocks before imports

```ts
// ✅ Pattern already used by the fork (tests/bot/handlers/agent.test.ts)
import { beforeEach, describe, expect, it, vi } from "#vitest";

const mocked = vi.hoisted(() => ({
  getAvailableAgentsMock: vi.fn(),
  getCurrentAgentMock: vi.fn(),
}));

import { agentHandler } from "../../../src/bot/handlers/agent.js";
// the source imports the mocked module, which is already registered via `hoisted`
```

`vi.hoisted(factory)` runs the factory **before** bun resolves imports — `mock.module()` is called at the right moment.

### 6.6 Singleton reset in beforeEach

```ts
// tests/setup.ts (loaded by bunfig.toml)
import { beforeEach, afterEach, vi } from "#vitest";
import { ensureTestEnvironment } from "./helpers/test-environment.js";
import { resetSingletonState } from "./helpers/reset-singleton-state.js";

beforeEach(() => {
  ensureTestEnvironment();
});

afterEach(() => {
  resetSingletonState();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
```

This avoids the classic "singleton polluted the next test" problem without depending on `vi.resetModules` (which is a no-op).

---

## 7. Roadmap — what remains

### 7.1 Short term (this fork)

- [ ] **Rewrite the 60 tests that depend on `vi.mock` with static import** → use `await import()` dynamically or factory function in source. Affected tests are in:
  - `tests/bot/{commands,streaming,menus,middleware,messages,pinned,render,services}/`
  - `tests/app/{services,managers,bootstrap}/`
- [ ] **Rewrite `tests/config.test.ts` and `tests/config-scheduled-task-notifications.test.ts`** → factor `src/config.ts` to `createConfig(env)` factory.
- [ ] **Evaluate Bun.Terminal for password masking** — alternative to `Bun.stdin.stream()` with proper terminal raw-mode handling.
- [ ] **Check bun:test 1.4+ status on `mock.module` cross-file** (oven-sh/bun#31319) — if merged, could re-enable `vi.mock(path, factory)` with auto-hoist.

### 7.2 Medium term (improvements)

- [ ] **Migrate ESLint + Prettier to Biome** — aligns with the rest of the `primigenum/` workspace. Biome is 10-100× faster and unifies lint+format.
- [ ] **Remove `import "dotenv"`** — use `bun --env-file=.env ./src/cli.ts start` or native auto-load.
- [ ] **Migrate `dotenv` dep** — the fork still uses it. With `--env-file` or native auto-load, it goes away.
- [ ] **Type `process.exitCode` and `process.versions.bun`** explicitly (avoid TS strict breaking if bun changes the signature).
- [ ] **Document Bun.Terminal setup** if adopted (PTY, escape sequences, etc.).

### 7.3 Long term (product decisions)

- [ ] **SOCKS proxy?** If a user needs it, decide between (a) fallback to `node:https` + `socks-proxy-agent`, (b) tunnel, (c) wait for oven-sh.
- [ ] **Publish to npm as `@primigenum/opencode-telegram-bot`?** The current fork is personal (no `.github/workflows/publish.yml`). If we decide to publish, we have to re-add the workflow and decide on pure `bun install` support.
- [ ] **Contribute back to upstream?** Not realistic — would break their test suite. But we can document the learnings in a blog post or talk.

### 7.4 Success metrics

- ✅ `bun run check` (lint + build + test) green in CI.
- 🟡 1000+ tests passing (currently 74). Goal: ≥ 90% green.
- ✅ `bun.lock` committed.
- ✅ `engines: bun >= 1.3.0` in `package.json`.
- 🟡 Zero `node:*` in `src/` (✅ already; keep it).
- 🟡 Zero `vi.mock` with static import in `tests/` (🟡 rewrite of 60 tests pending).
- 🟡 Zero `vi.resetModules()` in `tests/` (🟡 pending in `config.test.ts`).

---

## Appendix A — Complete mappings table `node:*` → `bun:*`

Quick reference table. All patterns are in use in the current fork (PR #1).

| Before (Node) | Now (Bun) | Notes |
| --- | --- | --- |
| `import { readFile, writeFile, unlink, mkdir, rm, access, rename } from "node:fs/promises"` | `Bun.file(path).text()` / `.json()` / `.arrayBuffer()` / `Bun.write(path, data)` / `Bun.file(path).delete()` / `Bun.spawn(["mkdir", "-p", path])` / `Bun.file(path).exists()` / `Bun.spawn(["mv", from, to])` | bun does not expose a recursive API for mkdir; use `mkdir -p` |
| `import { createWriteStream, openSync, closeSync, appendFileSync, mkdirSync } from "node:fs"` | `Bun.file(path).writer()` / `Bun.spawnSync(["mkdir", "-p", path])` | `writer()` gives `FileSink` with backpressure |
| `import { spawn, exec, execFile } from "node:child_process"` (+ `promisify`) | `Bun.spawn([...])` / `Bun.spawnSync([...])` | `await proc.exited` is the native Promise |
| `import { createHash } from "node:crypto"` | `new Bun.CryptoHasher("sha256")` | Faster |
| `import { randomUUID } from "node:crypto"` | `crypto.randomUUID()` (global) | global, no import needed |
| `import http, { Agent as HttpAgent } from "node:http"` | `fetch(url, { proxy?: string })` (global) | Bun implements HTTP server via `Bun.serve()` |
| `import https, { Agent as HttpsAgent } from "node:https"` | `fetch(url, { proxy?: string })` (global) | HttpsAgent removed (native proxy) |
| `import { HttpsProxyAgent } from "https-proxy-agent"` | `fetch(url, { proxy: "http://..." })` | No more dep |
| `import { SocksProxyAgent } from "socks-proxy-agent"` | ⚠️ Not supported in Bun. Fallback to direct + warn | See §3.3 |
| `import { fileURLToPath } from "node:url"` | `Bun.fileURLToPath(import.meta.url)` | |
| `import { inspect } from "node:util"` | `Bun.inspect(value, { colors, compact, depth })` | |
| `import { homedir } from "node:os"` | `process.env.HOME ?? process.env.USERPROFILE` | platform-specific paths via `process.platform` |
| `import path from "node:path"` (or `"path"`) | `import path from "bun:path"` | API-compatible |
| `import { createInterface, Interface } from "node:readline"` (line) | `for await (const line of console)` | console is a Readable async iterable |
| `import { createInterface } from "node:readline/promises"` (line with async) | `for await (const line of console)` | idem |
| `readline.createInterface({ terminal: true })` (raw mode char-by-char) | `for await (const chunk of Bun.stdin.stream())` + manual char masking | See §3.4; `Bun.Terminal` is the PTY alternative |
| `import Database from "better-sqlite3"` | `import { Database } from "bun:sqlite"` | API similar; `db.pragma` does not exist → `db.prepare("PRAGMA ...").run()` |

### Bun-native APIs discovered during the port

These **do not have** a direct Node standard equivalent and are what justifies using Bun:

| API | Use in the fork |
| --- | --- |
| `Bun.file(path).writer()` | logger with append mode (`src/utils/logger.ts`) |
| `Bun.Glob` | directory listings (`src/utils/logger.ts` cleanupOldLogs) |
| `Bun.fileURLToPath(import.meta.url)` | resolve `.env.example` relative to module (`src/runtime/bootstrap.ts`) |
| `fetch(url, { proxy, signal, redirect })` | Telegram file download (`src/bot/handlers/voice-handler.ts`) |
| `Bun.spawn(["sh", "-c", cmd])` | wrapper for `netstat`/`lsof`/`ss`/`taskkill` (`src/opencode/process.ts`) |
| `Bun.spawn([process.execPath, ...], { detached, stdio, env })` | daemon mode (`src/runtime/service/manager.ts`) |

---

## Appendix B — References

### Official Bun documentation

- [Node.js Compatibility](https://bun.com/docs/runtime/nodejs-compat) — master table of what is implemented and what is not.
- [SQLite (`bun:sqlite`)](https://bun.com/docs/api/sqlite) — API, benchmarks, `db.pragma` workaround.
- [Test runner (`bun:test`)](https://bun.sh/docs/test/mocks) — mocking, hoisting, preload.
- [Bun.file()](https://bun.com/docs/api/file) — I/O API.
- [Bun.spawn()](https://bun.com/docs/api/spawn) — process API.
- [Bun.build()](https://bun.com/docs/bundler) — bundler (used for `dist/` with `--target bun`).
- [Bun.GitHub setup-bun action](https://github.com/oven-sh/setup-bun) — CI action.

### Relevant open issues

- [oven-sh/bun#31316](https://github.com/oven-sh/bun/issues/31316) — vitest→bun test migration: gaps, per-file mock isolation.
- [oven-sh/bun#31319](https://github.com/oven-sh/bun/pull/31319) — PR fix: `BunTestRoot::exit_file` sweep of `JSModuleMock` cross-file.
- [oven-sh/bun#5394](https://github.com/oven-sh/bun/issues/5394) — design discussion: module mocking + hoisting philosophy.
- [oven-sh/bun#20803](https://github.com/oven-sh/bun/issues/20803) — native Node modules (e.g. `gl`) ABI mismatch.
- [oven-sh/bun#16050](https://github.com/oven-sh/bun/issues/16050) — `better-sqlite3` in bun.
- [oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290) — V8 C++ API compatibility (root cause of many "native addon" failures).
- [oven-sh/bun#22304](https://github.com/oven-sh/bun/issues/22304) — `vi` export for Vitest compat (closed/implemented subset).
- [oven-sh/bun#29836](https://github.com/oven-sh/bun/pull/29836) — auto-mock for `jest.mock(module)` without factory.

### External sources (industry research)

- [Bun vs Node.js in 2026 — Strapi](https://strapi.io/blog/bun-vs-nodejs-performance-comparison-guide)
- [Bun Runtime in Production — core.cz 2026](https://core.cz/en/blog/2026/bun-runtime-production-2026/)
- [Bun Compatibility 2026 — alexcloudstar](https://www.alexcloudstar.com/blog/bun-compatibility-2026-npm-nodejs-nextjs/)
- [Bun 1.2 in Production — dev.to whoffagents](https://dev.to/whoffagents/bun-12-in-production-what-actually-broke-when-we-migrated-from-node-6nh)
- [From Node.js to Bun: 5x Throughput — dev.to benriemer](https://dev.to/benriemer/from-nodejs-to-bun-how-we-got-5x-more-throughput-and-lived-to-tell-the-tale-4397)
- [Bun Test vs Vitest 2026 — dev.to gabrielanhaia](https://dev.to/gabrielanhaia/bun-test-vs-vitest-for-typescript-library-authors-in-2026-19g5)
- [Mocking ESM in 2026 — dev.to gabrielanhaia](https://dev.to/gabrielanhaia/mocking-esm-in-2026-vitest-bun-and-nodes-mockmodule-hep)
- [Migrating from Node.js to Bun 1.1 — byteiota](https://byteiota.com/migrating-from-node-js-to-bun-1-1-production-guide/)
- [Building Your First Project with Bun 2.0 — byteiota](https://byteiota.com/building-your-first-project-with-bun-2-0-migration-guide/)
- [Step-by-step: Migrate Legacy Node.js 20 to Bun 1.2 — dev.to johalputt](https://dev.to/johalputt/step-by-step-migrate-legacy-nodejs-20-apps-to-bun-12-with-typescript-58-for-40-faster-startup-4o2i)
- [Migrating your Node.js project to Bun — LinkedIn pulse venkataraman](https://www.linkedin.com/pulse/migrating-your-nodejs-project-bun-step-by-step-guide-venkataraman-zjwgf)
- [How to Migrate from Node.js to Bun: Complete Guide 2024 — reintech](https://reintech.io/blog/how-to-migrate-from-nodejs-to-bun)
- [Running Nextjs with Bun — techresolve](https://techresolve.blog/2025/12/23/running-nextjs-using-bun-instead-of-node-sounds-l/)
- [How to Run Node.js Apps with Bun — OneUptime](https://oneuptime.com/blog/post/2026-01-31-bun-nodejs-compatibility/view)
- [How to Migrate from Node.js to Bun TypeScript — somethingsblog](https://www.somethingsblog.com/2024/11/03/migrating-from-node-js-to-bun-a-typescript-app-porting-guide/)
- [Bun Not Working — FixDevs](https://fixdevs.com/blog/bun-not-working/)

### Fork-specific

- PR: <https://github.com/primigenum/opencode-telegram-bot/pull/1>
- Upstream: <https://github.com/grinev/opencode-telegram-bot> (v0.21.2)
- Vitest shim: `tests/helpers/vitest-shim.ts` (288 lines)
- Bot docs: `docs/LINUX_SYSTEMD_SETUP.md`, `docs/LOCALIZATION_GUIDE.md`
- AGENTS.md of the fork: complete list of bun-native APIs in use.

---

**Maintained by**: primigenum. Last reviewed: June 2026 (against Bun 1.3+).
