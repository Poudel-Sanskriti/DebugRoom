import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "kysely";
import { connectDatabase, migrate, type Database } from "./database.ts";
import { Store, type Actor } from "./store.ts";
import { Collaboration } from "./collaboration.ts";
import { root } from "./config.ts";
import { emptyDraft } from "@debugroom/contracts";

const schema = "debugroom_test_" + randomUUID().replaceAll("-", "");
let admin: Database,
  db: Database,
  store: Store,
  collab: Collaboration,
  tutor: Actor;
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
  collab = new Collaboration(store);
  const id = await store.tutor("tutor", "Tutor"),
    session = await store.createSession(id, null);
  tutor = (await store.session(session.secret))!;
});
afterAll(async () => {
  if (db) await db.destroy();
  if (admin) {
    await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(admin);
    await admin.destroy();
  }
});
async function pair() {
  const workspace = await store.createWorkspace(tutor, "Private room"),
    invitation = await collab.invite(tutor, workspace.id),
    redeemed = await collab.redeem(invitation.token),
    student = (await store.session(redeemed.secret))!;
  return {
    workspace: await store.workspace(tutor, workspace.id),
    invitation,
    redeemed,
    student,
  };
}

describe("private tutor and student workflow", () => {
  it("redeems a hashed invitation once without a student account", async () => {
    const p = await pair();
    expect(p.student.role).toBe("student");
    expect(p.student.workspaceId).toBe(p.workspace.id);
    const stored = (
      await sql<{
        token_hash: string;
      }>`SELECT token_hash FROM invitations WHERE id=${p.invitation.id}`.execute(
        db,
      )
    ).rows[0]!;
    expect(stored.token_hash).not.toBe(p.invitation.token);
    await expect(collab.redeem(p.invitation.token)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it("isolates students from other workspaces and private mentor branches", async () => {
    const a = await pair(),
      b = await pair(),
      mentor = a.workspace.branches.find((x) => x.kind === "mentor")!;
    expect(
      (await store.workspace(a.student, a.workspace.id)).branches.map(
        (x) => x.kind,
      ),
    ).toEqual(["student"]);
    await expect(
      store.workspace(a.student, b.workspace.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(store.branchRow(a.student, mentor.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    const run = await store.createRun(
      tutor,
      mentor.id,
      { ...emptyDraft, code: 'print("private")' },
      0,
      randomUUID(),
    );
    await expect(store.getRun(a.student, run.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      store.getSnapshot(a.student, run.snapshotId),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await store.listRuns(a.student, a.workspace.id)).toHaveLength(0);
  });
  it("shares only selected source while protecting private input, notes, and exports", async () => {
    const p = await pair(),
      mentor = p.workspace.branches.find((x) => x.kind === "mentor")!;
    await store.saveDraft(tutor, mentor.id, 0, {
      ...emptyDraft,
      code: 'secret = "PRIVATE_CODE"\nprint("share this")\nprint(secret)\n',
      input: '{"args":["PRIVATE_INPUT"],"kwargs":{}}',
      problem: "PRIVATE_PROBLEM",
    });
    await collab.saveNotes(
      tutor,
      mentor.id,
      "PRIVATE_HYPOTHESIS",
      "PRIVATE_CONCLUSION",
      0,
    );
    await collab.share(tutor, p.workspace.id, {
      branchId: mentor.id,
      kind: "selection",
      title: "Try this observation",
      body: "Look at the printed value.",
      startLine: 2,
      endLine: 2,
    });
    const shares = await collab.shares(p.student, p.workspace.id);
    expect(shares[0]!.source).toBe('print("share this")');
    expect(shares[0]!.input).toBeNull();
    const exported = JSON.stringify(
      await collab.exportWorkspace(p.student, p.workspace.id),
    );
    expect(exported).toContain("share this");
    for (const secret of [
      "PRIVATE_CODE",
      "PRIVATE_INPUT",
      "PRIVATE_PROBLEM",
      "PRIVATE_HYPOTHESIS",
      "PRIVATE_CONCLUSION",
    ])
      expect(exported).not.toContain(secret);
  });
  it("keeps a full shared revision immutable after mentor edits", async () => {
    const p = await pair(),
      mentor = p.workspace.branches.find((x) => x.kind === "mentor")!;
    await store.saveDraft(tutor, mentor.id, 0, {
      ...emptyDraft,
      code: 'print("version one")',
    });
    await collab.share(tutor, p.workspace.id, {
      branchId: mentor.id,
      kind: "full",
      title: "First experiment",
      body: "",
    });
    await store.saveDraft(tutor, mentor.id, 1, {
      ...emptyDraft,
      code: 'print("private version two")',
    });
    expect((await collab.shares(p.student, p.workspace.id))[0]!.source).toBe(
      'print("version one")',
    );
  });
  it("requires direct-edit confirmation and preserves the student version first", async () => {
    const p = await pair(),
      studentBranch = p.workspace.branches.find((x) => x.kind === "student")!;
    await store.saveDraft(p.student, studentBranch.id, 0, {
      ...emptyDraft,
      code: 'print("student version")',
    });
    await expect(
      store.saveDraft(tutor, studentBranch.id, 1, {
        ...emptyDraft,
        code: 'print("tutor edit")',
      }),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    await store.saveDraft(
      tutor,
      studentBranch.id,
      1,
      { ...emptyDraft, code: 'print("tutor edit")' },
      true,
    );
    const saved = (
      await sql<{
        draft: { code: string };
      }>`SELECT draft FROM snapshots WHERE branch_id=${studentBranch.id} AND reason='before_tutor_edit'`.execute(
        db,
      )
    ).rows;
    expect(saved).toHaveLength(1);
    expect(saved[0]!.draft.code).toBe('print("student version")');
  });
  it("anchors comments to snapshots and marks old revisions honestly", async () => {
    const p = await pair(),
      branch = p.workspace.branches.find((x) => x.kind === "student")!;
    const saved = await store.saveDraft(p.student, branch.id, 0, {
      ...emptyDraft,
      code: "x=1\nprint(x)",
    });
    const run = await store.createRun(
      p.student,
      branch.id,
      saved.draft,
      saved.revision,
      randomUUID(),
    );
    await collab.addComment(tutor, run.snapshotId, 2, "What is x here?");
    await store.saveDraft(p.student, branch.id, 1, {
      ...saved.draft,
      code: "x=2\nprint(x)",
    });
    const comments = await collab.comments(p.student, p.workspace.id);
    expect(comments[0]!.snapshotId).toBe(run.snapshotId);
    expect(comments[0]!.outdated).toBe(true);
    await expect(
      collab.addComment(tutor, run.snapshotId, 100, "bad line"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("revokes derived sessions and makes deletion immediately inaccessible", async () => {
    const p = await pair();
    await collab.revoke(tutor, p.workspace.id);
    expect(await store.session(p.redeemed.secret)).toBeNull();
    const second = await pair();
    await collab.deleteWorkspace(tutor, second.workspace.id);
    expect(await store.session(second.redeemed.secret)).toBeNull();
    await expect(
      store.workspace(tutor, second.workspace.id),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it("rejects expired workspaces even if an invitation exists", async () => {
    const w = await store.createWorkspace(tutor, "Expired"),
      invitation = await collab.invite(tutor, w.id);
    await sql`UPDATE workspaces SET expires_at=now()-interval '1 second' WHERE id=${w.id}`.execute(
      db,
    );
    await expect(collab.redeem(invitation.token)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(store.workspace(tutor, w.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it("saves regression inputs separately from expected-result notes", async () => {
    const p = await pair(),
      branch = p.workspace.branches.find((x) => x.kind === "student")!;
    await collab.addTestCase(
      p.student,
      branch.id,
      "Empty list",
      '{"args":[[]],"kwargs":{}}',
      "Expect -1",
    );
    const cases = await collab.testCases(p.student, branch.id);
    expect(cases[0]).toMatchObject({
      name: "Empty list",
      expected: "Expect -1",
    });
  });
});
