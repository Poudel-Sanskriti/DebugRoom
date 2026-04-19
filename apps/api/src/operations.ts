import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { Store } from "./store.ts";
import { ApiError } from "./errors.ts";

export function registerOperations(app: FastifyInstance, store: Store) {
  app.get("/health/ready", async (request, reply) => {
    try {
      await sql`SELECT 1`.execute(store.db);
      const workers = (
        await sql<{
          count: string;
        }>`SELECT count(*) FROM worker_heartbeats WHERE seen_at>now()-interval '15 seconds'`.execute(
          store.db,
        )
      ).rows[0]!;
      const ready = Number(workers.count) > 0;
      reply.code(ready ? 200 : 503);
      return { database: "ready", execution: ready ? "ready" : "unavailable" };
    } catch {
      reply.code(503);
      return { database: "unavailable", execution: "unknown" };
    }
  });
  app.get("/api/operations", async (request) => {
    const actor = request.actor;
    if (!actor || actor.role !== "tutor")
      throw new ApiError(403, "Tutor access is required");
    const counts = (
      await sql<{
        queued: string;
        running: string;
        finished: string;
        oldest_queue_seconds: string | null;
      }>`SELECT count(*) FILTER(WHERE r.status='queued') AS queued,count(*) FILTER(WHERE r.status='running') AS running,count(*) FILTER(WHERE r.status='finished') AS finished,extract(epoch from now()-min(r.created_at) FILTER(WHERE r.status='queued')) AS oldest_queue_seconds FROM runs r JOIN workspaces w ON w.id=r.workspace_id WHERE w.owner_id=${actor.tutorId} AND w.deleted_at IS NULL`.execute(
        store.db,
      )
    ).rows[0]!;
    const workers = (
      await sql<{
        count: string;
      }>`SELECT count(*) FROM worker_heartbeats WHERE seen_at>now()-interval '15 seconds'`.execute(
        store.db,
      )
    ).rows[0]!;
    const outcomes = (
      await sql<{
        outcome: string;
        count: string;
      }>`SELECT r.outcome,count(*) FROM runs r JOIN workspaces w ON w.id=r.workspace_id WHERE w.owner_id=${actor.tutorId} AND r.status='finished' GROUP BY r.outcome`.execute(
        store.db,
      )
    ).rows;
    return {
      queued: Number(counts.queued),
      running: Number(counts.running),
      finished: Number(counts.finished),
      oldestQueueSeconds: Number(counts.oldest_queue_seconds ?? 0),
      availableWorkers: Number(workers.count),
      outcomes: outcomes.map((row) => ({
        outcome: row.outcome,
        count: Number(row.count),
      })),
    };
  });
}
