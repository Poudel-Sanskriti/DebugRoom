import { connectDatabase, migrate } from "./database.ts";
import { Store } from "./store.ts";
import { LocalArtifacts, S3Artifacts } from "./artifacts.ts";
import { S3Client } from "@aws-sdk/client-s3";
import { buildApp } from "./app.ts";
import { maintainWorkspaces } from "./lifecycle.ts";
import { loadConfig } from "./config.ts";
import path from "node:path";

const config = await loadConfig();
const db = connectDatabase(config.databaseUrl);
await migrate(db);
const store = new Store(db);
const artifacts = process.env.TRACE_BUCKET
  ? new S3Artifacts(new S3Client({}), process.env.TRACE_BUCKET)
  : new LocalArtifacts(path.join(config.root, ".data/artifacts"));
const app = await buildApp(store, artifacts, config);
const reaper = setInterval(
  () =>
    store
      .reapLeases()
      .catch((error) => app.log.error({ err: error }, "lease recovery failed")),
  5000,
);
reaper.unref();
const janitor = setInterval(
  () =>
    maintainWorkspaces(store, artifacts)
      .then((result) => {
        if (result.expired || result.cleaned || result.orphans)
          app.log.info(result, "workspace cleanup completed");
      })
      .catch((error) =>
        app.log.error({ err: error }, "workspace cleanup failed"),
      ),
  60_000,
);
janitor.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    clearInterval(reaper);
    clearInterval(janitor);
    await app.close();
    await db.destroy();
    process.exit(0);
  });
await app.listen({ port: config.port, host: config.host });
