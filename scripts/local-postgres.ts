import EmbeddedPostgres from "embedded-postgres";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

export async function startLocalPostgres(root = process.cwd(), port = 55432) {
  const directory = path.join(root, ".data");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secretPath = path.join(directory, "postgres-password");
  let password: string;
  try {
    password = (await readFile(secretPath, "utf8")).trim();
  } catch {
    password = randomBytes(32).toString("hex");
    await writeFile(secretPath, password, { mode: 0o600, flag: "wx" });
  }
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(directory, "postgres"),
    user: "debugroom",
    password,
    port,
    persistent: true,
    authMethod: "scram-sha-256",
    postgresFlags: [
      "-h",
      "127.0.0.1",
      "-k",
      directory,
      "-c",
      "max_connections=60",
    ],
    onLog: () => {},
    onError: (message) => {
      if (String(message).includes("FATAL")) console.error(String(message));
    },
  });
  try {
    await access(path.join(directory, "postgres", "PG_VERSION"));
  } catch {
    await pg.initialise();
  }
  await pg.start();
  return {
    url: `postgresql://debugroom:${password}@127.0.0.1:${port}/postgres`,
    stop: () => pg.stop(),
  };
}

if (process.argv[1]?.endsWith("local-postgres.ts")) {
  const pg = await startLocalPostgres(process.cwd());
  console.log(
    "Local PostgreSQL is listening on 127.0.0.1:55432. Data lives in .data/postgres.",
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, async () => {
      await pg.stop();
      process.exit(0);
    });
}
