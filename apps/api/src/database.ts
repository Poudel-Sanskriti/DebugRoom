import { Kysely, PostgresDialect, sql } from "kysely";
import { Migrator } from "kysely/migration";
import { Pool } from "pg";

export type Database = Kysely<Record<string, never>>;
export function connectDatabase(
  connectionString: string,
  schema?: string,
): Database {
  if (schema && !/^debugroom_test_[a-z0-9]+$/.test(schema))
    throw new Error("Invalid test schema");
  return new Kysely({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: 12,
        ...(schema ? { options: `-c search_path=${schema}` } : {}),
      }),
    }),
  });
}

export async function migrate(db: Database) {
  const migrator = new Migrator({
    db,
    provider: {
      getMigrations: async () => ({
        "0001_initial": {
          up: async (connection: Database) => {
            await sql`
      CREATE TABLE tutors (
        id uuid PRIMARY KEY, provider_subject text UNIQUE NOT NULL, display_name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE workspaces (
        id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES tutors(id), title text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days', deleted_at timestamptz
      );
      CREATE INDEX workspaces_owner ON workspaces(owner_id);
      CREATE TABLE branches (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('student','mentor')), name text NOT NULL,
        revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0), draft jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id, kind)
      );
      CREATE TABLE snapshots (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE, revision integer NOT NULL,
        draft jsonb NOT NULL, content_hash text NOT NULL, reason text NOT NULL DEFAULT 'run',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE FUNCTION prevent_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Run snapshots are immutable'; END;
      $$;
      CREATE TRIGGER snapshots_immutable BEFORE UPDATE ON snapshots FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_update();
      CREATE TABLE invitations (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        token_hash text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days', redeemed_at timestamptz, revoked_at timestamptz
      );
      CREATE TABLE grants (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE, revoked_at timestamptz
      );
      CREATE TABLE sessions (
        id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, csrf text NOT NULL,
        tutor_id uuid REFERENCES tutors(id) ON DELETE CASCADE, grant_id uuid REFERENCES grants(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
        CHECK ((tutor_id IS NULL) <> (grant_id IS NULL))
      );
      CREATE TABLE runs (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        actor text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
        status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','finished')),
        outcome text, generation integer NOT NULL DEFAULT 0, cancel_requested boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
        artifact_id uuid, UNIQUE(actor, idempotency_key)
      );
      CREATE INDEX runs_queue ON runs(created_at) WHERE status = 'queued';
      CREATE INDEX runs_workspace ON runs(workspace_id, created_at DESC);
      CREATE TABLE run_attempts (
        id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        generation integer NOT NULL, worker_id text NOT NULL, token_hash text NOT NULL,
        lease_until timestamptz NOT NULL, claimed_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz, finished_at timestamptz, outcome text,
        runtime text NOT NULL, metrics jsonb NOT NULL DEFAULT '{}', UNIQUE(run_id, generation)
      );
      CREATE INDEX attempts_lease ON run_attempts(lease_until) WHERE finished_at IS NULL;
      CREATE TABLE trace_artifacts (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        attempt_id uuid NOT NULL REFERENCES run_attempts(id) ON DELETE CASCADE,
        storage_key text UNIQUE NOT NULL, sha256 text NOT NULL, bytes integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE runs ADD CONSTRAINT run_artifact FOREIGN KEY(artifact_id) REFERENCES trace_artifacts(id) ON DELETE SET NULL;
      CREATE TABLE comments (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        line integer NOT NULL CHECK(line >= 1), body text NOT NULL, author text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE shared_revisions (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK(kind IN ('full','selection','hint')), title text NOT NULL, body text NOT NULL,
        content jsonb NOT NULL, original_snapshot_id uuid REFERENCES snapshots(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE test_cases (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE, name text NOT NULL,
        input text NOT NULL, expected text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE investigation_notes (
        branch_id uuid PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
        hypothesis text NOT NULL DEFAULT '', conclusion text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE worker_heartbeats (
        id text PRIMARY KEY, seen_at timestamptz NOT NULL DEFAULT now(), runtime text NOT NULL,
        capabilities jsonb NOT NULL
      );
    `.execute(connection);
          },
        },
      }),
    },
  });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
}
