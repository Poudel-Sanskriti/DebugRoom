import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const docker = process.env.DOCKER_BIN ?? "docker";
const context =
  process.env.DOCKER_CONTEXT ??
  (process.platform === "darwin" ? "colima-debugroom" : undefined);
const prefix = context ? ["--context", context] : [];
const info = JSON.parse(
  execFileSync(docker, [...prefix, "info", "--format", "{{json .Runtimes}}"], {
    encoding: "utf8",
  }),
);
if (!info.runsc)
  throw new Error(
    "Install gVisor on the dedicated execution host using infra/install-gvisor.sh before building the local stack.",
  );
async function command(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(docker, [...prefix, ...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Container build failed")),
    );
  });
}
await command([
  "build",
  "-f",
  "runner/python/Dockerfile",
  "-t",
  "debugroom-python:local",
  ".",
]);
await command([
  "build",
  "-f",
  "runner/cpp/Dockerfile",
  "-t",
  "debugroom-cpp:local",
  ".",
]);
const images = Object.fromEntries(
  ["python", "cpp"].map((language) => [
    language,
    execFileSync(
      docker,
      [
        ...prefix,
        "image",
        "inspect",
        "--format",
        "{{.Id}}",
        `debugroom-${language}:local`,
      ],
      { encoding: "utf8" },
    ).trim(),
  ]),
);
await mkdir(".data", { recursive: true, mode: 0o700 });
await writeFile(
  ".data/runtime-images.json",
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      images,
      pythonRuntime: "runsc",
      cppRuntime: "runc",
    },
    null,
    2,
  ) + "\n",
);
console.log("Language runtimes are ready. Start DebugRoom with npm run dev.");
