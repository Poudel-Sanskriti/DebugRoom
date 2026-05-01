import { randomUUID, randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { loadConfig, root } from "../apps/api/src/config.ts";
import { connectDatabase, migrate } from "../apps/api/src/database.ts";
import { Store } from "../apps/api/src/store.ts";
import { LocalArtifacts } from "../apps/api/src/artifacts.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { TestClient, waitForRun } from "./http-client.ts";
import { examples } from "../apps/web/src/examples.ts";

const config = await loadConfig(),
  schema = "debugroom_test_" + randomUUID().replaceAll("-", ""),
  controlToken = randomBytes(32).toString("hex");
const admin = connectDatabase(config.databaseUrl);
await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(admin);
const db = connectDatabase(config.databaseUrl, schema);
await migrate(db);
const store = new Store(db);
const directory = await mkdtemp(path.join(os.tmpdir(), "debugroom-benchmark-"));
const origin = "http://127.0.0.1:3457",
  app = await buildApp(store, new LocalArtifacts(directory), {
    root,
    origin,
    localAuth: true,
    localLoginToken: randomBytes(32).toString("hex"),
    runnerToken: controlToken,
    executionMode: "docker",
    languages: ["python"],
  });
let worker: ReturnType<typeof spawn> | undefined;
const samples: any[] = [];
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}
try {
  await app.listen({ port: 3457, host: "127.0.0.1" });
  worker = spawn(
    config.python ?? "python3",
    [path.join(root, "runner/agent/main.py")],
    {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        DEBUGROOM_API_URL: origin,
        DEBUGROOM_RUNNER_TOKEN: controlToken,
        DEBUGROOM_EXECUTION_MODE: "docker",
        DEBUGROOM_LANGUAGES: "python",
        PYTHON_CONTAINER_RUNTIME: "runsc",
        DOCKER_CONTEXT:
          process.env.DOCKER_CONTEXT ??
          (process.platform === "darwin" ? "colima-debugroom" : undefined),
      },
    },
  );
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = await fetch(origin + "/health/ready");
    if (ready.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const draft = examples.find(
    (example) => example.id === "binary-search",
  )!.draft;
  for (const count of [1, 5, 20]) {
    for (let repetition = 1; repetition <= 3; repetition++) {
      const subjects = [];
      for (let i = 0; i < count; i++) {
        const tutor = await store.tutor(
            `benchmark:${count}:${repetition}:${i}`,
            "Synthetic client",
          ),
          session = await store.createSession(tutor, null),
          actor = (await store.session(session.secret))!,
          workspace = await store.createWorkspace(
            actor,
            "Synthetic binary-search workload",
          );
        const client = new TestClient(origin, origin);
        client.cookie = `debugroom_session=${session.secret}`;
        client.csrf = session.csrf;
        subjects.push({ client, branchId: workspace.branches[0]!.id });
      }
      const batch = await Promise.all(
        subjects.map(async ({ client, branchId }) => {
          const sentAt = performance.now();
          const run = await client.request("/api/runs", "POST", {
            branchId,
            expectedRevision: 0,
            draft,
            idempotencyKey: randomUUID(),
          });
          const result = await waitForRun(client, run.id, 120_000);
          const attempts = await client.request(`/api/runs/${run.id}/attempts`);
          const attempt = attempts.attempts[0];
          return {
            concurrentWorkspaces: count,
            repetition,
            outcome: result.outcome,
            queueWaitMs: Math.max(
              0,
              Date.parse(attempt.claimed_at) - Date.parse(result.createdAt),
            ),
            sandboxStartMs: attempt.metrics.sandboxStartMs ?? null,
            executionMs: attempt.metrics.executionMs ?? null,
            artifactWriteMs: attempt.metrics.artifactWriteMs ?? null,
            endToEndMs: performance.now() - sentAt,
            eventCount: result.result?.steps.length ?? 0,
            runtime: attempt.runtime,
          };
        }),
      );
      samples.push(...batch);
      console.log(
        JSON.stringify({
          concurrentWorkspaces: count,
          repetition,
          completed: batch.filter((row) => row.outcome === "completed").length,
        }),
      );
    }
  }
  const summaries = [1, 5, 20].map((count) => {
    const rows = samples.filter((row) => row.concurrentWorkspaces === count);
    return {
      concurrentWorkspaces: count,
      samples: rows.length,
      failures: rows.filter((row) => row.outcome !== "completed").length,
      queueWaitP50Ms: percentile(
        rows.map((row) => row.queueWaitMs),
        0.5,
      ),
      queueWaitP95Ms: percentile(
        rows.map((row) => row.queueWaitMs),
        0.95,
      ),
      endToEndP50Ms: percentile(
        rows.map((row) => row.endToEndMs),
        0.5,
      ),
      endToEndP95Ms: percentile(
        rows.map((row) => row.endToEndMs),
        0.95,
      ),
    };
  });
  const report = {
    measuredAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    workingTreeHasChanges:
      execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" }).trim()
        .length > 0,
    environment: {
      platform: os.platform(),
      architecture: os.arch(),
      node: process.version,
      cpu: os.cpus()[0]?.model,
      hostMemoryBytes: os.totalmem(),
      workerSlots: 1,
    },
    workload:
      "Short binary-search programs, three bursts each at 1, 5, and 20 synthetic workspaces; includes queue, container startup, trace capture, artifact write, and polling. This is not a capacity or real-user adoption claim.",
    summaries,
    samples,
  };
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/local-benchmark.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(summaries));
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (worker.exitCode === null) worker.kill("SIGKILL");
  }
  await app.close();
  await db.destroy();
  await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(admin);
  await admin.destroy();
  await rm(directory, { recursive: true, force: true });
}
