# Local Vision for Photos

The bot can describe photos you send to it even when the active OpenCode model
is text-only (e.g. `deepseek-v4-flash`, `kimi-k3`). It does this with a **local
vision model** — no cloud vision API, no image ever leaves your machine.

## How it works

```
Telegram photo
  → bot downloads the largest size
  → POST {LOCAL_VISION_API_URL}/chat/completions  (image + short prompt)
  → local model returns a text description
  → bot sends caption + "[Local vision description of the attached photo] ..."
    as a normal text prompt to OpenCode
```

If the active model supports image input, the photo is sent directly as an
image part (the fallback is skipped).

## Requirements

- A llama.cpp server running an OpenAI-compatible vision model
  (tested with **LFM2.5-VL-3B Q8_0** on the Primigenum machine)
- ~3.5 GB of disk for the models, ~3 GB RAM for the server

## Setup (Primigenum reference machine)

### 1. Download the model

Use the workspace downloader (parallel ranges + sha256 verification):

```bash
bun ~/primigenum/scripts/dl_model.ts LiquidAI/LFM2.5-VL-3B-GGUF LFM2.5-VL-3B-Q8_0.gguf
bun ~/primigenum/scripts/dl_model.ts LiquidAI/LFM2.5-VL-3B-GGUF mmproj-LFM2.5-VL-3B-Q8_0.gguf
mkdir -p ~/models/lfm2.5-vl-3b
mv ~/models/.downloads/*.gguf ~/models/lfm2.5-vl-3b/
```

### 2. Start the vision server

`~/models/lfm2.5-vl-3b/start.sh` — llama.cpp on **port 8082**, CPU-only,
64K context (opencode's system prompt alone is ~33K tokens, so 16K is not
enough). Ports in use: `8080` = ASR container, `8081` = Qwen3-Coder-Next,
`8082` = vision.

```bash
setsid nohup ~/models/lfm2.5-vl-3b/start.sh > /dev/null 2>&1 < /dev/null &
curl -s http://127.0.0.1:8082/health   # → {"status":"ok"}
```

The server takes a few seconds to load the model. It is CPU-only (`-ngl 0`)
so it never competes with the Qwen3-Coder-Next instance on the Radeon GPU.

### 3. Configure the bot (optional)

The defaults already point at `http://127.0.0.1:8082/v1` with model
`lfm2.5-vl-3b`. Only set these if your setup differs:

```env
LOCAL_VISION_API_URL=http://127.0.0.1:8082/v1
LOCAL_VISION_MODEL=lfm2.5-vl-3b
```

### 4. Restart the bot

```bash
systemctl --user restart opencode-telegram-bot.service
```

## Behavior details

- **Model supports images** → photo sent directly as an image part.
- **Model is text-only + vision server up** → photo described locally, caption
  + description sent as text.
- **Vision server down** → the bot replies that the local vision service is
  unavailable and does not forward the photo (prevents garbage prompts).

## Performance

Measured on the reference machine (Ryzen AI MAX+ 392, CPU): ~10–14 s per photo
for dense UI screenshots (LFM2.5-VL-3B Q8_0, 8 threads). Text-only models get
a description with ~84% accuracy on UI-like images; strong on tables, tickets,
forms and prices; weak on tiny grid text, percentages and UUIDs — fine for
"what does this screenshot show", not for reading identifiers verbatim.

See `docs/memory/reference_vision_local_benchmark.md` in `primigenum/workspace`
for the full 10-image benchmark.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Local vision service unavailable" | Server down: `curl -s http://127.0.0.1:8082/health`; start it with `start.sh` |
| Request exceeds context | Server must run with `--ctx-size 65536` (opencode sends a ~33K-token system prompt) |
| Bot never describes photos | The active model supports images, so the fallback is skipped — send the photo to a text-only model |
