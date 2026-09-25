import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";

/**
 * One-page PDF (449 bytes) with the text "Hello PDF fixture" and no xref table.
 * Poppler reconstructs the cross-reference, so it works for both pdftotext
 * (text layer) and pdftoppm (page rendering) smoke tests.
 */
const MINIMAL_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NiA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDcyMCBUZCAoSGVsbG8gUERGIGZpeHR1cmUpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnRyYWlsZXIKPDwgL1Jvb3QgMSAwIFIgL1NpemUgNiA+PgolJUVPRgo=";

const pdfFixture = () => Buffer.from(MINIMAL_PDF_BASE64, "base64");

const hasPoppler = Boolean(Bun.which("pdftotext") && Bun.which("pdftoppm"));

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function fakeProcess(options: { stdout?: string; stderr?: string; exitCode?: number } = {}) {
  return {
    stdout: streamOf(options.stdout ?? ""),
    stderr: streamOf(options.stderr ?? ""),
    exited: Promise.resolve(options.exitCode ?? 0),
    kill: () => {},
  } as unknown as ReturnType<typeof Bun.spawn>;
}

async function getSut() {
  return loadSut<typeof import("#src/app/services/local-pdf-extractor-service.js")>(
    "#src/app/services/local-pdf-extractor-service.ts",
    import.meta.url,
  );
}

describe("app/services/local-pdf-extractor-service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("isLocalPdfExtractorAvailable", () => {
    it("is available when pdftotext is on PATH", async () => {
      const whichSpy = vi
        .spyOn(Bun, "which")
        .mockImplementation(((binary: unknown) =>
          binary === "pdftotext" ? "/usr/bin/pdftotext" : null) as never);

      const sut = await getSut();

      expect(sut.isLocalPdfExtractorAvailable()).toBe(true);
      expect(whichSpy).toHaveBeenCalledWith("pdftotext");
    });

    it("is unavailable when pdftotext is missing", async () => {
      vi.spyOn(Bun, "which").mockImplementation((() => null) as never);

      const sut = await getSut();

      expect(sut.isLocalPdfExtractorAvailable()).toBe(false);
    });
  });

  describe("extractPdfText", () => {
    it("returns the text layer produced by pdftotext", async () => {
      const spawnSpy = vi
        .spyOn(Bun, "spawn")
        .mockImplementation((() => fakeProcess({ stdout: "Hello from the PDF\n" })) as never);

      const sut = await getSut();
      const result = await sut.extractPdfText(pdfFixture());

      expect(result).toEqual({ text: "Hello from the PDF\n", truncated: false });
      expect(spawnSpy).toHaveBeenCalledWith(
        ["pdftotext", "-", "-"],
        expect.objectContaining({ stdin: expect.any(Buffer) }),
      );
    });

    it("truncates text over MAX_EXTRACTED_TEXT_CHARS", async () => {
      const sut = await getSut();
      const oversized = "x".repeat(sut.MAX_EXTRACTED_TEXT_CHARS + 5_000);
      vi.spyOn(Bun, "spawn").mockImplementation((() =>
        fakeProcess({ stdout: oversized })) as never);

      const result = await sut.extractPdfText(pdfFixture());

      expect(result.truncated).toBe(true);
      expect(result.text).toHaveLength(sut.MAX_EXTRACTED_TEXT_CHARS);
    });

    it("throws when pdftotext exits with an error", async () => {
      vi.spyOn(Bun, "spawn").mockImplementation((() =>
        fakeProcess({ stderr: "Syntax Error: Couldn't read xref table", exitCode: 1 })) as never);

      const sut = await getSut();

      await expect(sut.extractPdfText(Buffer.from("not a pdf"))).rejects.toThrow(
        "pdftotext exited with code 1",
      );
    });

    it.skipIf(!hasPoppler)("extracts text from a real PDF", async () => {
      const sut = await getSut();

      const result = await sut.extractPdfText(pdfFixture());

      expect(result.truncated).toBe(false);
      expect(result.text).toContain("Hello PDF fixture");
    });

    it.skipIf(!hasPoppler)("throws on a corrupt buffer with the real binary", async () => {
      const sut = await getSut();

      await expect(sut.extractPdfText(Buffer.from("not a pdf at all"))).rejects.toThrow(
        "pdftotext exited with code 1",
      );
    });
  });

  describe("renderPdfPagesAsJpeg", () => {
    it.skipIf(!hasPoppler)("renders real page images and reports the page count", async () => {
      const sut = await getSut();

      const rendered = await sut.renderPdfPagesAsJpeg(pdfFixture());

      expect(rendered.totalPages).toBe(1);
      expect(rendered.pages).toHaveLength(1);
      // JPEG magic bytes (FF D8).
      expect(rendered.pages[0][0]).toBe(0xff);
      expect(rendered.pages[0][1]).toBe(0xd8);
    });

    it("throws when pdftoppm is missing", async () => {
      vi.spyOn(Bun, "which").mockImplementation(((binary: unknown) =>
        binary === "pdftoppm" ? null : "/usr/bin/tool") as never);

      const sut = await getSut();

      await expect(sut.renderPdfPagesAsJpeg(pdfFixture())).rejects.toThrow(
        "pdftoppm is not available",
      );
    });
  });
});
