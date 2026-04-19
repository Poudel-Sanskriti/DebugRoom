import { sql } from "kysely";
import { Store } from "./store.ts";
import type { Artifacts } from "./artifacts.ts";
import { LocalArtifacts } from "./artifacts.ts";

async function maintainUnlocked(store: Store, artifacts: Artifacts) {
  const expired = await store.db.transaction().execute(async (db) => {
    const rows = (
      await sql<{
        id: string;
      }>`UPDATE workspaces SET deleted_at=now() WHERE deleted_at IS NULL AND expires_at<=now() RETURNING id`.execute(
        db,
      )
    ).rows;
    for (const { id } of rows) {
      await sql`UPDATE runs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'finished' ELSE status END,outcome=CASE WHEN status='queued' THEN 'stopped' ELSE outcome END,finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END WHERE workspace_id=${id} AND status!='finished'`.execute(
        db,
      );
      await sql`UPDATE grants SET revoked_at=now() WHERE workspace_id=${id}`.execute(
        db,
      );
      await sql`DELETE FROM sessions WHERE grant_id IN (SELECT id FROM grants WHERE workspace_id=${id})`.execute(
        db,
      );
    }
    await sql`DELETE FROM sessions WHERE expires_at<=now()`.execute(db);
    return rows.length;
  });
  await store.reapLeases();
  const deleted = (
    await sql<{
      id: string;
    }>`SELECT w.id FROM workspaces w WHERE w.deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM runs r WHERE r.workspace_id=w.id AND r.status='running') LIMIT 100`.execute(
      store.db,
    )
  ).rows;
  let cleaned = 0;
  for (const { id } of deleted) {
    const keys = (
      await sql<{
        storage_key: string;
      }>`SELECT storage_key FROM trace_artifacts WHERE workspace_id=${id}`.execute(
        store.db,
      )
    ).rows;
    for (const { storage_key } of keys) await artifacts.remove(storage_key);
    await sql`DELETE FROM workspaces WHERE id=${id} AND deleted_at IS NOT NULL`.execute(
      store.db,
    );
    cleaned++;
  }
  let orphans = 0;
  if (artifacts instanceof LocalArtifacts) {
    const referenced = (
      await sql<{
        storage_key: string;
      }>`SELECT storage_key FROM trace_artifacts`.execute(store.db)
    ).rows;
    orphans = await artifacts.sweep(
      new Set(referenced.map((row) => row.storage_key)),
    );
  }
  return { expired, cleaned, orphans };
}

export async function maintainWorkspaces(store: Store, artifacts: Artifacts) {
  return store.db.connection().execute(async (connection) => {
    const acquired = (
      await sql<{
        locked: boolean;
      }>`SELECT pg_try_advisory_lock(hashtextextended('debugroom:artifact-maintenance',0)) AS locked`.execute(
        connection,
      )
    ).rows[0]!.locked;
    if (!acquired) return { expired: 0, cleaned: 0, orphans: 0 };
    try {
      return await maintainUnlocked(store, artifacts);
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtextextended('debugroom:artifact-maintenance',0))`.execute(
        connection,
      );
    }
  });
}
