/**
 * Regression coverage for the effective-variant resolution (plan D1/T1).
 *
 * The pre-existing suite only exercised resolveVariant()/getCurrentVariant()/
 * getStoredModel() through mocks, so the real resolution chain (stored variant
 * -> opencode.jsonc reasoningEffort -> "default") had no test. This file drives
 * the REAL variant-selection-service and model-selection-service against a REAL
 * opencode.jsonc fixture, so a wrong order in the precedence chain fails here.
 *
 * HOME must point at the fixture before the SUT loads: variant-selection-service
 * resolves OPENCODE_CONFIG_PATH at module scope and caches the parsed config.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";

const CONFIGURED_PROVIDER = "opencode-go";
const CONFIGURED_MODEL = "deepseek-v4-flash";
const UNCONFIGURED_MODEL = "deepseek-v4.1-flash";

interface StoredModel {
  providerID: string;
  modelID: string;
  variant?: string;
}

// --- Real config fixture: reasoningEffort "max" for CONFIGURED_MODEL only.
// The trailing commas (after the model entry and after the provider block) are
// deliberate: they keep this end-to-end file load-bearing on the JSONC reader
// (plan T6), so a regression in the reader cannot pass unnoticed here.
const fakeHome = await mkdtemp(path.join(os.tmpdir(), "bot-variant-cfg-"));
await mkdir(path.join(fakeHome, ".config", "opencode"), { recursive: true });
await writeFile(
  path.join(fakeHome, ".config", "opencode", "opencode.jsonc"),
  `{
  // fixture for variant-resolution-regression.test.ts
  "provider": {
    "${CONFIGURED_PROVIDER}": {
      "models": {
        "${CONFIGURED_MODEL}": { "options": { "reasoningEffort": "max" } },
      }
    },
  }
}
`,
  "utf-8",
);
process.env.HOME = fakeHome;

const store = vi.hoisted(() => {
  let currentModel: { providerID: string; modelID: string; variant?: string } | undefined;
  return {
    getCurrentModel: () => currentModel,
    setCurrentModel: (model: { providerID: string; modelID: string; variant?: string }) => {
      currentModel = model;
    },
    seed: (model?: StoredModel) => {
      currentModel = model;
    },
  };
});

const settingsStoreMock = createSettingsStoreMock();
settingsStoreMock.getCurrentModel = vi.fn(() => store.getCurrentModel());
settingsStoreMock.setCurrentModel = vi.fn((model: StoredModel) => store.setCurrentModel(model));
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);

vi.mock("#src/config.ts", () => ({
  config: { opencode: { model: { provider: "env-provider", modelId: "env-model" } } },
}));

vi.mock("#src/opencode/client.ts", () => ({
  opencodeClient: { config: { providers: vi.fn() } },
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const variantSut = await loadSut<typeof import("#src/app/services/variant-selection-service.js")>(
  "#src/app/services/variant-selection-service.ts",
  import.meta.url,
);
const modelSut = await loadSut<typeof import("#src/app/services/model-selection-service.js")>(
  "#src/app/services/model-selection-service.ts",
  import.meta.url,
);

function seedConfigured(variant?: string): void {
  store.seed({ providerID: CONFIGURED_PROVIDER, modelID: CONFIGURED_MODEL, variant });
}

function seedUnconfigured(variant?: string): void {
  store.seed({ providerID: CONFIGURED_PROVIDER, modelID: UNCONFIGURED_MODEL, variant });
}

describe("resolveVariant — real precedence chain", () => {
  it("prefers a real stored variant over the configured default", () => {
    expect(variantSut.resolveVariant(CONFIGURED_PROVIDER, CONFIGURED_MODEL, "low")).toBe("low");
  });

  it('treats the stored literal "default" as no explicit choice and uses the config', () => {
    expect(variantSut.resolveVariant(CONFIGURED_PROVIDER, CONFIGURED_MODEL, "default")).toBe("max");
  });

  it("uses the config when nothing is stored at all", () => {
    expect(variantSut.resolveVariant(CONFIGURED_PROVIDER, CONFIGURED_MODEL)).toBe("max");
    expect(variantSut.resolveVariant(CONFIGURED_PROVIDER, CONFIGURED_MODEL, undefined)).toBe("max");
  });

  it('falls back to "default" only when the model has no configured default', () => {
    expect(variantSut.resolveVariant(CONFIGURED_PROVIDER, UNCONFIGURED_MODEL, "default")).toBe(
      "default",
    );
    expect(variantSut.resolveVariant(CONFIGURED_PROVIDER, UNCONFIGURED_MODEL)).toBe("default");
  });
});

describe('getCurrentVariant — never reports the raw stored "default"', () => {
  beforeEach(() => store.seed(undefined));

  it('reports the configured default when the stored variant is "default"', () => {
    seedConfigured("default");

    expect(variantSut.getCurrentVariant()).toBe("max");
  });

  it("reports the configured default when no variant is stored", () => {
    seedConfigured(undefined);

    expect(variantSut.getCurrentVariant()).toBe("max");
  });

  it("keeps a real stored variant", () => {
    seedConfigured("low");

    expect(variantSut.getCurrentVariant()).toBe("low");
  });

  it('reports "default" for a model without a configured default', () => {
    seedUnconfigured("default");

    expect(variantSut.getCurrentVariant()).toBe("default");
  });
});

describe("getStoredModel — resolves the effective variant for display and prompt", () => {
  beforeEach(() => store.seed(undefined));

  it('resolves the configured default when the stored variant is "default"', () => {
    seedConfigured("default");

    expect(modelSut.getStoredModel().variant).toBe("max");
  });

  it("resolves the configured default when no variant is stored", () => {
    seedConfigured(undefined);

    expect(modelSut.getStoredModel().variant).toBe("max");
  });

  it("does not clobber a real stored variant", () => {
    seedConfigured("low");

    expect(modelSut.getStoredModel().variant).toBe("low");
  });

  it('keeps "default" for a model without a configured default', () => {
    seedUnconfigured("default");

    expect(modelSut.getStoredModel().variant).toBe("default");
  });
});

describe("coherence — getCurrentVariant() and getStoredModel().variant agree", () => {
  beforeEach(() => store.seed(undefined));

  const states: Array<{ label: string; seed: () => void; expected: string }> = [
    {
      label: 'stored "default" on a configured model',
      seed: () => seedConfigured("default"),
      expected: "max",
    },
    {
      label: "no stored variant on a configured model",
      seed: () => seedConfigured(undefined),
      expected: "max",
    },
    { label: "real stored variant", seed: () => seedConfigured("low"), expected: "low" },
    {
      label: 'stored "default" on an unconfigured model',
      seed: () => seedUnconfigured("default"),
      expected: "default",
    },
  ];

  for (const state of states) {
    it(`agrees on the same value: ${state.label}`, () => {
      state.seed();

      const fromCurrent = variantSut.getCurrentVariant();
      const fromStored = modelSut.getStoredModel().variant;

      expect(fromCurrent).toBe(state.expected);
      expect(fromStored).toBe(state.expected);
      expect(fromStored).toBe(fromCurrent);
    });
  }
});
