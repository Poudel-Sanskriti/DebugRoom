import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { Draft, SharedRevision } from "@debugroom/contracts";
import { Store, hash, token, type Actor } from "./store.ts";
import type { Artifacts } from "./artifacts.ts";
import { ApiError, requireRow } from "./errors.ts";

export class Collaboration {
  constructor(
    public store: Store,
    private artifacts?: Artifacts,
  ) {}
  private requireTutor(actor: Actor) {
    if (actor.role !== "tutor")
      throw new ApiError(403, "Only the tutor can perform this action");
  }
  async createMentorCopy(
    actor: Actor,
    workspaceId: string,
    snapshotId?: string,
  ) {
    this.requireTutor(actor);
    await this.store.workspaceRow(actor, workspaceId);
    let draft: Draft;
    if (snapshotId) {
      const snapshot = await this.store.getSnapshot(actor, snapshotId);
      const owner = (
        await sql<{
          workspace_id: string;
        }>`SELECT workspace_id FROM snapshots WHERE id=${snapshotId}`.execute(
          this.store.db,
        )
      ).rows[0]!;
      if (owner.workspace_id !== workspaceId)
        throw new ApiError(404, "Snapshot not found");
      const { id, revision, createdAt, ...source } = snapshot;
      draft = source;
    } else {
      draft = (await this.store.workspace(actor, workspaceId)).branches.find(
        (b) => b.kind === "student",
      )!.draft;
    }
    await sql`INSERT INTO branches(id,workspace_id,kind,name,draft) VALUES(${randomUUID()},${workspaceId},'mentor','Mentor copy',${JSON.stringify(draft)}::jsonb) ON CONFLICT(workspace_id,kind) DO NOTHING`.execute(
      this.store.db,
    );
    return this.store.workspace(actor, workspaceId);
  }
  async invite(actor: Actor, workspaceId: string) {
    this.requireTutor(actor);
    const secret = token(),
      id = randomUUID();
    await this.store.db.transaction().execute(async (db) => {
      await this.store.workspaceRow(actor, workspaceId, db, true);
      await sql`UPDATE invitations SET revoked_at=now() WHERE workspace_id=${workspaceId} AND revoked_at IS NULL`.execute(
        db,
      );
      await sql`UPDATE grants SET revoked_at=now() WHERE workspace_id=${workspaceId} AND revoked_at IS NULL`.execute(
        db,
      );
      await sql`DELETE FROM sessions WHERE grant_id IN (SELECT id FROM grants WHERE workspace_id=${workspaceId})`.execute(
        db,
      );
      await sql`INSERT INTO invitations(id,workspace_id,token_hash) VALUES(${id},${workspaceId},${hash(secret)})`.execute(
        db,
      );
      const student = (
        await sql<{
          draft: Draft;
        }>`SELECT draft FROM branches WHERE workspace_id=${workspaceId} AND kind='student'`.execute(
          db,
        )
      ).rows[0]!;
      await sql`INSERT INTO branches(id,workspace_id,kind,name,draft) VALUES(${randomUUID()},${workspaceId},'mentor','Mentor copy',${JSON.stringify(student.draft)}::jsonb) ON CONFLICT(workspace_id,kind) DO NOTHING`.execute(
        db,
      );
      await this.store.touch(workspaceId, db);
    });
    return {
      id,
      token: secret,
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    };
  }
  async revoke(actor: Actor, workspaceId: string) {
    this.requireTutor(actor);
    await this.store.db.transaction().execute(async (db) => {
      await this.store.workspaceRow(actor, workspaceId, db, true);
      await sql`UPDATE invitations SET revoked_at=now() WHERE workspace_id=${workspaceId} AND revoked_at IS NULL`.execute(
        db,
      );
      await sql`UPDATE grants SET revoked_at=now() WHERE workspace_id=${workspaceId} AND revoked_at IS NULL`.execute(
        db,
      );
      await sql`DELETE FROM sessions WHERE grant_id IN (SELECT id FROM grants WHERE workspace_id=${workspaceId})`.execute(
        db,
      );
    });
    return { revoked: true };
  }
  async redeem(secret: string) {
    return this.store.db.transaction().execute(async (db) => {
      const invitation = requireRow(
        (
          await sql<{
            id: string;
            workspace_id: string;
          }>`SELECT id,workspace_id FROM invitations WHERE token_hash=${hash(secret)}`.execute(
            db,
          )
        ).rows[0],
        "Invitation is invalid, expired, or already used",
      );
      const workspace = (
        await sql`SELECT id FROM workspaces WHERE id=${invitation.workspace_id} AND deleted_at IS NULL AND expires_at>now() FOR UPDATE`.execute(
          db,
        )
      ).rows[0];
      if (!workspace)
        throw new ApiError(
          404,
          "Invitation is invalid, expired, or already used",
        );
      const claimed = (
        await sql`UPDATE invitations SET redeemed_at=now() WHERE id=${invitation.id} AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING id`.execute(
          db,
        )
      ).rows;
      if (!claimed.length)
        throw new ApiError(
          404,
          "Invitation is invalid, expired, or already used",
        );
      const grantId = randomUUID();
      await sql`INSERT INTO grants(id,workspace_id,invitation_id) VALUES(${grantId},${invitation.workspace_id},${invitation.id})`.execute(
        db,
      );
      const session = await this.store.createSession(null, grantId, db);
      return { workspaceId: invitation.workspace_id, ...session };
    });
  }
  async share(
    actor: Actor,
    workspaceId: string,
    body: {
      branchId: string;
      kind: "full" | "selection" | "hint";
      title: string;
      body: string;
      snapshotId?: string;
      startLine?: number;
      endLine?: number;
    },
  ) {
    this.requireTutor(actor);
    const branch = await this.store.branchRow(actor, body.branchId);
    if (branch.workspace_id !== workspaceId || branch.kind !== "mentor")
      throw new ApiError(400, "Choose the private mentor copy to share from");
    let draft = branch.draft,
      snapshotId = body.snapshotId ?? null;
    if (snapshotId) {
      const snapshot = await this.store.getSnapshot(actor, snapshotId);
      const origin = (
        await sql<{
          branch_id: string;
        }>`SELECT branch_id FROM snapshots WHERE id=${snapshotId}`.execute(
          this.store.db,
        )
      ).rows[0]!;
      if (origin.branch_id !== branch.id)
        throw new ApiError(404, "Snapshot not found");
      const { id, revision, createdAt, ...source } = snapshot;
      draft = source;
    }
    let source: string | null = null,
      input: string | null = null;
    if (body.kind === "full") {
      source = draft.code;
      input = draft.input;
    }
    if (body.kind === "selection") {
      const lines = draft.code.split("\n");
      const first = body.startLine ?? 0,
        last = body.endLine ?? 0;
      if (first < 1 || last < first || last > lines.length)
        throw new ApiError(400, "Select an existing source-line range");
      source = lines.slice(first - 1, last).join("\n");
    }
    const content = {
      source,
      input,
      language: draft.language,
      entryPoint: body.kind === "full" ? draft.entryPoint : null,
      problem: body.kind === "full" ? draft.problem : null,
    };
    const id = randomUUID();
    await this.store.db.transaction().execute(async (db) => {
      await this.store.workspaceRow(actor, workspaceId, db);
      if (!snapshotId)
        snapshotId = await this.store.snapshot(branch, draft, "share", db);
      await sql`INSERT INTO shared_revisions(id,workspace_id,kind,title,body,content,original_snapshot_id) VALUES(${id},${workspaceId},${body.kind},${body.title},${body.body},${JSON.stringify(content)}::jsonb,${snapshotId})`.execute(
        db,
      );
      await this.store.touch(workspaceId, db);
    });
    return (await this.shares(actor, workspaceId)).find(
      (item) => item.id === id,
    )!;
  }
  async shares(
    actor: Actor,
    workspaceId: string,
  ): Promise<
    (SharedRevision & { entryPoint: string | null; problem: string | null })[]
  > {
    await this.store.workspaceRow(actor, workspaceId);
    const rows = (
      await sql<{
        id: string;
        kind: SharedRevision["kind"];
        title: string;
        body: string;
        content: {
          source: string | null;
          input: string | null;
          language: "python" | "cpp";
          entryPoint: string | null;
          problem: string | null;
        };
        created_at: Date;
      }>`SELECT id,kind,title,body,content,created_at FROM shared_revisions WHERE workspace_id=${workspaceId} ORDER BY created_at DESC LIMIT 100`.execute(
        this.store.db,
      )
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      ...row.content,
      snapshotId: null,
      createdAt: row.created_at.toISOString(),
    }));
  }
  async addComment(
    actor: Actor,
    snapshotId: string,
    line: number,
    body: string,
  ) {
    const snapshot = await this.store.getSnapshot(actor, snapshotId);
    if (line > snapshot.code.split("\n").length)
      throw new ApiError(400, "The comment line is outside this snapshot");
    const source = (
      await sql<{
        workspace_id: string;
      }>`SELECT workspace_id FROM snapshots WHERE id=${snapshotId}`.execute(
        this.store.db,
      )
    ).rows[0]!;
    const id = randomUUID();
    await sql`INSERT INTO comments(id,workspace_id,snapshot_id,line,body,author) VALUES(${id},${source.workspace_id},${snapshotId},${line},${body},${actor.role === "tutor" ? "Tutor" : "Student"})`.execute(
      this.store.db,
    );
    return (await this.comments(actor, source.workspace_id)).find(
      (item) => item.id === id,
    )!;
  }
  async comments(actor: Actor, workspaceId: string) {
    await this.store.workspaceRow(actor, workspaceId);
    const rows = (
      await sql<{
        id: string;
        snapshot_id: string;
        line: number;
        body: string;
        author: string;
        created_at: Date;
        revision: number;
        current_revision: number;
        branch_id: string;
      }>`SELECT c.*,s.revision,b.revision AS current_revision,s.branch_id FROM comments c JOIN snapshots s ON s.id=c.snapshot_id JOIN branches b ON b.id=s.branch_id WHERE c.workspace_id=${workspaceId} ${actor.role === "student" ? sql`AND b.kind='student'` : sql``} ORDER BY c.created_at DESC LIMIT 200`.execute(
        this.store.db,
      )
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      line: row.line,
      body: row.body,
      author: row.author,
      createdAt: row.created_at.toISOString(),
      revision: row.revision,
      branchId: row.branch_id,
      outdated: row.revision !== row.current_revision,
    }));
  }
  async notes(actor: Actor, branchId: string) {
    await this.store.branchRow(actor, branchId);
    return (
      (
        await sql<{
          hypothesis: string;
          conclusion: string;
          revision: number;
        }>`SELECT hypothesis,conclusion,revision FROM investigation_notes WHERE branch_id=${branchId}`.execute(
          this.store.db,
        )
      ).rows[0] ?? { hypothesis: "", conclusion: "", revision: 0 }
    );
  }
  async saveNotes(
    actor: Actor,
    branchId: string,
    hypothesis: string,
    conclusion: string,
    expectedRevision: number,
  ) {
    return this.store.db.transaction().execute(async (db) => {
      const branch = await this.store.branchRow(actor, branchId, db, true);
      const current = (
        await sql<{
          revision: number;
        }>`SELECT revision FROM investigation_notes WHERE branch_id=${branchId}`.execute(
          db,
        )
      ).rows[0];
      if ((current?.revision ?? 0) !== expectedRevision)
        throw new ApiError(
          409,
          "These notes changed elsewhere. Reload before saving.",
          "revision_conflict",
        );
      await sql`INSERT INTO investigation_notes(branch_id,hypothesis,conclusion,revision) VALUES(${branchId},${hypothesis},${conclusion},1) ON CONFLICT(branch_id) DO UPDATE SET hypothesis=EXCLUDED.hypothesis,conclusion=EXCLUDED.conclusion,revision=investigation_notes.revision+1,updated_at=now()`.execute(
        db,
      );
      await this.store.touch(branch.workspace_id, db);
      return { hypothesis, conclusion, revision: expectedRevision + 1 };
    });
  }
  async testCases(actor: Actor, branchId: string) {
    await this.store.branchRow(actor, branchId);
    return (
      await sql`SELECT id,name,input,expected,created_at AS "createdAt" FROM test_cases WHERE branch_id=${branchId} ORDER BY created_at DESC LIMIT 100`.execute(
        this.store.db,
      )
    ).rows;
  }
  async addTestCase(
    actor: Actor,
    branchId: string,
    name: string,
    input: string,
    expected: string,
  ) {
    const branch = await this.store.branchRow(actor, branchId),
      id = randomUUID();
    await sql`INSERT INTO test_cases(id,workspace_id,branch_id,name,input,expected) VALUES(${id},${branch.workspace_id},${branchId},${name},${input},${expected})`.execute(
      this.store.db,
    );
    return { id, name, input, expected };
  }
  async preservedVersions(actor: Actor, workspaceId: string) {
    await this.store.workspaceRow(actor, workspaceId);
    const rows = (
      await sql<{
        id: string;
        branch_id: string;
        revision: number;
        reason: string;
        created_at: Date;
      }>`SELECT s.id,s.branch_id,s.revision,s.reason,s.created_at FROM snapshots s JOIN branches b ON b.id=s.branch_id WHERE s.workspace_id=${workspaceId} ${actor.role === "student" ? sql`AND b.kind='student'` : sql``} ORDER BY s.created_at DESC LIMIT 200`.execute(
        this.store.db,
      )
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      revision: row.revision,
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async exportWorkspace(actor: Actor, id: string) {
    const workspace = await this.store.workspace(actor, id),
      runs = await this.store.listRuns(actor, id),
      shares = await this.shares(actor, id),
      comments = await this.comments(actor, id);
    const snapshots = [];
    for (const run of runs)
      snapshots.push(await this.store.getSnapshot(actor, run.snapshotId));
    const notes = [];
    for (const branch of workspace.branches)
      notes.push({
        branchId: branch.id,
        ...(await this.notes(actor, branch.id)),
        testCases: await this.testCases(actor, branch.id),
      });
    const observations = [];
    if (this.artifacts) {
      for (const run of runs) {
        const artifact = await this.store.artifact(actor, run.id);
        if (!artifact) continue;
        const result = await this.artifacts.get(
          artifact.storage_key,
          artifact.sha256,
        );
        const { steps, ...summary } = result;
        observations.push({
          runId: run.id,
          eventCount: steps.length,
          ...summary,
          outcome: run.outcome,
          complete: run.outcome === "completed",
        });
      }
    }
    const preserved = await this.preservedVersions(actor, id);
    const known = new Set(snapshots.map((snapshot) => snapshot.id));
    for (const version of preserved)
      if (!known.has(version.id))
        snapshots.push(await this.store.getSnapshot(actor, version.id));
    return {
      observations,
      preserved,
      format: "debugroom-workspace",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace,
      runs,
      snapshots,
      shares,
      comments,
      notes,
    };
  }
  async deleteWorkspace(actor: Actor, id: string) {
    this.requireTutor(actor);
    await this.store.db.transaction().execute(async (db) => {
      await this.store.workspaceRow(actor, id, db, true);
      await sql`UPDATE workspaces SET deleted_at=now() WHERE id=${id}`.execute(
        db,
      );
      await sql`UPDATE runs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'finished' ELSE status END,outcome=CASE WHEN status='queued' THEN 'stopped' ELSE outcome END,finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END WHERE workspace_id=${id} AND status!='finished'`.execute(
        db,
      );
      await sql`UPDATE grants SET revoked_at=now() WHERE workspace_id=${id}`.execute(
        db,
      );
      await sql`DELETE FROM sessions WHERE grant_id IN (SELECT id FROM grants WHERE workspace_id=${id})`.execute(
        db,
      );
    });
    return { deleted: true };
  }
}
