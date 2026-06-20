import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "#vitest";
import { loadSut } from "#helpers/sut-loader.js";
const { setRuntimeMode } = await loadSut<typeof import("#src/runtime/mode.js")>(
  "#src/runtime/mode.ts",
  import.meta.url,
);
const { __resetSettingsForTests, getTtsMode, loadSettings } = await loadSut<typeof import("#src/app/stores/settings-store.js")>(
  "#src/app/stores/settings-store.ts",
  import.meta.url,
);

describe("app/stores/settings-store", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "opencode-telegram-settings-store-"));
    process.env.OPENCODE_TELEGRAM_HOME = tempHome;
    setRuntimeMode("installed");
    __resetSettingsForTests();
  });

  afterEach(async () => {
    delete process.env.OPENCODE_TELEGRAM_HOME;
    __resetSettingsForTests();
    await rm(tempHome, { recursive: true, force: true });
  });

  it.each([
    { oldValue: true, expectedMode: "all" },
    { oldValue: false, expectedMode: "off" },
  ] as const)(
    "migrates ttsEnabled=$oldValue to $expectedMode mode",
    async ({ oldValue, expectedMode }) => {
      await writeFile(
        path.join(tempHome, "settings.json"),
        JSON.stringify({ ttsEnabled: oldValue }, null, 2),
      );

      await loadSettings();

      expect(getTtsMode()).toBe(expectedMode);
    },
  );
});
