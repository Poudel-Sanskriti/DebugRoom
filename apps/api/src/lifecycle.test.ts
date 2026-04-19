import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, access, utimes } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { sql } from "kysely";
import { connectDatabase, migrate, type Database } from "./database.ts";
import { Store, type Actor } from "./store.ts";
import { Collaboration } from "./collaboration.ts";
import { LocalArtifacts } from "./artifacts.ts";
import { maintainWorkspaces } from "./lifecycle.ts";
import { root } from "./config.ts";
import { emptyDraft, type TraceResult } from "@debugroom/contracts";
const schema = "debugroom_test_" + randomUUID().replaceAll("-", "");
let db: Database,
  admin: Database,
  store: Store,
  actor: Actor,
  artifacts: LocalArtifacts,
  directory: string;
const result: TraceResult = {
  schemaVersion: 1,
  language: "python",
  outcome: "completed",
  steps: [],
  stdout: "kept",
  stderr: "",
  objects: {},
  durationMs: 1,
  complete: true,
};
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
  store = new Store(db);
  const id = await store.tutor("test", "Test"),
    session = await store.createSession(id, null);
  actor = (await store.session(session.secret))!;
  directory = await mkdtemp(path.join(os.tmpdir(), "debugroom-lifecycle-"));
  artifacts = new LocalArtifacts(directory);
});
afterAll(async () => {
  if (db) await db.destroy();
  if (admin) {
    await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(admin);
    await admin.destroy();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function completed() {
  const w = await store.createWorkspace(actor, "Retention"),
    r = await store.createRun(
      actor,
      w.branches[0]!.id,
      { ...emptyDraft, code: "print(1)" },
      0,
      randomUUID(),
    ),
    job = (await store.claim("worker", "docker", ["python"]))!,
    artifact = await artifacts.put(job.attemptId, result);
  await store.complete(job.attemptId, job.leaseToken, result, artifact, {});
  return { workspace: w, run: r, artifact };
}
it("removes an expired workspace and its trace artifacts", async () => {
  const data = await completed();
  await sql`UPDATE workspaces SET expires_at=now()-interval '1 second' WHERE id=${data.workspace.id}`.execute(
    db,
  );
  const cleaned = await maintainWorkspaces(store, artifacts);
  expect(cleaned.expired).toBe(1);
  expect(cleaned.cleaned).toBe(1);
  await expect(
    access(path.join(directory, data.artifact.key)),
  ).rejects.toThrow();
  await expect(store.getRun(actor, data.run.id)).rejects.toMatchObject({
    statusCode: 404,
  });
});
it("keeps live artifacts and removes old unreferenced uploads", async () => {
  const live = await completed(),
    orphan = await artifacts.put(randomUUID(), result);
  const old = new Date(Date.now() - 7200_000);
  await utimes(path.join(directory, orphan.key), old, old);
  expect((await maintainWorkspaces(store, artifacts)).orphans).toBe(1);
  await expect(
    access(path.join(directory, live.artifact.key)),
  ).resolves.toBeUndefined();
  await expect(access(path.join(directory, orphan.key))).rejects.toThrow();
});
it("retains a deletion tombstone when artifact removal fails so cleanup can retry", async () => {
  const data = await completed();
  await new Collaboration(store).deleteWorkspace(actor, data.workspace.id);
  const failing = {
    put: artifacts.put.bind(artifacts),
    get: artifacts.get.bind(artifacts),
    remove: async () => {
      throw new Error("temporary storage failure");
    },
  };
  await expect(maintainWorkspaces(store, failing)).rejects.toThrow(
    "temporary storage failure",
  );
  expect(
    (
      await sql`SELECT id FROM workspaces WHERE id=${data.workspace.id} AND deleted_at IS NOT NULL`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  expect((await maintainWorkspaces(store, artifacts)).cleaned).toBe(1);
});
it("detects a corrupted trace instead of returning incorrect history", async () => {
  const artifact = await artifacts.put(randomUUID(), result);
  await expect(
    artifacts.get(artifact.key, "incorrect-checksum"),
  ).rejects.toThrow("checksum");
});
