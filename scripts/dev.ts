import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { startLocalPostgres } from "./local-postgres.ts";

const root = process.cwd(),
  children: ChildProcess[] = [];
let ownedDatabase: Awaited<ReturnType<typeof startLocalPostgres>> | undefined;
let pool: Pool | undefined;
try {
  const password = (
    await readFile(path.join(root, ".data/postgres-password"), "utf8")
  ).trim();
  pool = new Pool({
    connectionString: `postgresql://debugroom:${password}@127.0.0.1:55432/postgres`,
    connectionTimeoutMillis: 1000,
  });
  await pool.query("select 1");
} catch {
  ownedDatabase = await startLocalPostgres(root);
} finally {
  await pool?.end();
}
async function isUp(url: string) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}
const start = (args: string[]) => {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
  return child;
};
if (!(await isUp("http://127.0.0.1:3001/health")))
  start(["--import", "tsx", "apps/api/src/server.ts"]);
for (
  let tries = 0;
  tries < 60 && !(await isUp("http://127.0.0.1:3001/health"));
  tries++
)
  await new Promise((resolve) => setTimeout(resolve, 250));
if (!(await isUp("http://127.0.0.1:3001/health")))
  throw new Error("DebugRoom API did not start");
start(["--import", "tsx", "scripts/run-worker.ts"]);
if (!(await isUp("http://127.0.0.1:5173/")))
  start([
    "node_modules/vite/bin/vite.js",
    "--config",
    "apps/web/vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    "5173",
    "--strictPort",
    "apps/web",
  ]);
console.log("\nDebugRoom: http://127.0.0.1:5173/\n");
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGKILL");
  await ownedDatabase?.stop();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, close);
