import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { connectDatabase, migrate, type Database } from "./database.ts";
import { Store } from "./store.ts";
import { LocalArtifacts } from "./artifacts.ts";
import { buildApp } from "./app.ts";
import { root } from "./config.ts";
import { emptyDraft } from "@debugroom/contracts";

const schema = "debugroom_test_" + randomUUID().replaceAll("-", "");
let db: Database,
  admin: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  directory: string,
  headers: Record<string, string>;
const workerSecret = "test-worker-secret-with-at-least-32-characters";
const workerHeaders = { authorization: `Bearer ${workerSecret}` };
beforeAll(async () => {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const password = (
      await readFile(path.join(root, ".data/postgres-password"), "utf8")
    ).trim();
    url = `postgresql://debugroom:${password}@127.0.0.1:55432/postgres`;
  }
  admin = connectDatabase(url);
  await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(admin);
  db = connectDatabase(url, schema);
  await migrate(db);
  directory = await mkdtemp(path.join(os.tmpdir(), "debugroom-artifacts-"));
  app = await buildApp(new Store(db), new LocalArtifacts(directory), {
    root,
    origin: "http://127.0.0.1:5173",
    localAuth: true,
    localLoginToken: "test-local-login-key-at-least-32-characters",
    runnerToken: workerSecret,
    executionMode: "docker",
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/local",
    headers: { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" },
    remoteAddress: "127.0.0.1",
    payload: { token: "test-local-login-key-at-least-32-characters" },
  });
  expect(login.statusCode).toBe(200);
  const cookie = login.cookies[0]!.value;
  const session = await app.inject({
    url: "/api/session",
    headers: { host: "127.0.0.1:5173", cookie: `debugroom_session=${cookie}` },
  });
  headers = {
    host: "127.0.0.1:5173",
    origin: "http://127.0.0.1:5173",
    cookie: `debugroom_session=${cookie}`,
    "x-csrf-token": session.json().csrf,
  };
});
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.destroy();
  if (admin) {
    await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(admin);
    await admin.destroy();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function createRun() {
  const workspace = (
    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers,
      payload: { title: "Binary search" },
    })
  ).json();
  const draft = {
    ...emptyDraft,
    code: "def add(a,b):\n    return a+b\n",
    input: '{"args":[2,3],"kwargs":{}}',
  };
  const run = await app.inject({
    method: "POST",
    url: "/api/runs",
    headers,
    payload: {
      branchId: workspace.branches[0].id,
      expectedRevision: 0,
      draft,
      idempotencyKey: randomUUID(),
    },
  });
  expect(run.statusCode).toBe(200);
  expect(run.json().snapshot.entryPoint).toBe(draft.entryPoint);
  return run.json();
}

describe("HTTP application boundary", () => {
  it("opens local loopback sessions without a key while rejecting remote and cross-site access", async () => {
    const automatic = await buildApp(
      new Store(db),
      new LocalArtifacts(directory),
      {
        root,
        origin: "http://127.0.0.1:5173",
        localAuth: true,
        localAutoAuth: true,
        runnerToken: workerSecret,
        executionMode: "docker",
      },
    );
    const request = {
      method: "POST" as const,
      url: "/api/auth/local",
      headers: { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" },
      payload: {},
      remoteAddress: "127.0.0.1",
    };
    try {
      const login = await automatic.inject(request);
      expect(login.statusCode).toBe(200);
      expect(login.cookies[0]?.httpOnly).toBe(true);
      expect(
        (
          await automatic.inject({
            ...request,
            headers: {
              ...request.headers,
              cookie: "debugroom_session=revoked-session",
            },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await automatic.inject({ ...request, remoteAddress: "192.168.1.5" }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await automatic.inject({
            ...request,
            headers: { ...request.headers, origin: "https://example.com" },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await automatic.inject({
            ...request,
            headers: { ...request.headers, host: "example.com" },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await automatic.inject({
            ...request,
            headers: { host: request.headers.host },
          })
        ).statusCode,
      ).toBe(403);
      expect((await app.inject(request)).statusCode).toBe(403);
    } finally {
      await automatic.close();
    }
  });
  it("never enables automatic entry for hosted or proxied sessions", async () => {
    for (const config of [
      { localAuth: false },
      { localAuth: true, localProxyAuth: true },
      { localAuth: true, trustProxy: ["127.0.0.1"] },
    ]) {
      const protectedApp = await buildApp(
        new Store(db),
        new LocalArtifacts(directory),
        {
          root,
          origin: "http://127.0.0.1:5173",
          runnerToken: workerSecret,
          executionMode: "docker",
          localAutoAuth: true,
          ...config,
        },
      );
      try {
        const response = await protectedApp.inject({
          method: "POST",
          url: "/api/auth/local",
          headers: { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" },
          payload: {},
          remoteAddress: "127.0.0.1",
        });
        expect(response.statusCode).toBe(config.localAuth ? 403 : 404);
      } finally {
        await protectedApp.close();
      }
    }
  });
  it("requires a session and rejects cross-origin and rebinding requests", async () => {
    expect(
      (
        await app.inject({
          url: "/api/workspaces",
          headers: { host: headers.host },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: "/api/workspaces",
          headers: { ...headers, origin: "https://attacker.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/api/workspaces",
          headers: { ...headers, host: "attacker.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/workspaces",
          headers: { ...headers, "x-csrf-token": "wrong" },
          payload: { title: "x" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("requires separate worker credentials", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/worker/claim",
          headers,
          payload: { workerId: "x", runtime: "docker", languages: ["python"] },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("discovers functions without executing top-level source", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/functions",
      headers,
      payload: {
        language: "python",
        code: 'raise Exception("must not run")\ndef first(x):\n    return x\ndef second():\n    pass',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().functions.map((x: any) => x.name)).toEqual([
      "first",
      "second",
    ]);
  });
  it("validates structured input before queueing execution", async () => {
    const workspace = (
      await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers,
        payload: { title: "Invalid input" },
      })
    ).json();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers,
      payload: {
        branchId: workspace.branches[0].id,
        expectedRevision: 0,
        draft: { ...emptyDraft, code: "print(1)", input: "not JSON" },
        idempotencyKey: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_input");
  });
  it("captures immutable source through claim, completion, and authorized artifact retrieval", async () => {
    const run = await createRun();
    const claim = await app.inject({
      method: "POST",
      url: "/internal/worker/claim",
      headers: workerHeaders,
      payload: { workerId: "test", runtime: "docker", languages: ["python"] },
    });
    const job = claim.json().job;
    expect(job.runId).toBe(run.id);
    const completed = await app.inject({
      method: "POST",
      url: "/internal/worker/complete",
      headers: workerHeaders,
      payload: {
        attemptId: job.attemptId,
        leaseToken: job.leaseToken,
        metrics: { executionMs: 1 },
        result: {
          schemaVersion: 1,
          language: "python",
          outcome: "completed",
          steps: [],
          stdout: "observed",
          stderr: "",
          objects: {},
          durationMs: 1,
          complete: true,
        },
      },
    });
    expect(completed.statusCode).toBe(200);
    const response = await app.inject({ url: `/api/runs/${run.id}`, headers });
    expect(response.json().result.stdout).toBe("observed");
    expect(response.json().snapshot.code).toContain("def add");
    expect(
      (
        await app.inject({
          url: `/api/runs/${run.id}`,
          headers: { host: headers.host },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("rejects malformed trace data without finishing a run", async () => {
    const run = await createRun();
    const job = (
      await app.inject({
        method: "POST",
        url: "/internal/worker/claim",
        headers: workerHeaders,
        payload: { workerId: "test", runtime: "docker", languages: ["python"] },
      })
    ).json().job;
    const response = await app.inject({
      method: "POST",
      url: "/internal/worker/complete",
      headers: workerHeaders,
      payload: {
        attemptId: job.attemptId,
        leaseToken: job.leaseToken,
        metrics: {},
        result: { schemaVersion: 2, steps: [{ index: 0 }] },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(
      (await app.inject({ url: `/api/runs/${run.id}`, headers })).json().status,
    ).toBe("running");
  });
});
