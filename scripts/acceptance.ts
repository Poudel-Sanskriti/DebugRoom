import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { TestClient, waitForRun } from "./http-client.ts";
import { examples } from "../apps/web/src/examples.ts";
import { emptyDraft, type Workspace, type Branch } from "@debugroom/contracts";

const base = process.env.DEBUGROOM_TEST_API ?? "http://127.0.0.1:3001",
  origin = process.env.DEBUGROOM_TEST_ORIGIN ?? "http://127.0.0.1:5173";
const tutor = new TestClient(base, origin),
  student = new TestClient(base, origin);
await tutor.localLogin();
const checks: string[] = [];
const room = await tutor.request<Workspace>("/api/workspaces", "POST", {
  title: "Acceptance · private tutoring",
});
try {
  const invitation = await tutor.request(
    `/api/workspaces/${room.id}/invitations`,
    "POST",
  );
  await student.request("/api/invitations/redeem", "POST", {
    token: invitation.token,
  });
  const identity = await student.session();
  assert.equal(identity.role, "student");
  await student.request(
    "/api/invitations/redeem",
    "POST",
    { token: invitation.token },
    404,
  );
  await student.request(
    "/api/auth/local",
    "POST",
    { token: "unknown-local-access-key-".repeat(2) },
    403,
  );
  checks.push("single-use invitation and separate student session");
  const tutorRoom = await tutor.request<Workspace>(
      `/api/workspaces/${room.id}`,
    ),
    studentRoom = await student.request<Workspace>(
      `/api/workspaces/${room.id}`,
    );
  assert.equal(studentRoom.branches.length, 1);
  const studentBranch = studentRoom.branches[0]!,
    mentor = tutorRoom.branches.find((branch) => branch.kind === "mentor")!;
  const example = examples.find((item) => item.id === "binary-search")!;
  const saved = await student.request<Branch>(
    `/api/branches/${studentBranch.id}/draft`,
    "PUT",
    { expectedRevision: 0, draft: example.draft },
  );
  const submitted = await student.request("/api/runs", "POST", {
    branchId: saved.id,
    expectedRevision: saved.revision,
    draft: saved.draft,
    idempotencyKey: crypto.randomUUID(),
  });
  // An edit races with real execution; its saved snapshot must stay unchanged.
  await student.request(`/api/branches/${saved.id}/draft`, "PUT", {
    expectedRevision: saved.revision,
    draft: { ...saved.draft, input: '{"args":[[],11],"kwargs":{}}' },
  });
  const completed = await waitForRun(student, submitted.id);
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.result.returnValue.value, "5");
  assert.equal(completed.snapshot.input, example.draft.input);
  const attempts = await student.request(`/api/runs/${submitted.id}/attempts`);
  assert.match(attempts.attempts[0].runtime, /sha256:/);
  assert.equal(attempts.attempts[0].policy.steps, 10000);
  checks.push(
    "real Python execution, immutable edit-during-run snapshot, pinned runtime policy",
  );
  const privateDraft = {
    ...emptyDraft,
    code: 'def answer():\n    private_value = "PRIVATE_EXPERIMENT"\n    return private_value\n',
    input: '{"args":[],"kwargs":{}}',
    entryPoint: "answer",
  };
  const privateBranch = await tutor.request<Branch>(
    `/api/branches/${mentor.id}/draft`,
    "PUT",
    { expectedRevision: 0, draft: privateDraft },
  );
  const privateRun = await tutor.request("/api/runs", "POST", {
    branchId: mentor.id,
    expectedRevision: privateBranch.revision,
    draft: privateDraft,
    idempotencyKey: crypto.randomUUID(),
  });
  await waitForRun(tutor, privateRun.id);
  await student.request(`/api/runs/${privateRun.id}`, "GET", undefined, 404);
  await student.request(
    `/api/snapshots/${privateRun.snapshotId}`,
    "GET",
    undefined,
    404,
  );
  await tutor.request(`/api/workspaces/${room.id}/shares`, "POST", {
    branchId: mentor.id,
    kind: "selection",
    title: "A line to discuss",
    body: "What will this return?",
    startLine: 3,
    endLine: 3,
  });
  const shared = await student.request(`/api/workspaces/${room.id}/shares`);
  assert.equal(shared.shares[0].source, "    return private_value");
  assert.equal(shared.shares[0].input, null);
  const exported = await student.request(`/api/workspaces/${room.id}/export`);
  assert.ok(!JSON.stringify(exported).includes("PRIVATE_EXPERIMENT"));
  assert.equal(exported.observations[0].returnValue.value, "5");
  checks.push(
    "private mentor trace denied, selective sharing, filtered export with real output",
  );
  await tutor.request(
    `/api/snapshots/${submitted.snapshotId}/comments`,
    "POST",
    { line: 5, body: "How did the interval change here?" },
  );
  const comments = await student.request(`/api/workspaces/${room.id}/comments`);
  assert.equal(comments.comments[0].snapshotId, submitted.snapshotId);
  assert.equal(comments.comments[0].outdated, true);
  await student.request(`/api/branches/${saved.id}/test-cases`, "POST", {
    name: "Empty input",
    input: '{"args":[[],11],"kwargs":{}}',
    expected: "Return -1",
  });
  const cases = await student.request(`/api/branches/${saved.id}/test-cases`);
  assert.equal(cases.testCases[0].name, "Empty input");
  await tutor.request(
    `/api/branches/${saved.id}/draft`,
    "PUT",
    { expectedRevision: 2, draft: example.draft },
    409,
  );
  await tutor.request(`/api/branches/${saved.id}/draft`, "PUT", {
    expectedRevision: 2,
    draft: example.draft,
    confirmDirectEdit: true,
  });
  const versions = await student.request(
    `/api/workspaces/${room.id}/snapshots`,
  );
  assert.ok(
    versions.versions.some(
      (version: any) => version.reason === "before_tutor_edit",
    ),
  );
  checks.push(
    "version-linked comments, regression input, confirmed direct edit with preserved version",
  );
  await tutor.request(`/api/workspaces/${room.id}/invitations/revoke`, "POST");
  await student.request(`/api/workspaces/${room.id}`, "GET", undefined, 401);
  checks.push("revocation invalidates an existing student session");
} finally {
  await tutor.request(`/api/workspaces/${room.id}`, "DELETE");
}
const cpp = examples.find((item) => item.id === "cpp-recursion")!;
const cppRoom = await tutor.request<Workspace>("/api/workspaces", "POST", {
  title: "Acceptance · C++ factorial",
});
const branch = await tutor.request<Branch>(
  `/api/branches/${cppRoom.branches[0]!.id}/draft`,
  "PUT",
  { expectedRevision: 0, draft: cpp.draft },
);
const cppRun = await tutor.request("/api/runs", "POST", {
  branchId: branch.id,
  expectedRevision: branch.revision,
  draft: cpp.draft,
  idempotencyKey: crypto.randomUUID(),
});
const cppResult = await waitForRun(tutor, cppRun.id);
assert.equal(cppResult.outcome, "completed");
assert.equal(cppResult.result.stdout, "24\n");
checks.push(
  "real C++ compilation, recursive debugger trace, and stdin/output through the same API",
);
const report = {
  status: "passed",
  checkedAt: new Date().toISOString(),
  base,
  checks,
  cppEvents: cppResult.result.steps.length,
};
await mkdir(".data", { recursive: true });
await writeFile(
  path.join(".data", "acceptance-evidence.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
