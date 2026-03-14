import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { ResultSchema } from "./index.ts";

const validator = TypeCompiler.Compile(ResultSchema);
test("the real Python collector satisfies the shared trace schema", () => {
  const program =
    "def example(xs):\n    xs.append(xs)\n    return 9007199254740993\n";
  const process = spawnSync(
    "python3",
    [
      "-I",
      "-S",
      fileURLToPath(
        new URL("../../../runner/python/tracer.py", import.meta.url),
      ),
    ],
    {
      input: JSON.stringify({
        code: program,
        input: { args: [[1]], kwargs: {} },
      }),
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(process.status, 0, process.stderr);
  const records = process.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const { type, ...terminal } = records.at(-1);
  const result = {
    schemaVersion: 1,
    language: "python",
    steps: records.filter((r) => r.type === "event").map((r) => r.event),
    stdout: "",
    stderr: "",
    ...terminal,
  };
  assert.equal(
    validator.Check(result),
    true,
    JSON.stringify([...validator.Errors(result)]),
  );
  assert.equal(validator.Check({ ...result, schemaVersion: 2 }), false);
  assert.equal(
    validator.Check({ ...result, steps: [{ bad: "event" }] }),
    false,
  );
});
