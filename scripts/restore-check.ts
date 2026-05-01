import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "kysely";
import { connectDatabase } from "../apps/api/src/database.ts";
import { loadConfig } from "../apps/api/src/config.ts";
import { createBackup, runPgTool } from "./backup.ts";

const config = await loadConfig(),
  source = new URL(config.databaseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(source.hostname))
  throw new Error(
    "This automatic restore exercise is restricted to the local development database",
  );
const backup = await createBackup();
const databaseName =
  "debugroom_restore_test_" + randomUUID().replaceAll("-", "");
const admin = connectDatabase(config.databaseUrl);
let restored: ReturnType<typeof connectDatabase> | undefined;
try {
  await sql`CREATE DATABASE ${sql.id(databaseName)}`.execute(admin);
  const restoredUrl = new URL(config.databaseUrl);
  restoredUrl.pathname = "/" + databaseName;
  await runPgTool(
    "pg_restore",
    [
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      "--dbname",
      databaseName,
      path.join(backup, "database.dump"),
    ],
    restoredUrl.toString(),
  );
  restored = connectDatabase(restoredUrl.toString());
  const manifest = JSON.parse(
    await readFile(path.join(backup, "manifest.json"), "utf8"),
  );
  const artifacts = (
    await sql<{
      storage_key: string;
      sha256: string;
    }>`SELECT storage_key,sha256 FROM trace_artifacts`.execute(restored)
  ).rows;
  for (const artifact of artifacts) {
    const entry = manifest.artifacts.find(
      (a: any) => a.storage_key === artifact.storage_key,
    );
    if (!entry)
      throw new Error(
        "Restored database references an artifact absent from the backup manifest",
      );
    const content = await readFile(
      path.join(backup, "artifacts", artifact.storage_key),
    );
    if (createHash("sha256").update(content).digest("hex") !== artifact.sha256)
      throw new Error("Restored artifact checksum mismatch");
  }
  const counts = (
    await sql<{
      workspaces: string;
      snapshots: string;
      runs: string;
    }>`SELECT (SELECT count(*) FROM workspaces) AS workspaces,(SELECT count(*) FROM snapshots) AS snapshots,(SELECT count(*) FROM runs) AS runs`.execute(
      restored,
    )
  ).rows[0]!;
  const report = {
    status: "passed",
    checkedAt: new Date().toISOString(),
    backup,
    restoredArtifacts: artifacts.length,
    counts,
  };
  await writeFile(
    path.join(config.root, ".data/restore-evidence.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} finally {
  await restored?.destroy();
  await sql`DROP DATABASE IF EXISTS ${sql.id(databaseName)}`.execute(admin);
  await admin.destroy();
}
