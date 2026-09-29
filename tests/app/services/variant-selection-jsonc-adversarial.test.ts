/**
 * Adversarial coverage for the OpenCode CLI config reader (plan T6).
 *
 * The executor's fixture (variant-selection-service.test.ts) covers comments +
 * trailing commas and a plain `,}`/`,]` string. This file drives the REAL reader
 * against the nasty cases the state machine could get wrong:
 *   - a comma inside a string that FOLLOWS an escaped quote (escape-state bug:
 *     a machine that forgets the escape flag would treat that comma as
 *     structural and, worse, could unbalance the string state machine),
 *   - `//` inside a string (must stay a URL, not become a comment),
 *   - a strictly plain-JSON block with no trailing commas at all (no regression),
 *   - a model absent from the config (negative control).
 *
 * HOME must point at the fixture before the SUT loads: variant-selection-service
 * resolves OPENCODE_CONFIG_PATH at module scope and caches the parsed config, so
 * only one config can be exercised per test file.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: { config: { providers: vi.fn() } },
}));

vi.mock("#src/app/services/model-selection-service.ts", () => ({
  getStoredModel: vi.fn(),
  selectModel: vi.fn(),
  reconcileStoredModelSelection: vi.fn(),
  getFavoriteModels: vi.fn(() => []),
  getModelSelectionLists: vi.fn(),
  __resetModelCatalogCacheForTests: vi.fn(),
  getProviders: vi.fn(async () => []),
  getProviderModels: vi.fn(async () => []),
  searchModels: vi.fn(async () => []),
  fetchCurrentModel: vi.fn(),
}));

const settingsStoreMock = createSettingsStoreMock();
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);

vi.mock("#src/utils/logger.ts", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Escaped-quote values: in JSON these decode to  weird":,}  /  trailing",  /
// esc},] . Every comma and brace inside them is part of the STRING.
const fakeHome = await mkdtemp(path.join(os.tmpdir(), "bot-variant-jsonc-adv-"));
await mkdir(path.join(fakeHome, ".config", "opencode"), { recursive: true });
await writeFile(
  path.join(fakeHome, ".config", "opencode", "opencode.jsonc"),
  `{
  "provider": {
    "opencode-go": {
      "models": {
        // escaped quote then a comma: the comma belongs to the string
        "esc-quote": { "options": { "reasoningEffort": "weird\\":,}" } },
        // escaped quote at the end of the string, comma right after it
        "esc-quote-eof": { "options": { "reasoningEffort": "trailing\\"," } },
        // // inside a string must not start a comment; a comment sits on the
        // next line and the two keys must survive
        "url-model": { "options": { "reasoningEffort": "max", "baseURL": "https://api.example.com/v1" } },
        "after-url": { "options": { "reasoningEffort": "low" } }, // trailing comment + trailing comma
      }
    },
    "plain": {
      // strictly plain JSON: no comments, no trailing commas
      "models": { "no-trailing-comma": { "options": { "reasoningEffort": "high" } } }
    }
  },
  "mcp": { "servers": [ "playwright", ], },
}
`,
  "utf-8",
);
process.env.HOME = fakeHome;

const variantSut = await loadSut<typeof import("#src/app/services/variant-selection-service.js")>(
  "#src/app/services/variant-selection-service.ts",
  import.meta.url,
);

describe("getDefaultVariantFromConfig — string-aware comma stripping", () => {
  it("keeps a comma and brace that follow an escaped quote inside a string", () => {
    expect(variantSut.getDefaultVariantFromConfig("opencode-go", "esc-quote")).toBe('weird":,}');
  });

  it("keeps a comma at the end of a string that ends with an escaped quote", () => {
    expect(variantSut.getDefaultVariantFromConfig("opencode-go", "esc-quote-eof")).toBe(
      'trailing",',
    );
  });

  it("does not treat // inside a string as a comment, so following keys survive", () => {
    expect(variantSut.getDefaultVariantFromConfig("opencode-go", "url-model")).toBe("max");
    expect(variantSut.getDefaultVariantFromConfig("opencode-go", "after-url")).toBe("low");
  });

  it("still reads a block that is plain JSON with no trailing commas", () => {
    expect(variantSut.getDefaultVariantFromConfig("plain", "no-trailing-comma")).toBe("high");
  });

  it("returns undefined for a model that is not in the config (negative control)", () => {
    expect(variantSut.getDefaultVariantFromConfig("opencode-go", "not-in-config")).toBeUndefined();
    expect(variantSut.getDefaultVariantFromConfig("not-a-provider", "url-model")).toBeUndefined();
  });
});
