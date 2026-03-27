import { spawn } from "node:child_process";
import path from "node:path";
import { ApiError } from "./errors.ts";
import type { TraceError } from "@debugroom/contracts";

export function discoverPython(
  source: string,
  root: string,
  python = "python3",
): Promise<{
  functions: { name: string; line: number; signature: string }[];
  error?: TraceError;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      python,
      ["-I", "-S", path.join(root, "runner/python/tracer.py")],
      {
        env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const chunks: Buffer[] = [];
    let bytes = 0,
      settled = false;
    const finish = (error?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new ApiError(422, "Function discovery exceeded its time limit"));
    }, 2000);
    child.on("error", () =>
      finish(new ApiError(503, "Python function discovery is unavailable")),
    );
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 128 * 1024) {
        child.kill("SIGKILL");
        finish(
          new ApiError(422, "Function discovery output exceeded its limit"),
        );
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("close", (code) => {
      if (settled) return;
      try {
        const record = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          code !== 0 ||
          record.type !== "discovery" ||
          !Array.isArray(record.functions)
        )
          throw new Error();
        finish(undefined, { functions: record.functions, error: record.error });
      } catch {
        finish(new ApiError(422, "Python source could not be inspected"));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ mode: "discover", code: source }));
  });
}
