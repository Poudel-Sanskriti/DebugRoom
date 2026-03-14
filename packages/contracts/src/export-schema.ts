import { writeFile } from "node:fs/promises";
import { ResultSchema } from "./index.ts";
await writeFile(
  new URL("../trace.schema.json", import.meta.url),
  JSON.stringify(ResultSchema, null, 2) + "\n",
);
