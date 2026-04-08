import assert from "node:assert/strict";
import { examples } from "../apps/web/src/examples.ts";
import type { Run, Workspace, Branch } from "@debugroom/contracts";

const origin = process.env.DEBUGROOM_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const base = process.env.DEBUGROOM_TEST_API ?? "http://127.0.0.1:3001";
let cookie = "",
  csrf = "";
async function request<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(base + url, {
    method,
    headers: {
      origin,
      host: new URL(base).host,
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const newCookie = response.headers.getSetCookie()[0];
  if (newCookie) cookie = newCookie.split(";")[0]!;
  const data = await response.json();
  assert.equal(response.ok, true, JSON.stringify(data));
  return data as T;
}
await request("/api/auth/local", "POST");
csrf = (await request<{ csrf: string }>("/api/session")).csrf;
const workspace = await request<Workspace>("/api/workspaces", "POST", {
  title: "Acceptance · binary search",
});
const example = examples.find((x) => x.id === "binary-search")!;
const branch = await request<Branch>(
  `/api/branches/${workspace.branches[0]!.id}/draft`,
  "PUT",
  { expectedRevision: 0, draft: example.draft },
);
let run = await request<Run>("/api/runs", "POST", {
  branchId: branch.id,
  expectedRevision: branch.revision,
  draft: example.draft,
  idempotencyKey: crypto.randomUUID(),
});
const deadline = Date.now() + 30_000;
while (run.status !== "finished" && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  run = await request<Run>(`/api/runs/${run.id}`);
}
assert.equal(run.status, "finished");
assert.equal(run.outcome, "completed", JSON.stringify(run.result?.error));
assert.equal(run.result?.returnValue?.kind, "scalar");
assert.equal((run.result!.returnValue as { value: string }).value, "5");
assert.equal(run.snapshot?.code, example.draft.code);
assert.ok(
  run.result!.steps.some((step) =>
    step.frames.some(
      (frame) => frame.locals.low && frame.locals.high && frame.locals.mid,
    ),
  ),
);
await request<Branch>(`/api/branches/${branch.id}/draft`, "PUT", {
  expectedRevision: branch.revision,
  draft: {
    ...example.draft,
    problem: example.draft.problem + "\n\nVerified: target 11 is at index 5.",
  },
});
const recovered = await request<Run>(`/api/runs/${run.id}`);
assert.equal(recovered.snapshot?.problem, example.draft.problem);
console.log(
  JSON.stringify({
    check: "browser-protocol-to-postgres-to-docker",
    status: "passed",
    workspaceId: workspace.id,
    runId: run.id,
    events: run.result!.steps.length,
    returnValue: 5,
  }),
);
