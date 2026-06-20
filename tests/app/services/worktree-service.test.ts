import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "#vitest";
import { getGitWorktreeContext, resolveGitDir } from "#src/app/services/worktree-service.js";

const mocked = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  fileTextMock: vi.fn(),
  fileStatMock: vi.fn(),
}));

beforeEach(() => {
  vi.spyOn(Bun, "spawn").mockImplementation(mocked.spawnMock);
  vi.spyOn(Bun, "file").mockImplementation((filePath: string) => ({
    text: () => mocked.fileTextMock(filePath),
    stat: () => mocked.fileStatMock(filePath),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("app/services/worktree-service", () => {
  beforeEach(() => {
    mocked.spawnMock.mockReset();
    mocked.fileTextMock.mockReset();
    mocked.fileStatMock.mockReset();
  });

  it("returns null when .git metadata is missing", async () => {
    mocked.fileStatMock.mockRejectedValue(new Error("ENOENT"));

    await expect(resolveGitDir(path.resolve("D:/repo"))).resolves.toBeNull();
    await expect(getGitWorktreeContext(path.resolve("D:/repo"))).resolves.toBeNull();
  });

  it("resolves main worktree metadata from git worktree list", async () => {
    const repoPath = path.resolve("D:/repo");

    mocked.fileStatMock.mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
    });
    const worktreeOutput = `worktree ${repoPath}\nHEAD 123\nbranch refs/heads/main\n\nworktree ${path.resolve("D:/repo-feature")}\nHEAD 456\nbranch refs/heads/feature/mobile\n`;
    mocked.spawnMock.mockImplementation(() => ({
      exited: Promise.resolve(0),
      stdout: { text: () => Promise.resolve(worktreeOutput) },
      stderr: { text: () => Promise.resolve("") },
    }));

    const context = await getGitWorktreeContext(repoPath);

    expect(context).toEqual({
      mainProjectPath: repoPath,
      activeWorktreePath: repoPath,
      branch: "main",
      isLinkedWorktree: false,
      worktrees: [
        { path: repoPath, branch: "main", isCurrent: true, isMain: true },
        {
          path: path.resolve("D:/repo-feature"),
          branch: "feature/mobile",
          isCurrent: false,
          isMain: false,
        },
      ],
    });
  });

  it("derives the main project path for linked worktrees", async () => {
    const mainWorktree = path.resolve("D:/repo");
    const linkedWorktree = path.resolve("D:/repo-feature");
    const linkedGitDir = path.join(mainWorktree, ".git", "worktrees", "feature");
    const linkedGitPointer = path.join(linkedWorktree, ".git");

    mocked.fileStatMock.mockImplementation((p: string) => {
      if (p === linkedGitPointer) {
        return Promise.resolve({
          isDirectory: () => false,
          isFile: () => true,
        });
      }
      if (p === linkedGitDir) {
        return Promise.resolve({
          isDirectory: () => true,
          isFile: () => false,
        });
      }
      return Promise.reject(new Error(`unexpected stat: ${p}`));
    });
    mocked.fileTextMock.mockImplementation((p: string) => {
      if (p === linkedGitPointer) {
        return Promise.resolve(`gitdir: ${linkedGitDir}\n`);
      }
      if (p === path.join(linkedGitDir, "HEAD")) {
        return Promise.resolve("ref: refs/heads/feature/worktree\n");
      }
      if (p === path.join(linkedGitDir, "commondir")) {
        return Promise.resolve("../..\n");
      }
      return Promise.reject(new Error(`unexpected read: ${p}`));
    });
    const linkedOutput = `worktree ${mainWorktree}\nHEAD 123\nbranch refs/heads/main\n\nworktree ${linkedWorktree}\nHEAD 456\nbranch refs/heads/feature/worktree\n`;
    mocked.spawnMock.mockImplementation(() => ({
      exited: Promise.resolve(0),
      stdout: { text: () => Promise.resolve(linkedOutput) },
      stderr: { text: () => Promise.resolve("") },
    }));

    const context = await getGitWorktreeContext(linkedWorktree);

    expect(context).toEqual({
      mainProjectPath: mainWorktree,
      activeWorktreePath: linkedWorktree,
      branch: "feature/worktree",
      isLinkedWorktree: true,
      worktrees: [
        { path: mainWorktree, branch: "main", isCurrent: false, isMain: true },
        { path: linkedWorktree, branch: "feature/worktree", isCurrent: true, isMain: false },
      ],
    });
  });
});
