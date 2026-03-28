import { spawn } from "node:child_process";
import { loadConfig } from "../apps/api/src/config.ts";
import path from "node:path";
const config = await loadConfig();
const child = spawn(
  config.python ?? "python3",
  [path.join(config.root, "runner/agent/main.py")],
  {
    stdio: "inherit",
    cwd: config.root,
    env: {
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      DEBUGROOM_API_URL:
        process.env.DEBUGROOM_API_URL ?? `http://127.0.0.1:${config.port}`,
      DEBUGROOM_RUNNER_TOKEN: config.runnerToken,
      DEBUGROOM_EXECUTION_MODE: config.executionMode,
      DOCKER_CONTEXT:
        process.env.DOCKER_CONTEXT ??
        (process.platform === "darwin" ? "colima-debugroom" : undefined),
      DOCKER_BIN: process.env.DOCKER_BIN ?? "docker",
      DEBUGROOM_LANGUAGES: process.env.DEBUGROOM_LANGUAGES ?? "python",
      PYTHON_IMAGE: process.env.PYTHON_IMAGE,
      CPP_IMAGE: process.env.CPP_IMAGE,
      CONTAINER_RUNTIME: process.env.CONTAINER_RUNTIME,
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
