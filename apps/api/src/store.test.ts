import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "kysely";
import { connectDatabase, migrate, type Database } from "./database.ts";
import { Store, type Actor } from "./store.ts";
import { emptyDraft, type TraceResult } from "@debugroom/contracts";
import { root } from "./config.ts";
import path from "node:path";

const schema = "debugroom_test_" + randomUUID().replaceAll("-", "");
let db: Database, admin: Database, store: Store, actor: Actor;
const draft = {
  ...emptyDraft,
  code: "def add(a,b):\n    return a+b\n",
  input: '{"args":[2,3],"kwargs":{}}',
};
const result: TraceResult = {
  schemaVersion: 1,
  language: "python",
  outcome: "completed",
  steps: [],
  stdout: "",
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
  const tutor = await store.tutor("test:tutor", "Tutor");
  const session = await store.createSession(tutor, null);
  actor = (await store.session(session.secret))!;
});
afterAll(async () => {
  if (db) await db.destroy();
  if (admin) {
    await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(admin);
    await admin.destroy();
  }
});

async function workspace() {
  return store.createWorkspace(actor, "Test workspace");
}
async function run() {
  const w = await workspace();
  return store.createRun(actor, w.branches[0]!.id, draft, 0, randomUUID());
}

describe("PostgreSQL invariants", () => {
  it("pages older history without repeating the cursor run", async () => {
    const w = await workspace(),
      b = w.branches[0]!;
    const first = await store.createRun(actor, b.id, draft, 0, randomUUID());
    const second = await store.createRun(actor, b.id, draft, 0, randomUUID());
    expect((await store.listRuns(actor, w.id))[0]!.id).toBe(second.id);
    expect(
      (await store.listRuns(actor, w.id, second.id)).map((run) => run.id),
    ).toEqual([first.id]);
  });

  it("keeps native study workspaces without an automatic expiry", async () => {
    const localStore = new Store(db, null),
      w = await localStore.createWorkspace(actor, "Local study");
    expect(w.expiresAt).toBeNull();
    await localStore.saveDraft(actor, w.branches[0]!.id, 0, draft);
    expect((await localStore.workspace(actor, w.id)).expiresAt).toBeNull();
  });

  it("keeps run snapshots independent of later draft edits and forbids updating a snapshot", async () => {
    const w = await workspace(),
      branch = w.branches[0]!;
    const captured = await store.createRun(
      actor,
      branch.id,
      draft,
      0,
      randomUUID(),
    );
    await store.saveDraft(actor, branch.id, 0, {
      ...draft,
      code: 'print("different")',
    });
    expect((await store.getRun(actor, captured.id)).snapshot!.code).toBe(
      draft.code,
    );
    await expect(
      sql`UPDATE snapshots SET revision=9 WHERE id=${captured.snapshotId}`.execute(
        db,
      ),
    ).rejects.toThrow("immutable");
  });
  it("rejects stale concurrent saves", async () => {
    const w = await workspace(),
      branch = w.branches[0]!;
    const outcomes = await Promise.allSettled([
      store.saveDraft(actor, branch.id, 0, { ...draft, problem: "first" }),
      store.saveDraft(actor, branch.id, 0, { ...draft, problem: "second" }),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect((await store.workspace(actor, w.id)).branches[0]!.revision).toBe(1);
  });
  it("deduplicates identical run requests and rejects changed reuse", async () => {
    const w = await workspace(),
      branch = w.branches[0]!,
      key = randomUUID();
    const [a, b] = await Promise.all([
      store.createRun(actor, branch.id, draft, 0, key),
      store.createRun(actor, branch.id, draft, 0, key),
    ]);
    expect(a.id).toBe(b.id);
    await expect(
      store.createRun(
        actor,
        branch.id,
        { ...draft, input: '{"args":[3,4],"kwargs":{}}' },
        0,
        key,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it("only leases one current job from a workspace under competing workers", async () => {
    await sql`UPDATE runs SET status='finished',outcome='stopped' WHERE status!='finished'`.execute(
      db,
    );
    const w = await workspace(),
      branch = w.branches[0]!;
    await store.createRun(actor, branch.id, draft, 0, randomUUID());
    await store.createRun(actor, branch.id, draft, 0, randomUUID());
    const leases = await Promise.all([
      store.claim("a", "docker", ["python"]),
      store.claim("b", "docker", ["python"]),
    ]);
    expect(leases.filter(Boolean)).toHaveLength(1);
  });
  it("rejects an expired completion and preserves the current generation", async () => {
    await sql`UPDATE runs SET status='finished',outcome='stopped' WHERE status!='finished'`.execute(
      db,
    );
    const r = await run(),
      lease = (await store.claim("first", "docker", ["python"]))!;
    await sql`UPDATE run_attempts SET lease_until=now()-interval '1 second' WHERE id=${lease.attemptId}`.execute(
      db,
    );
    expect(await store.reapLeases()).toBe(1);
    const replacement = (await store.claim("replacement", "docker", [
      "python",
    ]))!;
    expect(replacement.generation).toBe(2);
    await expect(
      store.complete(
        lease.attemptId,
        lease.leaseToken,
        result,
        { key: "old", sha256: "a", bytes: 1 },
        {},
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await store.complete(
      replacement.attemptId,
      replacement.leaseToken,
      result,
      { key: randomUUID(), sha256: "b", bytes: 1 },
      {},
    );
    expect((await store.getRun(actor, r.id)).outcome).toBe("completed");
  });
  it("bounds infrastructure retry and allows cancellation to win before completion", async () => {
    const r = await run(),
      lease = (await store.claim("worker", "docker", ["python"]))!;
    await store.cancelRun(actor, r.id);
    expect(
      (await store.heartbeat(lease.attemptId, lease.leaseToken, true)).cancel,
    ).toBe(true);
    await store.complete(
      lease.attemptId,
      lease.leaseToken,
      result,
      { key: randomUUID(), sha256: "x", bytes: 1 },
      {},
    );
    expect((await store.getRun(actor, r.id)).outcome).toBe("stopped");
    const broken = await run();
    for (let i = 0; i < 2; i++) {
      const l = (await store.claim("broken", "docker", ["python"]))!;
      await sql`UPDATE run_attempts SET lease_until=now()-interval '1 second' WHERE id=${l.attemptId}`.execute(
        db,
      );
      await store.reapLeases();
    }
    expect((await store.getRun(actor, broken.id)).outcome).toBe(
      "infrastructure_error",
    );
  });
  it("does not expose another tutor workspace or snapshot", async () => {
    const r = await run(),
      otherId = await store.tutor("other", "Other"),
      session = await store.createSession(otherId, null),
      other = (await store.session(session.secret))!;
    await expect(store.getRun(other, r.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(store.getSnapshot(other, r.snapshotId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
