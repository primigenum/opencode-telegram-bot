#!/usr/bin/env bun
/**
 * Send a text message and/or a photo to the owner chat via the bot account.
 *
 * Usage (from the repo root, loads the service .env):
 *   bun scripts/send-to-chat.ts --text "hello"
 *   bun scripts/send-to-chat.ts --photo /tmp/shot.png --caption "agenda 390px"
 *   bun scripts/send-to-chat.ts --text "done" --photo /tmp/shot.png
 *
 * Env: TELEGRAM_BOT_TOKEN + TELEGRAM_ALLOWED_USER_ID (loaded via --env-file=.env).
 * Token/chat values are never printed.
 */

interface Args {
  text?: string;
  photo?: string;
  caption?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === '--text' && next !== undefined) {
      args.text = next;
      i += 1;
    } else if (cur === '--photo' && next !== undefined) {
      args.photo = next;
      i += 1;
    } else if (cur === '--caption' && next !== undefined) {
      args.caption = next;
      i += 1;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALLOWED_USER_ID;
  if (!token || !chatId) {
    console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ALLOWED_USER_ID (run with --env-file=.env)');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  if (!args.text && !args.photo) {
    console.error('Nothing to send: pass --text and/or --photo');
    process.exit(1);
  }

  const api = `https://api.telegram.org/bot${token}`;

  if (args.text) {
    const res = await fetch(`${api}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: args.text }),
    });
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (!res.ok || !body.ok) {
      console.error(`sendMessage failed: ${body.description ?? res.status}`);
      process.exit(1);
    }
    console.log('text sent');
  }

  if (args.photo) {
    const file = Bun.file(args.photo);
    if (!(await file.exists())) {
      console.error(`photo not found: ${args.photo}`);
      process.exit(1);
    }
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append(
      'photo',
      new Blob([await file.arrayBuffer()], { type: 'image/png' }),
      args.photo.split('/').pop() ?? 'photo.png',
    );
    if (args.caption) {
      form.append('caption', args.caption);
    }
    const res = await fetch(`${api}/sendPhoto`, { method: 'POST', body: form });
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (!res.ok || !body.ok) {
      console.error(`sendPhoto failed: ${body.description ?? res.status}`);
      process.exit(1);
    }
    console.log(`photo sent: ${args.photo}`);
  }
}

void main();
