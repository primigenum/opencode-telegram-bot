import { describe, expect, it } from "#vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadSut } from "#helpers/sut-loader.js";
const { createOpencodeServeSpawnCommand, findUnixListeningPidInSs, findWindowsListeningPidInNetstat } = await loadSut<typeof import("#src/opencode/process.js")>(
  "#src/opencode/process.ts",
  import.meta.url,
);

describe("opencode/process", () => {
  it("matches the exact local port on Windows netstat output", async () => {
    const stdout = [
      "  TCP    127.0.0.1:40960      0.0.0.0:0      LISTENING       1111",
      "  TCP    127.0.0.1:4096       0.0.0.0:0      LISTENING       2222",
    ].join("\r\n");

    expect(findWindowsListeningPidInNetstat(stdout, 4096)).toBe(2222);
  });

  it("matches the exact local port in ss fallback output", async () => {
    const stdout = [
      'LISTEN 0 128 127.0.0.1:40960 0.0.0.0:* users:(("node",pid=1111,fd=17))',
      'LISTEN 0 128 127.0.0.1:4096 0.0.0.0:* users:(("opencode",pid=2222,fd=18))',
    ].join("\n");

    expect(findUnixListeningPidInSs(stdout, 4096)).toBe(2222);
  });

  it("builds opencode serve command with the configured local port", () => {
    const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 });

    if (process.platform === "win32") {
      expect(command).toEqual({
        command: "cmd.exe",
        args: ["/c", "opencode", "serve", "--port", "4987"],
        windowsHide: true,
      });
      return;
    }

    expect(command).toEqual({
      command: "opencode",
      args: ["serve", "--port", "4987"],
      windowsHide: false,
    });
  });
  it("falls back to cmd.exe on Windows when opencode.exe cannot be resolved", () => {
    if (process.platform !== "win32") {
      return;
    }

    const originalPath = process.env.PATH;

    try {
      process.env.PATH = "";

      const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 });
      expect(command).toEqual({
        command: "cmd.exe",
        args: ["/c", "opencode", "serve", "--port", "4987"],
        windowsHide: true,
      });
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("resolves opencode.exe directly from PATH when no .cmd shim exists", () => {
    if (process.platform !== "win32") {
      return;
    }

    const originalPath = process.env.PATH;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-telegram-bot-"));
    const binDir = path.join(tempRoot, "bin");
    const exePath = path.join(binDir, "opencode.exe");

    try {
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(exePath, "", "utf8");

      // Isolate PATH to only the temp dir — no npm .cmd shim on PATH
      process.env.PATH = binDir;

      const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 });
      expect(command).toEqual({
        command: exePath,
        args: ["serve", "--port", "4987"],
        windowsHide: true,
      });
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses resolved opencode.exe on Windows when opencode.cmd is on PATH and exe exists", () => {
    if (process.platform !== "win32") {
      return;
    }

    const originalPath = process.env.PATH;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-telegram-bot-"));
    const binDir = path.join(tempRoot, "bin");
    const exePath = path.join(binDir, "node_modules", "opencode-ai", "bin", "opencode.exe");
    const cmdPath = path.join(binDir, "opencode.cmd");

    try {
      fs.mkdirSync(path.dirname(exePath), { recursive: true });
      fs.writeFileSync(exePath, "", "utf8");
      fs.writeFileSync(cmdPath, "@echo off\r\nexit /b 0\r\n", "utf8");

      process.env.PATH = [binDir, originalPath].filter(Boolean).join(path.delimiter);

      const command = createOpencodeServeSpawnCommand({ host: "localhost", port: 4987 });
      expect(command).toEqual({
        command: exePath,
        args: ["serve", "--port", "4987"],
        windowsHide: true,
      });
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
