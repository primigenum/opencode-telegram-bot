# Linux systemd setup

This fork is installed from source (no `npm publish` workflow). The bot runs under a `systemd` user service so the user account owns the files and the service runs without `sudo` after login.

## 1. Install Bun

If you don't have Bun yet:

```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL -l   # reload shell so `bun` is on PATH
bun --version    # must be >= 1.3.0
```

## 2. Clone and install the bot

```bash
mkdir -p ~/.local/share
git clone https://github.com/primigenum/opencode-telegram-bot.git \
  ~/.local/share/opencode-telegram-bot
cd ~/.local/share/opencode-telegram-bot
bun install --frozen-lockfile
bun run build
```

This builds `dist/cli.js` and `dist/index.js` (`bun build --target bun`).

## 3. Configure the bot

```bash
bun run dist/cli.js config
```

The wizard writes `.env` to the platform's app data directory:

- **Linux:** `~/.config/opencode-telegram-bot/.env`

If you prefer to edit it by hand, copy the example first:

```bash
cp .env.example ~/.config/opencode-telegram-bot/.env
$EDITOR ~/.config/opencode-telegram-bot/.env
```

Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `OPENCODE_MODEL_PROVIDER`, `OPENCODE_MODEL_ID`. See the [README](../../README.md#environment-variables) for the full list.

## 4. Get the required paths

```bash
which bun
```

Use this value in the service file:

- `<USER>`: your Linux user
- `<BUN_PATH>`: output of `which bun` (e.g. `/home/<USER>/.bun/bin/bun`)
- `<INSTALL_DIR>`: `~/.local/share/opencode-telegram-bot`

## 5. Create the user service file

Create `~/.config/systemd/user/opencode-telegram-bot.service`:

```ini
[Unit]
Description=OpenCode Telegram Bot (Bun port)
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/.local/share/opencode-telegram-bot
ExecStart=%h/.local/share/opencode-telegram-bot/dist/cli.js start
Restart=on-failure
RestartSec=5
# Keep stdout/stderr in the journal for debugging.
StandardOutput=journal
StandardError=journal

# Hardening (optional but recommended).
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
ReadWritePaths=%h/.config/opencode-telegram-bot %h/.local/share/opencode-telegram-bot/logs

[Install]
WantedBy=default.target
```

> The `ExecStart` uses the shebang inside `dist/cli.js`, which is `#!/usr/bin/env bun`. `systemd` resolves the shebang via `PATH` — keep `~/.bun/bin` in the user's `PATH` (the Bun installer does this in `~/.bashrc` / `~/.profile`).

## 6. Enable and start the service

```bash
systemctl --user daemon-reload
systemctl --user enable opencode-telegram-bot
systemctl --user start opencode-telegram-bot
systemctl --user status opencode-telegram-bot
```

To start the service on boot without an active login, enable lingering:

```bash
sudo loginctl enable-linger <USER>
```

## 7. View logs

```bash
journalctl --user -u opencode-telegram-bot -f
```

The bot also writes per-launch log files to `<install>/logs/` (sources mode) or `~/.config/opencode-telegram-bot/logs/` (installed mode). Rotation is controlled by `LOG_RETENTION` in `.env`.

## 8. Optional: auto-restart local OpenCode server

For VPS setups with scheduled tasks, enable the bot's local OpenCode server monitor in the bot `.env`:

```env
OPENCODE_AUTO_RESTART_ENABLED=true
OPENCODE_MONITOR_INTERVAL_SEC=300
```

This only works when `OPENCODE_API_URL` points to a local address, e.g. `http://localhost:4096`. The bot starts `opencode serve` with the configured port and health-checks it every 300 seconds by default.

## 9. Updating the bot

```bash
cd ~/.local/share/opencode-telegram-bot
git pull --ff-only
bun install --frozen-lockfile
bun run build
systemctl --user restart opencode-telegram-bot
systemctl --user status opencode-telegram-bot
```

## Troubleshooting

- **`bun: command not found` from systemd** — the service runs without your interactive shell env. Either add `Environment=PATH=%h/.bun/bin:/usr/local/bin:/usr/bin:/bin` to the `[Service]` section, or symlink `bun` into `/usr/local/bin`:

  ```bash
  sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun
  ```

- **Service fails immediately with no log output** — run the `ExecStart` command in a shell first to surface the real error:

  ```bash
  ~/.local/share/opencode-telegram-bot/dist/cli.js start
  ```

- **`systemctl --user` says "Failed to connect to bus"** — your user session has no D-Bus. Either log in graphically / via SSH with a real PAM session, or use a system-level service instead (drop the `WorkingDirectory=%h` paths and run as a dedicated user with `/etc/systemd/system/opencode-telegram-bot.service`).
