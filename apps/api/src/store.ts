import { randomBytes, randomUUID, createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  emptyDraft,
  type Draft,
  type Run,
  type Snapshot,
  type Branch,
  type Workspace,
  type Outcome,
  type TraceResult,
} from "@debugroom/contracts";
import type { Database } from "./database.ts";
import { ApiError, requireRow } from "./errors.ts";

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export type Actor = {
  role: "tutor" | "student";
  tutorId?: string;
  grantId?: string;
  workspaceId?: string;
  displayName: string;
  sessionId: string;
  csrf: string;
};
type Connection = Database | Transaction<Record<string, never>>;
type BranchRow = {
  id: string;
  workspace_id: string;
  kind: "student" | "mentor";
  name: string;
  revision: number;
  draft: Draft;
  updated_at: Date;
};
type WorkspaceRow = {
  id: string;
  owner_id: string;
  title: string;
  created_at: Date;
  expires_at: Date;
  deleted_at: Date | null;
};
type SnapshotRow = {
  id: string;
  branch_id: string;
  workspace_id: string;
  revision: number;
  draft: Draft;
  created_at: Date;
};
type RunRow = {
  id: string;
  workspace_id: string;
  branch_id: string;
  snapshot_id: string;
  status: Run["status"];
  outcome: Outcome | null;
  generation: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  artifact_id: string | null;
  request_hash: string;
  cancel_requested: boolean;
};
const toBranch = (b: BranchRow): Branch => ({
  id: b.id,
  kind: b.kind,
  name: b.name,
  revision: b.revision,
  draft: b.draft,
  updatedAt: b.updated_at.toISOString(),
});
const toSnapshot = (s: SnapshotRow): Snapshot => ({
  ...s.draft,
  id: s.id,
  revision: s.revision,
  createdAt: s.created_at.toISOString(),
});
const toRun = (r: RunRow): Run => ({
  id: r.id,
  workspaceId: r.workspace_id,
  branchId: r.branch_id,
  snapshotId: r.snapshot_id,
  status: r.status,
  outcome: r.outcome,
  attempt: r.generation,
  createdAt: r.created_at.toISOString(),
  startedAt: r.started_at?.toISOString() ?? null,
  finishedAt: r.finished_at?.toISOString() ?? null,
});
const actorKey = (a: Actor) =>
  a.role === "tutor" ? `tutor:${a.tutorId}` : `student:${a.grantId}`;
const json = (value: unknown) => JSON.stringify(value);

export class Store {
  constructor(public db: Database) {}

  async tutor(subject: string, displayName: string) {
    const row = (
      await sql<{
        id: string;
      }>`INSERT INTO tutors(id, provider_subject, display_name) VALUES (${randomUUID()}, ${subject}, ${displayName}) ON CONFLICT(provider_subject) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`.execute(
        this.db,
      )
    ).rows[0]!;
    return row.id;
  }

  async createSession(tutorId: string | null, grantId: string | null) {
    const secret = token(),
      csrf = token(),
      id = randomUUID();
    await sql`INSERT INTO sessions(id, token_hash, csrf, tutor_id, grant_id) VALUES (${id},${hash(secret)},${csrf},${tutorId},${grantId})`.execute(
      this.db,
    );
    return { secret, csrf, id };
  }

  async session(secret: string): Promise<Actor | null> {
    if (!secret || secret.length > 200) return null;
    const row = (
      await sql<{
        id: string;
        csrf: string;
        tutor_id: string | null;
        grant_id: string | null;
        workspace_id: string | null;
        display_name: string | null;
      }>`
      SELECT s.id,s.csrf,s.tutor_id,s.grant_id,g.workspace_id,t.display_name
      FROM sessions s LEFT JOIN tutors t ON t.id=s.tutor_id LEFT JOIN grants g ON g.id=s.grant_id
      LEFT JOIN invitations i ON i.id=g.invitation_id LEFT JOIN workspaces w ON w.id=g.workspace_id
      WHERE s.token_hash=${hash(secret)} AND s.expires_at > now()
      AND (s.tutor_id IS NOT NULL OR (g.revoked_at IS NULL AND i.revoked_at IS NULL AND w.deleted_at IS NULL AND w.expires_at>now()))
    `.execute(this.db)
    ).rows[0];
    if (!row) return null;
    return {
      role: row.tutor_id ? "tutor" : "student",
      tutorId: row.tutor_id ?? undefined,
      grantId: row.grant_id ?? undefined,
      workspaceId: row.workspace_id ?? undefined,
      sessionId: row.id,
      csrf: row.csrf,
      displayName: row.display_name ?? "Student",
    };
  }

  async logout(actor: Actor) {
    await sql`DELETE FROM sessions WHERE id=${actor.sessionId}`.execute(
      this.db,
    );
  }

  async workspaceRow(
    actor: Actor,
    id: string,
    db: Connection = this.db,
    lock = false,
  ) {
    const authority =
      actor.role === "tutor"
        ? sql`w.owner_id=${actor.tutorId}`
        : sql`w.id=${actor.workspaceId}`;
    const row = (
      await sql<WorkspaceRow>`SELECT w.* FROM workspaces w WHERE w.id=${id} AND ${authority} AND w.deleted_at IS NULL AND w.expires_at > now() ${lock ? sql`FOR UPDATE` : sql``}`.execute(
        db,
      )
    ).rows[0];
    return requireRow(row, "Workspace not found");
  }

  async branchRow(
    actor: Actor,
    id: string,
    db: Connection = this.db,
    lock = false,
  ) {
    const branch = requireRow(
      (
        await sql<BranchRow>`SELECT * FROM branches WHERE id=${id} ${lock ? sql`FOR UPDATE` : sql``}`.execute(
          db,
        )
      ).rows[0],
      "Branch not found",
    );
    await this.workspaceRow(actor, branch.workspace_id, db);
    if (actor.role === "student" && branch.kind !== "student")
      throw new ApiError(404, "Branch not found");
    return branch;
  }

  async touch(workspaceId: string, db: Connection) {
    await sql`UPDATE workspaces SET updated_at=now(), expires_at=now()+interval '30 days' WHERE id=${workspaceId}`.execute(
      db,
    );
  }

  async listWorkspaces(actor: Actor) {
    const condition =
      actor.role === "tutor"
        ? sql`owner_id=${actor.tutorId}`
        : sql`id=${actor.workspaceId}`;
    const rows = (
      await sql<WorkspaceRow>`SELECT * FROM workspaces WHERE ${condition} AND deleted_at IS NULL AND expires_at>now() ORDER BY updated_at DESC LIMIT 100`.execute(
        this.db,
      )
    ).rows;
    return Promise.all(rows.map((row) => this.workspace(actor, row.id)));
  }

  async workspace(actor: Actor, id: string): Promise<Workspace> {
    const row = await this.workspaceRow(actor, id);
    const branches = (
      await sql<BranchRow>`SELECT * FROM branches WHERE workspace_id=${id} ${actor.role === "student" ? sql`AND kind='student'` : sql``} ORDER BY kind DESC`.execute(
        this.db,
      )
    ).rows;
    const invitation =
      (
        await sql`SELECT id FROM invitations WHERE workspace_id=${id} AND revoked_at IS NULL AND expires_at>now() LIMIT 1`.execute(
          this.db,
        )
      ).rows.length > 0;
    return {
      id: row.id,
      title: row.title,
      role: actor.role,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      branches: branches.map(toBranch),
      studentRevision:
        branches.find((b) => b.kind === "student")?.revision ?? 0,
      invitationActive: invitation,
    };
  }

  async createWorkspace(actor: Actor, title: string) {
    if (actor.role !== "tutor")
      throw new ApiError(403, "Only tutors can create workspaces");
    const id = randomUUID();
    await this.db.transaction().execute(async (db) => {
      await sql`INSERT INTO workspaces(id,owner_id,title) VALUES (${id},${actor.tutorId},${title.trim() || "Untitled workspace"})`.execute(
        db,
      );
      await sql`INSERT INTO branches(id,workspace_id,kind,name,draft) VALUES (${randomUUID()},${id},'student','Workspace',${json(emptyDraft)}::jsonb)`.execute(
        db,
      );
    });
    return this.workspace(actor, id);
  }

  async renameWorkspace(actor: Actor, id: string, title: string) {
    await this.workspaceRow(actor, id);
    if (actor.role !== "tutor")
      throw new ApiError(403, "Only tutors can rename workspaces");
    await sql`UPDATE workspaces SET title=${title.trim() || "Untitled workspace"}, updated_at=now() WHERE id=${id}`.execute(
      this.db,
    );
    return this.workspace(actor, id);
  }

  async snapshot(
    branch: BranchRow,
    draft: Draft,
    reason: string,
    db: Connection,
  ) {
    const id = randomUUID();
    await sql`INSERT INTO snapshots(id,workspace_id,branch_id,revision,draft,content_hash,reason) VALUES (${id},${branch.workspace_id},${branch.id},${branch.revision},${json(draft)}::jsonb,${hash(json(draft))},${reason})`.execute(
      db,
    );
    return id;
  }

  async saveDraft(
    actor: Actor,
    branchId: string,
    expectedRevision: number,
    draft: Draft,
    confirmed = false,
  ): Promise<Branch> {
    return this.db.transaction().execute(async (db) => {
      const branch = await this.branchRow(actor, branchId, db, true);
      if (branch.revision !== expectedRevision)
        throw new ApiError(
          409,
          "This draft changed elsewhere. Reload it before saving.",
          "revision_conflict",
        );
      const invited =
        (
          await sql`SELECT id FROM grants WHERE workspace_id=${branch.workspace_id} AND revoked_at IS NULL LIMIT 1`.execute(
            db,
          )
        ).rows.length > 0;
      if (actor.role === "tutor" && branch.kind === "student" && invited) {
        if (!confirmed)
          throw new ApiError(
            409,
            "Confirm direct editing of the student copy first.",
            "confirmation_required",
          );
        await this.snapshot(branch, branch.draft, "before_tutor_edit", db);
      }
      const updated = (
        await sql<BranchRow>`UPDATE branches SET draft=${json(draft)}::jsonb, revision=revision+1, updated_at=now() WHERE id=${branchId} RETURNING *`.execute(
          db,
        )
      ).rows[0]!;
      await this.touch(branch.workspace_id, db);
      return toBranch(updated);
    });
  }

  async getSnapshot(actor: Actor, id: string) {
    const row = requireRow(
      (
        await sql<SnapshotRow>`SELECT * FROM snapshots WHERE id=${id}`.execute(
          this.db,
        )
      ).rows[0],
      "Snapshot not found",
    );
    await this.branchRow(actor, row.branch_id);
    return toSnapshot(row);
  }

  async createRun(
    actor: Actor,
    branchId: string,
    draft: Draft,
    expectedRevision: number,
    key: string,
  ) {
    const requestHash = hash(json({ branchId, draft, expectedRevision }));
    const runId = await this.db.transaction().execute(async (db) => {
      // Lock this actor's idempotency key independently of which workspace it targets.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${actorKey(actor) + ":" + key},0))`.execute(
        db,
      );
      const existing = (
        await sql<RunRow>`SELECT * FROM runs WHERE actor=${actorKey(actor)} AND idempotency_key=${key}`.execute(
          db,
        )
      ).rows[0];
      if (existing) {
        if (existing.request_hash !== requestHash)
          throw new ApiError(
            409,
            "Idempotency key was already used for different input",
            "idempotency_conflict",
          );
        await this.branchRow(actor, existing.branch_id, db);
        return existing.id;
      }
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('debugroom:run-admission',0))`.execute(
        db,
      );
      const branch = await this.branchRow(actor, branchId, db, true);
      await this.workspaceRow(actor, branch.workspace_id, db, true);
      if (branch.revision !== expectedRevision)
        throw new ApiError(
          409,
          "Save or reload the latest draft before running",
          "revision_conflict",
        );
      const pending = (
        await sql<{
          count: string;
        }>`SELECT count(*) FROM runs WHERE workspace_id=${branch.workspace_id} AND status!='finished'`.execute(
          db,
        )
      ).rows[0]!;
      if (Number(pending.count) >= 5)
        throw new ApiError(
          429,
          "This workspace already has five pending runs",
          "queue_full",
        );
      const global = (
        await sql<{
          count: string;
        }>`SELECT count(*) FROM runs WHERE status!='finished'`.execute(db)
      ).rows[0]!;
      if (Number(global.count) >= 128)
        throw new ApiError(
          429,
          "The execution queue is full. Try again shortly.",
          "queue_full",
        );
      const snapshotId = await this.snapshot(branch, draft, "run", db),
        id = randomUUID();
      await sql`INSERT INTO runs(id,workspace_id,branch_id,snapshot_id,actor,idempotency_key,request_hash) VALUES (${id},${branch.workspace_id},${branchId},${snapshotId},${actorKey(actor)},${key},${requestHash})`.execute(
        db,
      );
      await this.touch(branch.workspace_id, db);
      return id;
    });
    return this.getRun(actor, runId);
  }

  async listRuns(actor: Actor, workspaceId: string) {
    await this.workspaceRow(actor, workspaceId);
    return (
      await sql<RunRow>`SELECT r.* FROM runs r JOIN branches b ON b.id=r.branch_id WHERE r.workspace_id=${workspaceId} ${actor.role === "student" ? sql`AND b.kind='student'` : sql``} ORDER BY r.created_at DESC LIMIT 100`.execute(
        this.db,
      )
    ).rows.map(toRun);
  }

  async getRun(actor: Actor, id: string) {
    const row = requireRow(
      (await sql<RunRow>`SELECT * FROM runs WHERE id=${id}`.execute(this.db))
        .rows[0],
      "Run not found",
    );
    await this.branchRow(actor, row.branch_id);
    const snapshot = await this.getSnapshot(actor, row.snapshot_id);
    return { ...toRun(row), snapshot };
  }

  async artifact(actor: Actor, runId: string) {
    await this.getRun(actor, runId);
    return (
      (
        await sql<{
          storage_key: string;
          sha256: string;
          bytes: number;
        }>`SELECT a.storage_key,a.sha256,a.bytes FROM trace_artifacts a JOIN runs r ON r.artifact_id=a.id WHERE r.id=${runId}`.execute(
          this.db,
        )
      ).rows[0] ?? null
    );
  }

  async cancelRun(actor: Actor, id: string) {
    await this.getRun(actor, id);
    await sql`UPDATE runs SET cancel_requested=true, status=CASE WHEN status='queued' THEN 'finished' ELSE status END, outcome=CASE WHEN status='queued' THEN 'stopped' ELSE outcome END, finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END WHERE id=${id} AND status!='finished'`.execute(
      this.db,
    );
    return this.getRun(actor, id);
  }

  async claim(workerId: string, runtime: string, languages: string[]) {
    return this.db.transaction().execute(async (db) => {
      await sql`INSERT INTO worker_heartbeats(id,runtime,capabilities) VALUES(${workerId},${runtime},${json(languages)}::jsonb) ON CONFLICT(id) DO UPDATE SET seen_at=now(),runtime=EXCLUDED.runtime,capabilities=EXCLUDED.capabilities`.execute(
        db,
      );
      const run = (
        await sql<RunRow & { draft: Draft }>`
        SELECT r.*,s.draft FROM runs r JOIN snapshots s ON s.id=r.snapshot_id JOIN workspaces w ON w.id=r.workspace_id
        WHERE r.status='queued' AND NOT r.cancel_requested AND w.deleted_at IS NULL AND w.expires_at>now()
        AND s.draft->>'language' IN (${sql.join(languages)})
        AND NOT EXISTS(SELECT 1 FROM runs busy WHERE busy.workspace_id=r.workspace_id AND busy.status='running')
        ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1
      `.execute(db)
      ).rows[0];
      if (!run) return null;
      // Serialise workspace admission across different workers claiming sibling jobs.
      const workspaceLock = (
        await sql`SELECT id FROM workspaces WHERE id=${run.workspace_id} FOR UPDATE SKIP LOCKED`.execute(
          db,
        )
      ).rows;
      if (!workspaceLock.length) return null;
      const busy = (
        await sql`SELECT id FROM runs WHERE workspace_id=${run.workspace_id} AND status='running' LIMIT 1`.execute(
          db,
        )
      ).rows;
      if (busy.length) return null;
      const attemptId = randomUUID(),
        leaseToken = token(),
        generation = run.generation + 1;
      await sql`UPDATE runs SET status='running', generation=${generation}, started_at=NULL WHERE id=${run.id}`.execute(
        db,
      );
      await sql`INSERT INTO run_attempts(id,run_id,generation,worker_id,token_hash,lease_until,runtime) VALUES(${attemptId},${run.id},${generation},${workerId},${hash(leaseToken)},now()+interval '15 seconds',${runtime})`.execute(
        db,
      );
      return {
        runId: run.id,
        attemptId,
        generation,
        leaseToken,
        snapshot: run.draft,
      };
    });
  }

  async heartbeat(attemptId: string, leaseToken: string, started: boolean) {
    return this.db.transaction().execute(async (db) => {
      const attempt = (
        await sql<{
          run_id: string;
          generation: number;
          cancel_requested: boolean;
          deleted_at: Date | null;
          expired: boolean;
        }>`
        SELECT a.run_id,a.generation,r.cancel_requested,w.deleted_at,w.expires_at<=now() AS expired FROM run_attempts a
        JOIN runs r ON r.id=a.run_id JOIN workspaces w ON w.id=r.workspace_id
        WHERE a.id=${attemptId} AND a.token_hash=${hash(leaseToken)} AND a.lease_until>now() AND a.finished_at IS NULL
        AND r.status='running' AND r.generation=a.generation FOR UPDATE OF a,r
      `.execute(db)
      ).rows[0];
      if (!attempt) return { active: false, cancel: true };
      await sql`UPDATE run_attempts SET lease_until=now()+interval '15 seconds',started_at=CASE WHEN ${started} THEN coalesce(started_at,now()) ELSE started_at END WHERE id=${attemptId}`.execute(
        db,
      );
      if (started)
        await sql`UPDATE runs SET started_at=coalesce(started_at,now()) WHERE id=${attempt.run_id}`.execute(
          db,
        );
      return {
        active: true,
        cancel:
          attempt.cancel_requested || !!attempt.deleted_at || attempt.expired,
      };
    });
  }

  async complete(
    attemptId: string,
    leaseToken: string,
    result: TraceResult,
    artifact: { key: string; sha256: string; bytes: number },
    metrics: Record<string, number>,
  ) {
    return this.db.transaction().execute(async (db) => {
      const attempt = (
        await sql<{
          run_id: string;
          workspace_id: string;
          cancel_requested: boolean;
        }>`
        SELECT a.run_id,r.workspace_id,r.cancel_requested FROM run_attempts a JOIN runs r ON r.id=a.run_id JOIN workspaces w ON w.id=r.workspace_id
        WHERE a.id=${attemptId} AND a.token_hash=${hash(leaseToken)} AND a.lease_until>now() AND a.finished_at IS NULL
        AND r.status='running' AND r.generation=a.generation AND w.deleted_at IS NULL AND w.expires_at>now() FOR UPDATE OF a,r
      `.execute(db)
      ).rows[0];
      if (!attempt)
        throw new ApiError(
          409,
          "Attempt is no longer current",
          "stale_attempt",
        );
      const outcome = attempt.cancel_requested ? "stopped" : result.outcome;
      const artifactId = randomUUID();
      await sql`INSERT INTO trace_artifacts(id,workspace_id,run_id,attempt_id,storage_key,sha256,bytes) VALUES(${artifactId},${attempt.workspace_id},${attempt.run_id},${attemptId},${artifact.key},${artifact.sha256},${artifact.bytes})`.execute(
        db,
      );
      await sql`UPDATE run_attempts SET finished_at=now(),outcome=${outcome},metrics=${json(metrics)}::jsonb WHERE id=${attemptId}`.execute(
        db,
      );
      await sql`UPDATE runs SET status='finished',outcome=${outcome},finished_at=now(),artifact_id=${artifactId} WHERE id=${attempt.run_id}`.execute(
        db,
      );
      return { accepted: true, outcome };
    });
  }

  async reapLeases() {
    return this.db.transaction().execute(async (db) => {
      const expired = (
        await sql<{
          id: string;
          run_id: string;
          generation: number;
          cancel_requested: boolean;
        }>`
        SELECT a.id,a.run_id,a.generation,r.cancel_requested FROM run_attempts a JOIN runs r ON r.id=a.run_id
        WHERE a.finished_at IS NULL AND a.lease_until<=now() AND r.status='running' AND r.generation=a.generation FOR UPDATE OF a,r SKIP LOCKED
      `.execute(db)
      ).rows;
      for (const a of expired) {
        await sql`UPDATE run_attempts SET finished_at=now(),outcome='infrastructure_error' WHERE id=${a.id}`.execute(
          db,
        );
        const retry = !a.cancel_requested && a.generation < 2;
        await sql`UPDATE runs SET status=${retry ? "queued" : "finished"},outcome=${retry ? null : a.cancel_requested ? "stopped" : "infrastructure_error"},finished_at=${retry ? sql`NULL` : sql`now()`},started_at=NULL WHERE id=${a.run_id}`.execute(
          db,
        );
      }
      return expired.length;
    });
  }

  async attempts(actor: Actor, runId: string) {
    await this.getRun(actor, runId);
    return (
      await sql`SELECT generation,claimed_at,started_at,finished_at,outcome,runtime,metrics FROM run_attempts WHERE run_id=${runId} ORDER BY generation`.execute(
        this.db,
      )
    ).rows;
  }
}
