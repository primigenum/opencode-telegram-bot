# OpenCode Telegram Bot (Bun port)

[![CI](https://github.com/primigenum/opencode-telegram-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/primigenum/opencode-telegram-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.3.0-f9f1e1)](https://bun.sh)

OpenCode Telegram Bot is a secure Telegram client for [OpenCode](https://opencode.ai) CLI that runs on your local machine. This is a **Bun port of [grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot)** — same feature set, same UX, but no `npm` and no `node` in the toolchain.

Run AI coding tasks, monitor progress, switch models, and manage sessions from your phone.

No open ports, no exposed APIs. The bot communicates with your local OpenCode server and the Telegram Bot API only.

Scheduled tasks support. Turns the bot into a lightweight OpenClaw alternative for OpenCode users.

Platforms: macOS, Windows, Linux

## What changed vs. the upstream Node port

- **Runtime**: Node.js 20+ → **Bun ≥ 1.3.0** (`bun run` everywhere; the bin entry is `#!/usr/bin/env bun`)
- **Package manager**: npm → **bun install** (no `package-lock.json`, just `bun.lock`)
- **Test runner**: vitest → **bun test** (with a thin vitest-compatible shim — see [Test status](#test-status))
- **SQLite driver**: `better-sqlite3` (native node addon) → **`bun:sqlite`** (built-in to Bun, no compile)
- **CI**: `setup-node` → **`oven-sh/setup-bun`**
- **Distribution**: removed npm publish workflow (this fork is for personal use; re-add a publish workflow if you decide to ship to npm later)

Everything else is identical. Same commands, same Telegram UX, same `.env` schema, same config wizard.

## Features

- **Remote coding** — send prompts to OpenCode from anywhere, receive complete results with code sent as files
- **Session management** — create new sessions or continue existing ones, just like in the TUI
- **Track live session** — follow a live OpenCode CLI session
- **Background session notifications** — get short notifications when detached or non-current sessions reply
- **Live status** — pinned message with current project/worktree, model, context usage, and changed files list, updated in real time
- **Model switching** — pick models from OpenCode favorites and recent history directly in the chat
- **Agent modes** — switch between Plan and Build modes on the fly
- **Subagent activity** — watch live subagent progress in chat
- **Custom Commands** — run OpenCode custom commands from an inline menu
- **Skills Catalog** — browse OpenCode skills from an inline menu
- **Interactive Q&A** — answer agent questions and approve permissions via inline buttons
- **Voice prompts** — send voice/audio, transcribe via a Whisper-compatible API, optional spoken replies
- **File attachments** — send images, PDFs, and text files to OpenCode
- **Scheduled tasks** — schedule prompts to run later or on a recurring interval
- **Context control** — compact context when it gets too large
- **Input flow control** — when an interactive flow is active, only relevant input is accepted
- **Git worktree switching** — browse and switch between git worktrees
- **Security** — strict user ID whitelist
- **Localization** — UI localized for en, ar, de, es, fr, ru, zh
- **Interactive file browser** — `/ls` to browse and download files inside the current project

## Prerequisites

- **Bun ≥ 1.3.0** — [install](https://bun.sh)
- **OpenCode** — install from [opencode.ai](https://opencode.ai) or [GitHub](https://github.com/sst/opencode)
- **Telegram Bot** — you'll create one during setup (takes 1 minute)

## Quick Start

### 1. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`
2. Follow the prompts to choose a name and username
3. Copy the **bot token** you receive (e.g. `123456:ABC-DEF1234...`)

You'll also need your **Telegram User ID** — send any message to [@userinfobot](https://t.me/userinfobot) and it will reply with your numeric ID.

### 2. Start OpenCode Server

```bash
opencode serve
```

The bot connects to `http://localhost:4096` by default.

### 3. Install & Run

```bash
git clone https://github.com/primigenum/opencode-telegram-bot.git
cd opencode-telegram-bot
bun install
cp .env.example .env
# Edit .env with your bot token, user ID, and model settings

bun run dev
```

`bun run dev` uses `bun --hot` for hot reload — edit any file under `src/` and the bot restarts in <1s.

#### Alternative: Foreground start

```bash
bun run start:foreground
```

Same as `bun run dev` but without the file watcher (cleaner for `systemd`, Docker, etc.).

On first launch, an interactive wizard guides you through configuration (interface language → bot token → user ID → OpenCode API URL → optional server credentials). After that, the bot is ready in Telegram.

#### Alternative: Built-in daemon mode

The CLI supports a built-in `start --daemon` mode for standalone runs without a process manager:

```bash
bun run dist/cli.js start --daemon   # uses the built binary
bun run dist/cli.js status
bun run dist/cli.js stop
```

> Daemon mode is intended for standalone installs without an external supervisor. For `systemd`, `pm2`, or Docker, use the foreground command.

To reconfigure at any time:

```bash
bun run dist/cli.js config
```

## Supported Platforms

| Platform | Status                                       |
| -------- | -------------------------------------------- |
| macOS    | Fully supported                              |
| Windows  | Fully supported                              |
| Linux    | Fully supported (tested on Fedora 44, Bun 1.3) |

## Bot Commands

| Command           | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `/status`         | Server health, current project, session, and model info |
| `/new`            | Create a new session                                    |
| `/abort`          | Abort the current task                                  |
| `/detach`         | Detach from the current session without stopping it     |
| `/sessions`       | Browse and switch between recent sessions               |
| `/messages`       | Browse user messages, revert or fork from a previous state |
| `/projects`       | Switch between OpenCode projects                        |
| `/worktree`       | Switch between existing git worktrees                   |
| `/open`           | Add a project by browsing directories                   |
| `/ls`             | List directory contents, then tap to open or download   |
| `/tts`            | Choose audio reply mode (`off`, `all`, or `auto`)       |
| `/rename`         | Rename the current session                              |
| `/commands`       | Browse and run custom commands                          |
| `/skills`         | Browse and run OpenCode skills                          |
| `/mcps`           | Browse and toggle MCP servers                           |
| `/task`           | Create a scheduled task                                 |
| `/tasklist`       | Browse and delete scheduled tasks                       |
| `/opencode_start` | Start the local OpenCode server on the bot machine      |
| `/opencode_stop`  | Stop the local OpenCode server on the bot machine       |
| `/help`           | Show available commands                                 |

Full configuration (every `.env` variable) is documented in the upstream README at
[grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot#environment-variables) — the variable names, defaults, and semantics are unchanged.

## Development

```bash
bun install                # install deps
bun run check              # lint + build + tests (quality gate)
bun test                   # run tests
bun test tests/utils       # one directory
bunx vitest watch ...      # if you ever need vitest — but the shim is now the canonical path
```

The lint, format, and TypeScript configs are unchanged from upstream (ESLint + Prettier) — they run on `bunx`, no Node involved.

## Test status

This is a partial port. Two vitest patterns have **no equivalent in bun's test runner** and are not polyfillable through the shim:

1. **`vi.mock(module, factory)` for module-level mocking** — vitest's `vi.mock` is hoisted to the top of the test file (via the vitest transformer) so the mock is registered before any `import` statement. Bun's `mock.module()` does **not** hoist. Tests that rely on this pattern (60 of 118 test files) need to be rewritten to either:
   - Use dynamic `await import("module")` after registering the mock, or
   - Use bun's `mock.module()` from a preload file.

2. **`vi.resetModules()` + `await import(...)` to re-evaluate a module** — vitest's `resetModules` clears the module cache so the next `import` re-executes the module. Bun has **no public module cache reset API**. Tests that rely on this (e.g. `tests/config.test.ts` re-reading env vars) currently fail.

Everything else works through the shim at `tests/helpers/vitest-shim.ts`:

- `vi.fn`, `vi.spyOn`, `vi.hoisted`, `vi.mocked`, `vi.importActual` → bun's `mock` / `spyOn`
- `vi.stubEnv` / `vi.unstubAllEnvs` / `vi.stubGlobal` / `vi.unstubAllGlobals` → tracked env + global stubs
- `vi.useFakeTimers` / `vi.useRealTimers` / `vi.setSystemTime` → bun's `jest` timer primitives
- `vi.advanceTimersByTime` / `vi.advanceTimersByTimeAsync` / `vi.runAllTimersAsync` → advance `Date.now()` + flush microtasks

Test files import from the `#vitest` subpath (defined in `package.json` `imports`) instead of `"vitest"`, which sidesteps bun's built-in vitest namespace.

**Current baseline**: tests that don't use `vi.mock` or `vi.resetModules` pass. The remaining failures are concentrated in `tests/bot/commands/*`, `tests/bot/streaming/*`, `tests/bot/services/*`, `tests/bot/menus/*`, `tests/bot/middleware/*`, `tests/bot/messages/*`, `tests/bot/pinned/*`, `tests/bot/render/*`, `tests/app/services/*`, `tests/app/managers/*`, `tests/app/bootstrap/*`, `tests/runtime/*`, `tests/config*.test.ts`, and `tests/opencode/process.test.ts`.

A future PR can fix this with either:
- A custom bun loader that hoists `vi.mock` and rewrites static imports of mocked modules to `await import(...)`, or
- A mechanical rewrite of the 60 affected test files to dynamic imports.

## License

[MIT](LICENSE) — fork of grinev/opencode-telegram-bot by Ruslan Grinev (MIT). All new code in this fork is also MIT.
