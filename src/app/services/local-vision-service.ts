import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";

export type LocalVisionResult =
  | { ok: true; description: string }
  | { ok: false; error: string };

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Describes an image with the LOCAL vision model (LFM2.5-VL-3B via llama.cpp,
 * OpenAI-compatible endpoint, default http://127.0.0.1:8082/v1).
 *
 * Used as a vision fallback: when the active opencode model doesn't support
 * image input, the bot describes the photo locally and sends the description
 * as text to the model. Keeps photo analysis 100% local and private.
 */
export async function describeImageWithLocalVision(
  buffer: Buffer,
  mime: string = "image/jpeg",
  question?: string,
): Promise<LocalVisionResult> {
  const prompt =
    question ??
    "Describe this photo in detail: read ALL visible text verbatim, describe the layout, colors, and any status indicators. Be factual and concise.";

  const body = {
    model: config.vision.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${buffer.toString("base64")}` },
          },
        ],
      },
    ],
    max_tokens: 800,
  };

  try {
    const res = await fetch(`${config.vision.apiUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { ok: false, error: "empty response" };
    }
    return { ok: true, description: content };
  } catch (err) {
    logger.warn(`[Bot] Local vision request failed: ${String(err)}`);
    return { ok: false, error: String(err) };
  }
}
