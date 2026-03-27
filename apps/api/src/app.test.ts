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
  const password = (
    await readFile(path.join(root, ".data/postgres-password"), "utf8")
  ).trim();
  const url =
    process.env.TEST_DATABASE_URL ??
    `postgresql://debugroom:${password}@127.0.0.1:55432/postgres`;
  admin = connectDatabase(url);
  await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(admin);
  db = connectDatabase(url, schema);
  await migrate(db);
  directory = await mkdtemp(path.join(os.tmpdir(), "debugroom-artifacts-"));
  app = await buildApp(new Store(db), new LocalArtifacts(directory), {
    root,
    origin: "http://127.0.0.1:5173",
    localAuth: true,
    runnerToken: workerSecret,
    executionMode: "docker",
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/local",
    headers: { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" },
    remoteAddress: "127.0.0.1",
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
  return run.json();
}

describe("HTTP application boundary", () => {
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
