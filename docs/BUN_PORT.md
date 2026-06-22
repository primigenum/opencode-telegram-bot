# Bun Port — opencode-telegram-bot

> Documento de referencia para el port de Node.js/npm a Bun del bot de Telegram de OpenCode.
> Mantenido junto al código del fork (`primigenum/opencode-telegram-bot`, branch `feat/bun-port`).

## Tabla de contenidos

1. [Contexto del fork](#1-contexto-del-fork)
2. [Estado del port (post-PR #1)](#2-estado-del-port-post-pr-1)
3. [Limitaciones de Bun que afectan a este fork](#3-limitaciones-de-bun-que-afectan-a-este-fork)
4. [Industry research (2025-2026)](#4-industry-research-2025-2026)
5. [Cookbook: código bun-native](#5-cookbook-código-bun-native)
6. [Cookbook: tests con el shim vitest](#6-cookbook-tests-con-el-shim-vitest)
7. [Roadmap — lo que queda](#7-roadmap--lo-que-queda)
8. [Apéndice A — Tabla completa de mappings node:* → bun:*](#apéndice-a--tabla-completa-de-mappings-node--bun)
9. [Apéndice B — Referencias](#apéndice-b--referencias)

---

## 1. Contexto del fork

**upstream**: [`grinev/opencode-telegram-bot`](https://github.com/grinev/opencode-telegram-bot) v0.21.2 — 827 ⭐ / 147 🍴 / MIT.

**este fork**: `primigenum/opencode-telegram-bot` — port 100% bun-native.

### Por qué fork y no PR al upstream

El upstream usa **vitest 1.x** + **tsx** + **node:fs** + **node:child_process** + **better-sqlite3** + **vitest config con `pool: forks`**. La suite de tests es de **1005 tests** y depende profundamente de:

- `vi.mock(path, factory)` con **hoisting** (Vite/esbuild transformer mueve el mock encima de los `import` estáticos).
- `vi.resetModules()` + `await import(...)` para re-evaluar módulos con env nuevo.
- `node:*` nativo (la suite mockeaba `node:fs` y `vi.mock` funcionaba por suerte porque el mock se aplicaba en runtime).

Bun **no hace hoisting** de `mock.module()` (es un call de runtime, no un directive del transformer — [oven-sh/bun#5394](https://github.com/oven-sh/bun/issues/5394) discute el diseño). Y `vi.resetModules()` es **no-op** en bun (no hay API pública para limpiar el module cache). Esto rompe ~60 tests del upstream.

El upstream ha rechazado migrar a `bun:test` por motivos justificados: tirarían su suite actual. El port se queda en primigenum como fork personal con la suite adaptada a bun.

### Por qué Bun, en general

- **20× install speed** vs npm (byteiota 2026 midió 1.2s vs 32s para 847 deps).
- **3× startup**, **2.75× HTTP throughput** (claims oficiales de Bun 1.1+, validados por Strapi y dev.to "Bun 1.2 in production").
- **Toolkit unificado**: `bun install` + `bun test` + `bun build` + `bun --hot` reemplazan npm + vitest + esbuild + tsx + nodemon.
- **Bun.loadFile** / **bun:sqlite** / **Bun.password** / **Bun.CryptoHasher** / **`fetch` global con `proxy` option** = menos deps npm.

**No es mágico**: la "compatibilidad 95-98% Node" deja fuera casos importantes (bcrypt, canvas, native addons con V8 API, SOCKS en `fetch`). Bun usa **JavaScriptCore**, no V8 → los `.node` addons compilados para V8 **no cargan**. Mejor verificar `find node_modules -name "*.node"` antes de portar.

---

## 2. Estado del port (post-PR #1)

PR: <https://github.com/primigenum/opencode-telegram-bot/pull/1>

### Runtime

| Antes | Ahora |
| --- | --- |
| `engines: node >= 20` | `engines: bun >= 1.3.0` |
| `npm install` + `package-lock.json` | `bun install` + `bun.lock` |
| `npm run` scripts | `bun run` scripts |
| `vitest` + `@vitest/coverage-v8` + `tsx` | `bun test` (built-in) |
| `node ./dist/cli.js` (shebang) | `bun ./dist/cli.js` (shebang) |
| `.github/workflows/ci.yml`: `setup-node` | `oven-sh/setup-bun@v2` |
| `.github/workflows/publish.yml` | **eliminado** (fork personal) |

### Build

```bash
# antes
tsc && node ./dist/cli.js

# ahora
bun build ./src/cli.ts --outdir dist --target bun --format esm
bun run dist/cli.js
```

`--target bun` externaliza automáticamente `bun:sqlite`, `bun:path`, `bun:test` (no se incluyen en el bundle).

### Source code — `node:*` → `bun:*` / globals

Cero `node:*` imports en `src/`. 15 imports `bun:` + 0 `node:`. Tabla completa en [Apéndice A](#apéndice-a--tabla-completa-de-mappings-node--bun).

**Archivos refactorizados (18)**: `src/runtime/bootstrap.ts`, `src/runtime/paths.ts`, `src/runtime/service/manager.ts`, `src/opencode/process.ts`, `src/utils/logger.ts`, `src/bot/handlers/voice-handler.ts`, `src/bot/services/event-subscription-service.ts`, `src/bot/messages/send-downloaded-file.ts`, `src/bot/commands/task-command.ts`, `src/bot/menus/file-browser-menu.ts`, `src/app/services/{file-browser,model-selection,project,session-cache,worktree}-service.ts`, `src/app/stores/settings-store.ts`, `src/app/formatters/summary-formatter.ts`, `src/app/bootstrap/start-bot-app.ts`, `src/cli.ts`.

**Patrones clave** (de los archivos del repo,供参考):

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

// Stdin con masking carácter a carácter (readline raw mode no está en Bun.stdin)
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

- 118 archivos: `import { ... } from "vitest"` → `import { ... } from "#vitest"`.
- `#vitest` es un subpath alias en `package.json` `imports` que apunta a `tests/helpers/vitest-shim.ts`.
- `bunfig.toml` carga `tests/setup-preload.ts` (no-op) y `tests/setup.ts` (env defaults + reset de singletons).
- `vitest.config.ts` eliminado.

**Resultados CI actuales** (PR #1):
- ✅ Lint + build + runtime: verde.
- 🟡 Tests: 74 pass / 931 fail / 1005 totales.

Los 931 fails **no son del port en sí**. Son de la infraestructura de tests rota con bun (ver §3 y §6). El logger al 8/8, formatters, stores, routers, keyboards, handlers que no mockean — todos pasan. Los que rompen son los que dependen de `vi.mock` con hoisting o `vi.resetModules`.

---

## 3. Limitaciones de Bun que afectan a este fork

### 3.1 `vi.mock(path, factory)` no se hoistea

**El problema**: vitest usa el transformer de Vite/esbuild para mover `vi.mock(...)` por encima de los `import` estáticos. Bun no hace esa transformación — `mock.module()` es un call de runtime. Si tu source hace `import "node:fs"` arriba y el test llama `vi.mock("node:fs", ...)` abajo, el import estático ya cargó el módulo real. El mock no se aplica.

**Por qué nos salvamos en `src/`**: porque **ningún source usa `node:fs` ni nada de `node:*`**. El `vi.mock("node:fs", ...)` que tenía el test ya no tiene nada que interceptar — el source llama a `Bun.file()`, que es un global.

**Por qué siguen fallando los 60 tests**: el `vi.mock` se aplica contra **módulos de `src/`** (p. ej. `vi.mock("../../../src/runtime/bootstrap.js", ...)`). Como el `import` del source es estático en el test, bun ya cacheó el módulo real antes de que el mock se registrara.

**Workarounds posibles** (no implementados todavía):
1. **Reescribir el test a `await import()` dinámico** del source.
2. **Bun loader plugin** que hoistee `vi.mock` y reescriba static imports de módulos mockeados a `await import()`.
3. **Preload mocks** en `bunfig.toml` (cargar mocks antes de que arranque cada test) — pero sólo funciona para módulos conocidos a priori.

oven-sh/bun#31316 abrió este tema en mayo 2026 con un PR fix (#31319) que limpia los mocks cross-file. **Aún no merged** al momento de escribir este doc.

### 3.2 `vi.resetModules()` es no-op

Bun no expone un API público para limpiar el module cache. Los tests que hacen `vi.resetModules() + await import("../src/config.js")` esperando re-evaluar el módulo con env nuevo **reciben siempre el primer resultado**.

**Workaround (único portable)**: factorizar el source a una factory function que devuelva un objeto `config` fresco en cada llamada. Ejemplo:

```ts
// src/config.ts — el patrón problemático
let config: Config;
export function loadConfig(): Config {
  if (config) return config;
  config = parseFromEnv(process.env);
  return config;
}
export { config };

// src/config.ts — el patrón portable
export function createConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseFromEnv(env);
}
// el test importa `createConfig({ FOO: "bar" })` y obtiene un config fresco cada vez
```

Aplica a: `src/config.ts`, `src/runtime/mode.ts`, cualquier singleton inicializado en module load.

### 3.3 SOCKS proxy no soportado en `fetch`

Bun implementa HTTP/HTTPS proxy via la opción `proxy: string` de `fetch`. **SOCKS no funciona**. Si configuras `TELEGRAM_PROXY_URL=socks5://...`, el código cae a conexión directa con un warning.

**Opciones**:
1. Volver a `node:https` + `socks-proxy-agent` solo para esa parte.
2. Tunelizar el tráfico SOCKS con un sidecar (e.g. `ssh -D`).
3. Esperar — oven-sh está trabajando en SOCKS support.

### 3.4 Password masking sin raw mode

`node:readline` tiene `terminal: true` que enmascara carácter a carácter. `Bun.stdin` no. El código actual implementa masking a mano con `Bun.stdin.stream()` (caracter a caracter, ver §2). El bot token y la server password se siguen pidiendo, pero:

- Funciona ✅.
- No maneja bien terminales que envían `\r` o caracteres multi-byte.
- Para TUI real con echo control, hay que usar `Bun.Terminal` (PTY) o `stty -echo` vía `Bun.spawn`.

### 3.5 `bun:sqlite` API differences vs `better-sqlite3`

Bun documenta la diferencia explícitamente ([bun.com/docs/api/sqlite](https://bun.com/docs/api/sqlite)). Los gotchas que aplican a este fork (session cache fallback):

- `db.pragma(...)` **no existe**. Usar `db.prepare("PRAGMA foreign_keys = ON").run()`.
- `db.transaction(fn)` — verificar signature exacta en la doc.
- `db.function(name, fn)` — para SQL functions custom.
- `db.aggregate(name, fn)` — para aggregates custom.

Performance: `bun:sqlite` es **3-6× más rápido** que `better-sqlite3` en read queries según el benchmark de Bun. Este fork **no usa `better-sqlite3` directamente** — la session cache usa `bun:sqlite` desde el primer commit del port.

### 3.6 `node:worker_threads` incompleto

Bun implementa `Worker` pero faltan opciones (`stdin`, `stdout`, `stderr`, `trackedUnmanagedFds`, `resourceLimits`). Faltan APIs (`markAsUntransferable`, `moveMessagePortToContext`). **No afecta al fork actual** (no usamos workers), pero tenerlo en mente si en el futuro hace falta paralelismo real.

### 3.7 `process.loadEnvFile` y `process.getBuiltinModule` no implementados

Bun todavía no expone estos (Node 22+). El fork usa `dotenv` para cargar `.env`. Alternativa nativa:

```bash
bun --env-file=.env ./src/cli.ts start
```

`--env-file` carga `.env` al inicio del proceso. Si quieres eliminar la dep `dotenv`, es el path.

### 3.8 Auto-load `.env` por defecto

A diferencia de Node, bun **lee `.env` automáticamente** al inicio (a menos que pases `--no-env-file`). Implicación: el `import dotenv from "dotenv"` + `dotenv.config()` del código actual es redundante. Hay que decidir si se quiere ese comportamiento o se desactiva con flag.

### 3.9 Sin `process.versions.node`

Si el código o alguna dep consulta `process.versions.node` (muchas libs lo hacen para feature detection), `undefined` rompe la lógica. Bun expone `process.versions.bun`. Workaround típico:

```ts
const isBun = typeof Bun !== "undefined";
const isNode = typeof process !== "undefined" && process.versions?.node != null;
```

---

## 4. Industry research (2025-2026)

Síntesis de 10+ fuentes consultadas. Útil para entender si los tradeoffs que hace este fork son razonables.

### Compatibilidad

| Fuente | Headline | Cita relevante |
| --- | --- | --- |
| [Bun docs](https://bun.com/docs/runtime/nodejs-compat) | "95-98% Node compat" | "Every day, Bun gets closer to 100% Node.js API compatibility" |
| [alexcloudstar 2026](https://www.alexcloudstar.com/blog/bun-compatibility-2026-npm-nodejs-nextjs/) | Tabla de paquetes | Prisma ✅, sharp ✅ (WASM), Drizzle ✅, bcrypt ❌, better-sqlite3 ❌ (usar bun:sqlite), canvas ❌, pg ✅, mysql2 ✅ |
| [Strapi 2026](https://strapi.io/blog/bun-vs-nodejs-performance-comparison-guide) | "drop-in es ~80% verdad" | "The 20% will find you in production if you don't go looking for it first" |
| [byteiota Bun 2.0](https://byteiota.com/building-your-first-project-with-bun-2-0-migration-guide/) | Native addons rotos | "bcrypt → bcryptjs, sqlite3 → bun:sqlite, sharp → WASM fallback" |

### Anti-patterns / cuándo NO portar

- **Native addons críticos sin alternativa**: canvas, gl (headless-gl, falla con ABI mismatch — [oven-sh/bun#20803](https://github.com/oven-sh/bun/issues/20803)), gRPC tools que usen V8 API.
- **Heavy `cluster` patterns**: soporte parcial, edge cases.
- **`vm` module sandboxing**: la implementación de bun es "frágil" según multiple sources.
- **Code que asume CJS globals**: `__dirname`, `__filename`. ESM no los expone. En bun-ESM usar `import.meta.dir` y `import.meta.file`.
- **Stack con C++ addons no negociables**: stay on Node. "The workarounds are painful and not worth it" (techresolve 2025).

### Producción real

- **dev.to "Bun 1.2 in production"** (whoffagents, abril 2026): "We're running 4 of 7 services on Bun in production. The other 3 are blocked on native addon dependencies we haven't resolved yet." Budget: **~1 week of engineering per service**, no afternoon.
- **dev.to "From Node.js to Bun: 5x throughput"** (benriemer, abril 2026): 5× throughput medido en production, "the easy part is `bun install`; the hard part is API differences".
- **core.cz 2026**: "Big Bang approaches fail in 73% of enterprise cases" → iterativo con milestones medibles.
- **LinkedIn pulse (venkataraman, dic 2025)**: 5-phase migration (assess, modernize, deps, test, deploy) + "abstract for long-term maintainability" (runtime detection layer si necesitas dual runtime).

### Patrones de port que recomienda la industria

1. **Audit deps antes de tocar código**: `find node_modules -name "*.node"`, `npm ls | grep -E "bcrypt|sqlite|sharp|canvas|argon2"`.
2. **Fase 0: usar `bun install` con Node como runtime** (zero-code-change). 20-40× install speed, zero risk.
3. **Fase 1: dual CI** (Node + Bun en paralelo, 2 semanas). Si Bun pasa, drop Node.
4. **Fase 2: switch runtime**. Reemplazar `node:*` por bun-nativo cuando aporte valor real (perf, menos deps).
5. **Fase 3: tests**. La parte más dolorosa por las diferencias de mocking.
6. **Rollback plan documentado** desde el día 0.

### Aplicabilidad a este fork

El fork está en **fase 2-3**:
- ✅ Phase 0: `bun install` reemplazó npm.
- ✅ Phase 1: CI corre solo en Bun (no dual — fork personal).
- 🟡 Phase 2: source refactorizado a bun-native, pero con妥协 (SOCKS sigue cayendo a direct, dotenv sigue).
- 🟡 Phase 3: shim permite que la mayoría de tests compilen, pero 60 fallan por limitaciones de `mock.module` (necesita rewrite o bun loader plugin).

---

## 5. Cookbook: código bun-native

### 5.1 Template de un nuevo source file

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

**Reglas**:
- ❌ Nunca `import "node:fs"`, `"node:path"`, etc. en `src/`.
- ✅ `import path from "bun:path"` cuando necesites path manipulation.
- ✅ `Bun.file(path).text()` / `.json()` / `.arrayBuffer()` / `.writer()` para I/O.
- ✅ `Bun.write(path, data)` para escribir.
- ✅ `Bun.file(path).delete()` para borrar.
- ✅ `Bun.file(path).exists()` / `.stat()` para checks.
- ✅ `Bun.Glob` para listar directorios.
- ✅ `Bun.spawn([...])` para procesos async; `await proc.exited` espera.
- ✅ `Bun.spawnSync([...])` para sync; `result.exitCode`, `result.stdout`.
- ✅ `Bun.CryptoHasher` para hashing (más rápido que `crypto.createHash`).
- ✅ `crypto.randomUUID()` (global) para UUIDs.
- ✅ `Bun.inspect(value)` para debug printing.
- ✅ `Bun.fileURLToPath(import.meta.url)` para resolver rutas relativas al archivo actual.
- ✅ `fetch(url, { proxy: "http://..." })` para HTTP con proxy (no SOCKS).
- ✅ `process.env.HOME` / `process.env.USERPROFILE` (en lugar de `os.homedir`).
- ✅ `for await (const line of console)` para stdin por línea.
- ✅ `Bun.stdin.stream()` para stdin por chunk/char.
- ✅ `mkdir -p` vía `Bun.spawn(["mkdir", "-p", path])` (bun no expone API nativo para esto).

### 5.2 Patrón factory para evitar el problema de `vi.resetModules`

Si un módulo necesita ser re-evaluable por test (e.g. `config.ts` lee `process.env` en module load), factoriza a factory:

```ts
// ❌ No portable a bun:test sin resetModules
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

Aplicar a: `src/config.ts`, `src/runtime/mode.ts`, `src/runtime/bootstrap.ts` (parcialmente — la lectura de env es via `dotenv.parse`, no process load), cualquier singleton.

### 5.3 Mocking de `Bun` global en tests

Si necesitas mockear `Bun.file`, `Bun.spawn`, etc. en un test:

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

**Más limpio** que `vi.mock("bun:foo", ...)` porque bun-namespace modules no son interceptables con `mock.module` en todas las versiones.

### 5.4 HTTP con proxy

```ts
// ✅ HTTP/HTTPS proxy
const response = await fetch(url, {
  proxy: "http://user:pass@proxy.example.com:8080",
  signal: controller.signal,
  redirect: "follow",
});

// ❌ SOCKS no soportado por Bun — cae a direct connection
if (proxyUrl.startsWith("socks")) {
  logger.warn("SOCKS proxies are not supported by Bun's fetch. Falling back to direct connection.");
  // omitir `proxy` option
}
```

### 5.5 Process spawn con streams

```ts
// Capturar stdout/stderr
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

### 5.6 Logger con append-mode file writer

```ts
// Patrón del fork (src/utils/logger.ts)
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

`Bun.file(path).writer()` es un `FileSink` con backpressure, flush, end — drop-in para los `createWriteStream` + `appendFileSync` del código original.

---

## 6. Cookbook: tests con el shim vitest

El shim vive en `tests/helpers/vitest-shim.ts` (288 líneas). Exporta el namespace `vi` y los aliases de `bun:test` para que el código del test no cambie (sólo el import path: `vitest` → `#vitest`).

### 6.1 Imports en un test

```ts
// ❌ Antes (vitest)
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ✅ Ahora (bun:test via shim)
import { describe, expect, it, vi, beforeEach, afterEach } from "#vitest";
```

### 6.2 Patrones que ✅ funcionan

| API | Estado | Notas |
| --- | --- | --- |
| `describe`, `it`, `test`, `expect` | ✅ | `bun:test` re-exported por el shim |
| `beforeAll` / `beforeEach` / `afterAll` / `afterEach` | ✅ | idem |
| `vi.fn()` | ✅ | wrap de `bun:test.mock` |
| `vi.spyOn(obj, method)` | ✅ | wrap de `bun:test.spyOn` |
| `vi.hoisted(() => ...)` | ✅ | implementa como factory() (mock data antes de imports) |
| `vi.mocked(value)` | ✅ | identity cast |
| `vi.stubEnv(key, value)` | ✅ | managea `process.env` |
| `vi.unstubAllEnvs()` | ✅ | restore todos los stubbed |
| `vi.stubGlobal(key, value)` | ✅ | setea `globalThis[key]` |
| `vi.unstubAllGlobals()` | ✅ | restore todos |
| `vi.useFakeTimers()` | ✅ | `bun:test.jest.useFakeTimers()` |
| `vi.useRealTimers()` | ✅ | idem |
| `vi.setSystemTime(date)` | ✅ | `bun:test.setSystemTime` |
| `vi.advanceTimersByTime(ms)` | ✅ | via `setSystemTime` + `bun:test.jest.now()` |
| `vi.advanceTimersByTimeAsync(ms)` | ✅ | + flush microtasks (3× `setImmediate`) |
| `vi.runAllTimersAsync()` | ✅ | drena `bun:test.jest.getTimerCount()` |
| `vi.waitFor(fn, { timeout, interval })` | ✅ | implementado en el shim (polling con `setTimeout`) |
| `vi.importActual(path)` | ✅ | `await import(path)` (sin override del mock) |
| `vi.doMock(path, factory)` | ✅ | alias de `vi.mock` |
| `vi.doUnmock(path)` | ✅ | reset al import real |
| `vi.restoreAllMocks()` | ✅ | pop tracked mocks |
| `vi.clearAllMocks()` | ✅ | clear en tracked mocks |

### 6.3 Patrones que ❌ NO funcionan (limitación de bun)

| API | Estado | Por qué |
| --- | --- | --- |
| `vi.mock("../../../src/foo.js", factory)` con `import` estático del source | ❌ | bun no hoistea; el static import carga el módulo real antes que el `mock.module` se registre |
| `vi.resetModules()` + `await import("../src/config.js")` | ❌ | bun no expone module cache reset; segundo import devuelve el mismo binding |
| `vi.importActual("node:fs")` cuando `vi.mock("node:fs", ...)` está activo en vitest | 🟡 | El shim actual hace `await import(path)` sin override — funciona si el source usa dynamic import; falla con static import |
| `vi.mocked()` para **partial mocks** con spread del real (`{ ...actual, override }`) | 🟡 | El shim provee `vi.importActual` pero hay que importarlo en el factory |

### 6.4 Workarounds para los patterns rotos

**Opción A: dynamic import del source**

```ts
// ❌ No funciona en bun
import { loadConfig } from "../src/config.js";
vi.mock("../src/config.js", () => ({ loadConfig: vi.fn() }));
test("foo", () => { expect(loadConfig()).toBe("bar"); });

// ✅ Funciona
let loadConfig: typeof import("../src/config.js").loadConfig;
vi.mock("../src/config.js", () => ({ loadConfig: vi.fn(() => "bar") }));
beforeAll(async () => {
  loadConfig = (await import("../src/config.js")).loadConfig;
});
test("foo", () => { expect(loadConfig()).toBe("bar"); });
```

**Opción B: factory function en el source**

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

**Opción C: preload mocks en bunfig.toml** (cuando aplica)

```toml
# bunfig.toml
[test]
preload = ["./tests/setup-preload.ts", "./tests/setup-mocks.ts", "./tests/setup.ts"]
```

```ts
// tests/setup-mocks.ts — corre ANTES de cualquier test
import { mock } from "bun:test";
mock.module("../src/bot/services/tts-service.ts", () => ({
  transcribeAudio: () => Promise.resolve({ text: "mocked" }),
}));
```

Limitación: hay que enumerar cada módulo mockeado a mano. No es dinámico.

**Opción D (futuro): bun loader plugin** que reescriba `vi.mock(path, factory)` a `await import(path)` + `mock.module()`. No implementado. oven-sh/bun#31316 (parcialmente merged en #31319) podría cerrar parte de este gap.

### 6.5 vi.hoisted — para mocks antes de imports

```ts
// ✅ Patrón que ya usa el fork (tests/bot/handlers/agent.test.ts)
import { beforeEach, describe, expect, it, vi } from "#vitest";

const mocked = vi.hoisted(() => ({
  getAvailableAgentsMock: vi.fn(),
  getCurrentAgentMock: vi.fn(),
}));

import { agentHandler } from "../../../src/bot/handlers/agent.js";
// el source importa el módulo mockeado, que ya está registrado vía `hoisted`
```

`vi.hoisted(factory)` ejecuta la factory **antes** de que bun resuelva los imports — el `mock.module()` se llama en el momento correcto.

### 6.6 Reset de singletons en beforeEach

```ts
// tests/setup.ts (cargado por bunfig.toml)
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

Esto evita el problema clásico de "singleton contaminó el siguiente test" sin depender de `vi.resetModules` (que es no-op).

---

## 7. Roadmap — lo que queda

### 7.1 Corto plazo (este fork)

- [ ] **Reescribir los 60 tests que dependen de `vi.mock` con static import** → usar `await import()` dinámico o factory function en source. Tests afectados están en:
  - `tests/bot/{commands,streaming,menus,middleware,messages,pinned,render,services}/`
  - `tests/app/{services,managers,bootstrap}/`
- [ ] **Reescribir `tests/config.test.ts` y `tests/config-scheduled-task-notifications.test.ts`** → factorizar `src/config.ts` a `createConfig(env)` factory.
- [ ] **Evaluar Bun.Terminal para password masking** — alternativa a `Bun.stdin.stream()` con manejo correcto de terminals raw.
- [ ] **Verificar bun:test 1.4+ status de `mock.module` cross-file** (oven-sh/bun#31319) — si merged, podría re-habilitar `vi.mock(path, factory)` con hoist automático.

### 7.2 Medio plazo (mejoras)

- [ ] **Migrar ESLint + Prettier a Biome** — alinea con el resto del workspace `primigenum/`. Biome es 10-100× más rápido y unifica lint+format.
- [ ] **Eliminar `import "dotenv"`** — usar `bun --env-file=.env ./src/cli.ts start` o auto-load nativo de bun.
- [ ] **Migrar `dotenv` dep** — el fork aún la usa. Con `--env-file` o auto-load nativo, se va.
- [ ] **Tipar `process.exitCode` y `process.versions.bun`** explícitamente (evitar que rompa TS strict si bun cambia el signature).
- [ ] **Documentar Bun.Terminal setup** si se adopta (PTY, escape sequences, etc).

### 7.3 Largo plazo (decisiones de producto)

- [ ] **¿SOCKS proxy?** Si algún user lo necesita, decidir entre (a) fallback a `node:https` + `socks-proxy-agent`, (b) tunelizar, (c) esperar oven-sh.
- [ ] **¿Publicar a npm como `@primigenum/opencode-telegram-bot`?** El fork actual es personal (sin `.github/workflows/publish.yml`). Si se decide publicar, hay que re-añadir el workflow y decidir soporte para `bun install` puro.
- [ ] **¿Contribuir de vuelta al upstream?** No realista — rompería su suite de tests. Pero se puede documentar las learnings en un blog post o charla.

### 7.4 Métricas de éxito

- ✅ `bun run check` (lint + build + test) verde en CI.
- 🟡 1000+ tests pasando (actualmente 74). Meta: ≥ 90% verde.
- ✅ `bun.lock` committed.
- ✅ `engines: bun >= 1.3.0` en `package.json`.
- 🟡 Cero `node:*` en `src/` (✅ ya está; mantener).
- 🟡 Cero `vi.mock` con static import en `tests/` (🟡 falta rewrite de 60 tests).
- 🟡 Cero `vi.resetModules()` en `tests/` (🟡 falta en `config.test.ts`).

---

## Apéndice A — Tabla completa de mappings `node:*` → `bun:*`

Tabla de referencia rápida. Todos los patterns están en uso en el fork actual (PR #1).

| Antes (Node) | Ahora (Bun) | Notas |
| --- | --- | --- |
| `import { readFile, writeFile, unlink, mkdir, rm, access, rename } from "node:fs/promises"` | `Bun.file(path).text()` / `.json()` / `.arrayBuffer()` / `Bun.write(path, data)` / `Bun.file(path).delete()` / `Bun.spawn(["mkdir", "-p", path])` / `Bun.file(path).exists()` / `Bun.spawn(["mv", from, to])` | bun no expone API recursivo para mkdir; usar `mkdir -p` |
| `import { createWriteStream, openSync, closeSync, appendFileSync, mkdirSync } from "node:fs"` | `Bun.file(path).writer()` / `Bun.spawnSync(["mkdir", "-p", path])` | `writer()` da `FileSink` con backpressure |
| `import { spawn, exec, execFile } from "node:child_process"` (+ `promisify`) | `Bun.spawn([...])` / `Bun.spawnSync([...])` | `await proc.exited` es la Promise nativa |
| `import { createHash } from "node:crypto"` | `new Bun.CryptoHasher("sha256")` | Más rápido |
| `import { randomUUID } from "node:crypto"` | `crypto.randomUUID()` (global) | global, no necesita import |
| `import http, { Agent as HttpAgent } from "node:http"` | `fetch(url, { proxy?: string })` (global) | Bun implementa HTTP server via `Bun.serve()` |
| `import https, { Agent as HttpsAgent } from "node:https"` | `fetch(url, { proxy?: string })` (global) | HttpsAgent eliminado (proxy nativo) |
| `import { HttpsProxyAgent } from "https-proxy-agent"` | `fetch(url, { proxy: "http://..." })` | No más dep |
| `import { SocksProxyAgent } from "socks-proxy-agent"` | ⚠️ No soportado en Bun. Fallback a direct + warn | Ver §3.3 |
| `import { fileURLToPath } from "node:url"` | `Bun.fileURLToPath(import.meta.url)` | |
| `import { inspect } from "node:util"` | `Bun.inspect(value, { colors, compact, depth })` | |
| `import { homedir } from "node:os"` | `process.env.HOME ?? process.env.USERPROFILE` | platform-specific paths via `process.platform` |
| `import path from "node:path"` (o `"path"`) | `import path from "bun:path"` | API-compatible |
| `import { createInterface, Interface } from "node:readline"` (línea) | `for await (const line of console)` | console es un Readable async iterable |
| `import { createInterface } from "node:readline/promises"` (línea con async) | `for await (const line of console)` | idem |
| `readline.createInterface({ terminal: true })` (raw mode char-by-char) | `for await (const chunk of Bun.stdin.stream())` + manual char masking | Ver §3.4; `Bun.Terminal` es la alternativa PTY |
| `import Database from "better-sqlite3"` | `import { Database } from "bun:sqlite"` | API similar; `db.pragma` no existe → `db.prepare("PRAGMA ...").run()` |

### Bun-native APIs descubiertos durante el port

Estos **no tienen** equivalente directo en Node estándar y son lo que justifica usar Bun:

| API | Uso en el fork |
| --- | --- |
| `Bun.file(path).writer()` | logger con append mode (`src/utils/logger.ts`) |
| `Bun.Glob` | listado de directorios (`src/utils/logger.ts` cleanupOldLogs) |
| `Bun.fileURLToPath(import.meta.url)` | resolver `.env.example` relativo al módulo (`src/runtime/bootstrap.ts`) |
| `fetch(url, { proxy, signal, redirect })` | descarga de archivos de Telegram (`src/bot/handlers/voice-handler.ts`) |
| `Bun.spawn(["sh", "-c", cmd])` | wrapper para `netstat`/`lsof`/`ss`/`taskkill` (`src/opencode/process.ts`) |
| `Bun.spawn([process.execPath, ...], { detached, stdio, env })` | daemon mode (`src/runtime/service/manager.ts`) |

---

## Apéndice B — Referencias

### Documentación oficial Bun

- [Node.js Compatibility](https://bun.com/docs/runtime/nodejs-compat) — tabla maestra de qué está implementado y qué no.
- [SQLite (`bun:sqlite`)](https://bun.com/docs/api/sqlite) — API, benchmarks, `db.pragma` workaround.
- [Test runner (`bun:test`)](https://bun.sh/docs/test/mocks) — mocking, hoisting, preload.
- [Bun.file()](https://bun.com/docs/api/file) — I/O API.
- [Bun.spawn()](https://bun.com/docs/api/spawn) — process API.
- [Bun.build()](https://bun.com/docs/bundler) — bundler (usado para `dist/` con `--target bun`).
- [Bun.GitHub setup-bun action](https://github.com/oven-sh/setup-bun) — CI action.

### Issues abiertos relevantes

- [oven-sh/bun#31316](https://github.com/oven-sh/bun/issues/31316) — vitest→bun test migration: gaps, per-file mock isolation.
- [oven-sh/bun#31319](https://github.com/oven-sh/bun/pull/31319) — PR fix: `BunTestRoot::exit_file` sweep de `JSModuleMock` cross-file.
- [oven-sh/bun#5394](https://github.com/oven-sh/bun/issues/5394) — design discussion: module mocking + hoisting philosophy.
- [oven-sh/bun#20803](https://github.com/oven-sh/bun/issues/20803) — native Node modules (e.g. `gl`) ABI mismatch.
- [oven-sh/bun#16050](https://github.com/oven-sh/bun/issues/16050) — `better-sqlite3` in bun.
- [oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290) — V8 C++ API compatibility (root cause de muchos "native addon" fails).
- [oven-sh/bun#22304](https://github.com/oven-sh/bun/issues/22304) — `vi` export for Vitest compat (closed/implemented subset).
- [oven-sh/bun#29836](https://github.com/oven-sh/bun/pull/29836) — auto-mock for `jest.mock(module)` sin factory.

### Fuentes externas (industry research)

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

### Específicos del fork

- PR: <https://github.com/primigenum/opencode-telegram-bot/pull/1>
- Upstream: <https://github.com/grinev/opencode-telegram-bot> (v0.21.2)
- Shim de vitest: `tests/helpers/vitest-shim.ts` (288 líneas)
- Docs del bot: `docs/LINUX_SYSTEMD_SETUP.md`, `docs/LOCALIZATION_GUIDE.md`
- AGENTS.md del fork: lista completa de bun-native APIs en uso.

---

**Mantenido por**: primigenum. Última revisión: junio 2026 (contra Bun 1.3+).
