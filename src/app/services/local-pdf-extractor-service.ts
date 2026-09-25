import path from "bun:path";
import { logger } from "../../utils/logger.js";

const PDFTOTEXT_BINARY = "pdftotext";
const PDFTOPPM_BINARY = "pdftoppm";
const PDFINFO_BINARY = "pdfinfo";

const EXTRACTION_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MS = 60_000;

const RENDER_DPI = 150;

/** Upper bound on the extracted text handed to the model, so a huge PDF
 *  cannot blow up the prompt. Mirrors the 100KB text-file limit. */
export const MAX_EXTRACTED_TEXT_CHARS = 100_000;

/** Upper bound on rendered page images for scanned PDFs. */
export const MAX_RENDERED_PAGES = 5;

export interface ExtractedPdfText {
  text: string;
  truncated: boolean;
}

export interface RenderedPdfPages {
  pages: Buffer[];
  totalPages: number | null;
}

/**
 * Whether PDFs can be read locally with poppler's `pdftotext` (poppler-utils).
 * No external service is involved: documents never leave the machine for extraction.
 */
export function isLocalPdfExtractorAvailable(): boolean {
  return Boolean(Bun.which(PDFTOTEXT_BINARY));
}

/**
 * Extracts the text layer of a PDF with the LOCAL `pdftotext` binary.
 * The PDF is piped through stdin, so nothing is written to disk.
 *
 * @throws when the binary is missing or the PDF cannot be parsed.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdfText> {
  const { stdout, stderr, exitCode } = await runBinary(
    [PDFTOTEXT_BINARY, "-", "-"],
    buffer,
    EXTRACTION_TIMEOUT_MS,
  );

  if (exitCode !== 0) {
    throw new Error(`${PDFTOTEXT_BINARY} exited with code ${exitCode}: ${stderr.trim()}`);
  }

  const fullText = stdout.toString("utf-8");
  if (fullText.length <= MAX_EXTRACTED_TEXT_CHARS) {
    return { text: fullText, truncated: false };
  }

  return { text: fullText.slice(0, MAX_EXTRACTED_TEXT_CHARS), truncated: true };
}

/**
 * Renders the first pages of a PDF to JPEG images with the LOCAL `pdftoppm`
 * binary. Used for scanned PDFs (no text layer) when the active model accepts
 * image input: the pages are read visually instead of as text.
 *
 * Rendering is capped at `maxPages`; `totalPages` (from pdfinfo, best-effort)
 * tells the caller how many pages the document actually has.
 *
 * @throws when the binary is missing or no page could be rendered.
 */
export async function renderPdfPagesAsJpeg(
  buffer: Buffer,
  maxPages: number = MAX_RENDERED_PAGES,
): Promise<RenderedPdfPages> {
  if (!Bun.which(PDFTOPPM_BINARY)) {
    throw new Error(`${PDFTOPPM_BINARY} is not available`);
  }

  const totalPages = await readPdfPageCount(buffer);
  const pagesToRender =
    totalPages !== null && totalPages > 0 ? Math.min(maxPages, totalPages) : maxPages;

  const outputDir = path.join(
    process.env.TMPDIR || process.env.TEMP || "/tmp",
    `opencode-pdf-${crypto.randomUUID()}`,
  );
  await Bun.spawn(["mkdir", "-p", outputDir]).exited;

  try {
    const outputPrefix = path.join(outputDir, "page");
    const { stderr, exitCode } = await runBinary(
      [
        PDFTOPPM_BINARY,
        "-jpeg",
        "-r",
        String(RENDER_DPI),
        "-f",
        "1",
        "-l",
        String(pagesToRender),
        "-",
        outputPrefix,
      ],
      buffer,
      RENDER_TIMEOUT_MS,
    );

    if (exitCode !== 0) {
      throw new Error(`${PDFTOPPM_BINARY} exited with code ${exitCode}: ${stderr.trim()}`);
    }

    const fileNames: string[] = [];
    for await (const fileName of new Bun.Glob("page-*.jpg").scan(outputDir)) {
      fileNames.push(fileName);
    }
    fileNames.sort((a, b) => pageNumber(a) - pageNumber(b));

    if (fileNames.length === 0) {
      throw new Error(`${PDFTOPPM_BINARY} produced no page images`);
    }

    const pages = await Promise.all(
      fileNames.map(async (fileName) =>
        Buffer.from(await Bun.file(path.join(outputDir, fileName)).arrayBuffer()),
      ),
    );

    return { pages, totalPages };
  } finally {
    await Bun.spawn(["rm", "-rf", outputDir]).exited;
  }
}

interface BinaryResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

async function runBinary(
  command: string[],
  input: Buffer,
  timeoutMs: number,
): Promise<BinaryResult> {
  const process = Bun.spawn(command, {
    stdin: input,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    logger.warn(`[LocalPdf] ${command[0]} timed out after ${timeoutMs}ms, killing process`);
    process.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).arrayBuffer(),
      new Response(process.stderr).text(),
      process.exited,
    ]);

    return { stdout: Buffer.from(stdout), stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

async function readPdfPageCount(buffer: Buffer): Promise<number | null> {
  if (!Bun.which(PDFINFO_BINARY)) {
    return null;
  }

  try {
    const { stdout, exitCode } = await runBinary(
      [PDFINFO_BINARY, "-"],
      buffer,
      EXTRACTION_TIMEOUT_MS,
    );
    if (exitCode !== 0) {
      return null;
    }

    const match = stdout.toString("utf-8").match(/^Pages:\s+(\d+)/m);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function pageNumber(fileName: string): number {
  return Number(fileName.match(/(\d+)\.jpg$/)?.[1] ?? 0);
}
