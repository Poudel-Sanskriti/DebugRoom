import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./app.ts";

export const root = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);
export async function loadConfig(): Promise<
  AppConfig & { databaseUrl: string; port: number; host: string }
> {
  try {
    await access(path.join(root, ".env"));
    process.loadEnvFile(path.join(root, ".env"));
  } catch {}
  const production = process.env.NODE_ENV === "production";
  const directory = path.join(root, ".data");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let runnerToken = process.env.DEBUGROOM_RUNNER_TOKEN;
  if (!runnerToken && !production) {
    const secretPath = path.join(directory, "runner-token");
    try {
      runnerToken = (await readFile(secretPath, "utf8")).trim();
    } catch {
      runnerToken = randomBytes(32).toString("base64url");
      await writeFile(secretPath, runnerToken, { flag: "wx", mode: 0o600 });
    }
  }
  if (!runnerToken || runnerToken.length < 32)
    throw new Error("Set a DEBUGROOM_RUNNER_TOKEN of at least 32 characters");
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl && !production) {
    const password = (
      await readFile(path.join(directory, "postgres-password"), "utf8")
    ).trim();
    databaseUrl = `postgresql://debugroom:${password}@127.0.0.1:55432/postgres`;
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const origin = process.env.DEBUGROOM_ORIGIN ?? "http://127.0.0.1:5173";
  const executionMode = process.env.DEBUGROOM_EXECUTION_MODE ?? "docker";
  if (executionMode !== "docker" && executionMode !== "local-inspected")
    throw new Error("Invalid execution mode");
  if (
    production &&
    (executionMode !== "docker" || !origin.startsWith("https://"))
  )
    throw new Error("Hosted mode requires HTTPS and isolated Docker execution");
  const github =
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          id: process.env.GITHUB_CLIENT_ID,
          secret: process.env.GITHUB_CLIENT_SECRET,
        }
      : undefined;
  if (production && !github)
    throw new Error(
      "Hosted tutor sign-in requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET",
    );
  return {
    root,
    origin,
    localAuth: !production,
    runnerToken,
    databaseUrl,
    port: Number(process.env.PORT ?? 3001),
    host: production ? "0.0.0.0" : "127.0.0.1",
    executionMode,
    python: process.env.PYTHON_BIN ?? "python3",
    github,
    logger: true,
    serveStatic: production,
  };
}
