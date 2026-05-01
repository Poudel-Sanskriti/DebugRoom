import { loadConfig } from "../apps/api/src/config.ts";
import { connectDatabase, migrate } from "../apps/api/src/database.ts";
const config = await loadConfig(),
  db = connectDatabase(config.databaseUrl);
try {
  await migrate(db);
  console.log("Database migrations are current.");
} finally {
  await db.destroy();
}
