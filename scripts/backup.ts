import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadConfig } from "../apps/api/src/config.ts";
import { connectDatabase } from "../apps/api/src/database.ts";
import { sql } from "kysely";

export async function pgTool(name: string) {
  const candidates = [
    process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : "",
    `/opt/homebrew/opt/libpq/bin/${name}`,
    `/usr/bin/${name}`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return name;
}
export async function runPgTool(
  name: string,
  args: string[],
  connectionString: string,
) {
  const url = new URL(connectionString),
    command = await pgTool(name);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        PATH: process.env.PATH,
        LANG: "C",
        PGHOST: url.hostname,
        PGPORT: url.port || "5432",
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: url.pathname.slice(1),
        PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorText = "";
    child.stderr.on("data", (chunk) => {
      if (errorText.length < 8192) errorText += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${name} failed: ${errorText}`)),
    );
  });
}
export async function createBackup() {
  const config = await loadConfig(),
    stamp = new Date().toISOString().replaceAll(":", "-");
  const destination = path.join(config.root, ".data/backups", stamp);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const db = connectDatabase(config.databaseUrl);
  try {
    await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .execute(async (transaction) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended('debugroom:artifact-maintenance',0))`.execute(
          transaction,
        );
        const snapshot = (
          await sql<{
            snapshot: string;
          }>`SELECT pg_export_snapshot() AS snapshot`.execute(transaction)
        ).rows[0]!.snapshot;
        await runPgTool(
          "pg_dump",
          [
            "--format=custom",
            "--no-owner",
            "--no-acl",
            "--snapshot",
            snapshot,
            "--file",
            path.join(destination, "database.dump"),
          ],
          config.databaseUrl,
        );
        const artifacts = (
          await sql<{
            storage_key: string;
            sha256: string;
            bytes: number;
          }>`SELECT storage_key,sha256,bytes FROM trace_artifacts ORDER BY storage_key`.execute(
            transaction,
          )
        ).rows;
        const copied = [];
        if (process.env.TRACE_BUCKET) {
          copied.push(
            ...artifacts.map((artifact) => ({
              ...artifact,
              storage: "s3",
              bucket: process.env.TRACE_BUCKET,
            })),
          );
        } else {
          for (const artifact of artifacts) {
            const source = path.join(
                config.root,
                ".data/artifacts",
                artifact.storage_key,
              ),
              target = path.join(
                destination,
                "artifacts",
                artifact.storage_key,
              );
            const content = await readFile(source);
            if (
              createHash("sha256").update(content).digest("hex") !==
              artifact.sha256
            )
              throw new Error(
                "An artifact checksum did not match during backup",
              );
            await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
            await copyFile(source, target);
            copied.push({ ...artifact, storage: "local" });
          }
        }
        await writeFile(
          path.join(destination, "manifest.json"),
          JSON.stringify(
            {
              format: "debugroom-backup",
              version: 1,
              createdAt: new Date().toISOString(),
              artifacts: copied,
            },
            null,
            2,
          ) + "\n",
          { mode: 0o600 },
        );
      });
    return destination;
  } finally {
    await db.destroy();
  }
}
if (process.argv[1]?.endsWith("/backup.ts")) console.log(await createBackup());
