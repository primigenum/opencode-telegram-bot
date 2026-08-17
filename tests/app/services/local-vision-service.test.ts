import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";


let fetchMock: ReturnType<typeof vi.fn>;

async function getSut() {
  return loadSut<typeof import("#src/app/services/local-vision-service.js")>(
    "#src/app/services/local-vision-service.ts",
    import.meta.url,
  );
}

describe("app/services/local-vision-service", () => {
  beforeEach(() => {
    process.env.LOCAL_VISION_API_URL = "http://127.0.0.1:8082/v1";
    process.env.LOCAL_VISION_MODEL = "lfm2.5-vl-3b";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns the description from the local vision server", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "A salon booking confirmation." } }],
      }),
    });

    const { describeImageWithLocalVision } = await getSut();
    const result = await describeImageWithLocalVision(Buffer.from("img-bytes"), "image/jpeg");

    expect(result).toEqual({ ok: true, description: "A salon booking confirmation." });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8082/v1/chat/completions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("lfm2.5-vl-3b");
    expect(body.messages[0].content[1].image_url.url).toContain(
      "data:image/jpeg;base64,aW1nLWJ5dGVz",
    );
  });

  it("returns an error when the server responds non-OK", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const { describeImageWithLocalVision } = await getSut();
    const result = await describeImageWithLocalVision(Buffer.from("img-bytes"));

    expect(result).toEqual({ ok: false, error: "HTTP 500" });
  });

  it("returns an error when the server is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const { describeImageWithLocalVision } = await getSut();
    const result = await describeImageWithLocalVision(Buffer.from("img-bytes"));

    expect(result.ok).toBe(false);
  });

  it("returns an error when the response has no content", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "   " } }] }),
    });

    const { describeImageWithLocalVision } = await getSut();
    const result = await describeImageWithLocalVision(Buffer.from("img-bytes"));

    expect(result).toEqual({ ok: false, error: "empty response" });
  });
});
