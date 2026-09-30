import { afterAll, beforeAll, describe, expect, it } from "#vitest";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;
const SCRIPT_PATH = `${REPO_ROOT}scripts/backfill-session-titles.ts`;

interface FakeSession {
  id: string;
  title: string;
  directory: string;
}

interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: string | null;
}

interface ScriptRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  requests: RecordedRequest[];
  titlesBefore: Record<string, string>;
  titlesAfter: Record<string, string>;
}

const DEFAULT_TITLE = "New session - 2026-10-01T10:00:00.000Z";
const OWN_TITLE = "Titulo propio del usuario";
const NEAR_MISS_TITLE = "New session - notas del usuario";

const INITIAL: FakeSession[] = [
  { id: "ses_def_1", title: DEFAULT_TITLE, directory: "/proj/one" },
  { id: "ses_def_2", title: DEFAULT_TITLE, directory: "/proj/two" },
  { id: "ses_def_3", title: DEFAULT_TITLE, directory: "/proj/two" },
  { id: "ses_keep_1", title: OWN_TITLE, directory: "/proj/one" },
  { id: "ses_keep_2", title: NEAR_MISS_TITLE, directory: "/proj/one" },
];

const sessions: FakeSession[] = INITIAL.map((session) => ({ ...session }));

function userMessage(created: number, parts: Array<{ type: string; text?: string }>) {
  return { info: { role: "user", time: { created } }, parts };
}

const MESSAGES: Record<string, unknown[]> = {
  // The oldest user message carries no text, so the next one must be used.
  ses_def_1: [
    userMessage(100, [{ type: "text", text: "   " }]),
    userMessage(200, [{ type: "text", text: "primer prompt con texto" }]),
  ],
  ses_def_3: [userMessage(300, [{ type: "text", text: "prompt de la sesion 3" }])],
};

let baseUrl = "";
let requests: RecordedRequest[] = [];

function titles(): Record<string, string> {
  return Object.fromEntries(sessions.map((session) => [session.id, session.title]));
}

function resetState(): void {
  requests = [];
  sessions.splice(0, sessions.length, ...INITIAL.map((session) => ({ ...session })));
}

async function runScript(args: string[], apiUrl?: string): Promise<ScriptRun> {
  resetState();
  const titlesBefore = titles();
  const proc = Bun.spawn(["bun", "run", "--no-env-file", SCRIPT_PATH, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      OPENCODE_API_URL: apiUrl ?? baseUrl,
      OPENCODE_USERNAME: "",
      OPENCODE_PASSWORD: "",
      OPENCODE_SERVER_USERNAME: "",
      OPENCODE_SERVER_PASSWORD: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    exitCode,
    stdout,
    stderr,
    requests: requests.slice(),
    titlesBefore,
    titlesAfter: titles(),
  };
}

function writes(run: ScriptRun): RecordedRequest[] {
  return run.requests.filter((request) => request.method !== "GET");
}

function patchBodies(run: ScriptRun): Array<{ path: string; title: string }> {
  return writes(run).map((request) => ({
    path: request.path,
    title: JSON.parse(request.body ?? "{}").title as string,
  }));
}

describe("scripts/backfill-session-titles", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const url = new URL(request.url);
        const method = request.method.toUpperCase();

        if (method === "GET" && url.pathname === "/session") {
          const directory = url.searchParams.get("directory");
          const data = directory
            ? sessions.filter((session) => session.directory === directory)
            : sessions;
          requests.push({ method, path: url.pathname, query: {}, body: null });
          requests[requests.length - 1].query = Object.fromEntries(url.searchParams);
          return Response.json(data);
        }

        const messages = url.pathname.match(/^\/session\/([^/]+)\/message$/);
        if (method === "GET" && messages) {
          const id = messages[1];
          requests.push({ method, path: url.pathname, query: {}, body: null });
          requests[requests.length - 1].query = Object.fromEntries(url.searchParams);
          if (id === "ses_def_2") {
            // A per-session failure must not abort the whole run.
            return Response.json({ error: "boom" }, { status: 500 });
          }
          return Response.json(MESSAGES[id] ?? []);
        }

        const session = url.pathname.match(/^\/session\/([^/]+)$/);
        if (session && method === "PATCH") {
          return request.text().then((raw) => {
            const body = JSON.parse(raw) as { title?: string };
            requests.push({
              method,
              path: url.pathname,
              query: Object.fromEntries(url.searchParams),
              body: raw,
            });
            const target = sessions.find((candidate) => candidate.id === session[1]);
            if (target && typeof body.title === "string") {
              target.title = body.title;
            }
            return Response.json(target ?? { id: session[1] });
          });
        }

        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server?.stop(true);
  });

  it("dry-run writes nothing (implicit default and explicit --dry-run)", async () => {
    for (const args of [[], ["--dry-run"]]) {
      const run = await runScript(args);
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("dry-run (no changes written)");
      expect(writes(run)).toEqual([]);
      expect(run.requests.every((request) => request.method === "GET")).toBe(true);
      expect(run.titlesAfter).toEqual(run.titlesBefore);
    }
  });

  it("--apply patches only the default-title sessions, with the derived title", async () => {
    const run = await runScript(["--apply"]);
    expect(run.exitCode).toBe(0);
    expect(patchBodies(run)).toEqual([
      { path: "/session/ses_def_1", title: "primer prompt con texto" },
      { path: "/session/ses_def_3", title: "prompt de la sesion 3" },
    ]);
    expect(run.titlesAfter).toEqual({
      ses_def_1: "primer prompt con texto",
      ses_def_2: DEFAULT_TITLE,
      ses_def_3: "prompt de la sesion 3",
      ses_keep_1: OWN_TITLE,
      ses_keep_2: NEAR_MISS_TITLE,
    });
    // The failing session is reported and counted as skipped; the run continues.
    expect(run.stderr).toContain("ses_def_2");
    expect(run.stdout).toContain("skipped:  1 (no text: 0, errors: 1)");
    expect(run.stdout).toContain("renamed:  2");
  });

  it("--directory scopes the listing and the per-session requests", async () => {
    const run = await runScript(["--dry-run", "--directory", "/proj/one"]);
    expect(run.exitCode).toBe(0);
    const list = run.requests[0];
    expect(list.path).toBe("/session");
    expect(list.query.directory).toBe("/proj/one");
    expect(list.query.roots).toBe("true");
    expect(run.stdout).toContain("Scanned 3 root session(s); 1 have the default title.");
    expect(run.stdout).toContain("primer prompt con texto");
    expect(run.stdout).not.toContain("ses_def_3");
    expect(run.titlesAfter).toEqual(run.titlesBefore);
  });

  it("rejects unknown arguments and a --directory without a value", async () => {
    const unknown = await runScript(["--bogus"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("Unknown argument: --bogus");
    expect(unknown.stderr).toContain("Usage:");
    expect(unknown.requests).toEqual([]);

    const missing = await runScript(["--directory"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Missing value for --directory");
    expect(missing.requests).toEqual([]);
  });

  it("falls back to dry-run when --dry-run comes after --apply", async () => {
    const run = await runScript(["--apply", "--dry-run"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("dry-run (no changes written)");
    expect(writes(run)).toEqual([]);
    expect(run.titlesAfter).toEqual(run.titlesBefore);
  });

  it("fails loudly with exit 1 when the server is unreachable", async () => {
    const run = await runScript(["--apply"], "http://127.0.0.1:1");
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("Failed to list sessions");
  });
});