import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import fixture from "./test-fixtures/loop.json";
import type { Draft, Run, Workspace } from "@debugroom/contracts";
import { emptyDraft } from "@debugroom/contracts";

let workspace: Workspace,
  requests: { url: string; method: string; body: any }[],
  currentRun: Run | null,
  failRun: boolean;
const id = "11111111-1111-4111-8111-111111111111",
  branchId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  requests = [];
  currentRun = null;
  failRun = false;
  workspace = {
    id,
    title: "Test workspace",
    role: "tutor",
    createdAt: "2026-09-13T00:00:00Z",
    expiresAt: "2026-10-13T00:00:00Z",
    studentRevision: 0,
    invitationActive: false,
    branches: [
      {
        id: branchId,
        name: "Workspace",
        kind: "student",
        revision: 0,
        draft: { ...emptyDraft },
        updatedAt: "2026-09-13T00:00:00Z",
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: any = {}) => {
      const body = options.body ? JSON.parse(options.body) : undefined,
        method = options.method ?? "GET";
      requests.push({ url, method, body });
      let result: unknown,
        status = 200;
      if (url === "/api/config")
        result = {
          localAuth: false,
          githubAuth: true,
          executionMode: "docker",
          languages: ["python"],
          limits: { warningMs: 5000, wallMs: 60000, steps: 10000 },
        };
      else if (url === "/api/session")
        result = { role: "tutor", displayName: "Learner", csrf: "test-csrf" };
      else if (url === "/api/workspaces") result = { workspaces: [workspace] };
      else if (url === `/api/workspaces/${id}`) result = workspace;
      else if (url === `/api/workspaces/${id}/runs`)
        result = { runs: currentRun ? [currentRun] : [] };
      else if (url === `/api/branches/${branchId}/draft`) {
        workspace.branches[0] = {
          ...workspace.branches[0]!,
          draft: body.draft,
          revision: workspace.branches[0]!.revision + 1,
        };
        result = workspace.branches[0];
      } else if (url === "/api/functions")
        result = {
          functions: [{ name: "running_total", signature: "numbers", line: 1 }],
        };
      else if (url === "/api/runs" && method === "POST") {
        if (failRun) {
          status = 503;
          result = {
            error: {
              code: "service_unavailable",
              message: "Execution is temporarily unavailable",
            },
          };
        } else {
          currentRun = {
            id: "33333333-3333-4333-8333-333333333333",
            workspaceId: id,
            branchId,
            snapshotId: "44444444-4444-4444-8444-444444444444",
            status: "finished",
            outcome: "completed",
            createdAt: "2026-09-13T01:00:00Z",
            startedAt: "2026-09-13T01:00:00Z",
            finishedAt: "2026-09-13T01:00:01Z",
            attempt: 1,
            snapshot: {
              ...body.draft,
              id: "44444444-4444-4444-8444-444444444444",
              revision: body.expectedRevision,
              createdAt: "2026-09-13T01:00:00Z",
            },
            result: fixture.result as Run["result"],
          };
          result = currentRun;
        }
      } else if (url.startsWith("/api/runs/")) result = currentRun;
      else throw new Error(`Unexpected request ${method} ${url}`);
      return {
        ok: status < 400,
        status,
        json: async () => structuredClone(result),
      };
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
async function loadAndRun() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("textbox", { name: "Program code" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Load example" }),
    "loop",
  );
  await user.click(screen.getByRole("button", { name: /Run code/ }));
  await screen.findByText("Completed");
  return user;
}

describe("real-run workspace UI", () => {
  it("starts with an empty editable program and no fabricated trace", async () => {
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "Program code" });
    expect(editor).toHaveTextContent("# Paste your Python code here");
    expect(screen.getByRole("button", { name: /Run code/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(requests.filter((r) => r.url === "/api/runs")).toHaveLength(0);
  });
  it("submits the source/input, seeks the real fixture, and steps without executing again", async () => {
    const user = await loadAndRun();
    await user.click(screen.getByRole("tab", { name: "Variables" }));
    const loopIndex = fixture.result.steps.findIndex(
      (e) =>
        e.kind === "line" &&
        e.line === 4 &&
        e.frames.at(-1)?.function === "running_total",
    );
    const timeline = screen.getByRole("slider", { name: "Execution timeline" });
    fireEvent.change(timeline, { target: { value: String(loopIndex) } });
    expect(screen.getByTestId("current-line")).toHaveTextContent("Line 4");
    expect(document.querySelector(".cm-trace-line")).toHaveTextContent(
      "total += number",
    );
    const inspector = within(
      screen.getByRole("region", { name: "Execution inspector" }),
    );
    await user.click(inspector.getByRole("button", { name: "Pin total" }));
    expect(inspector.getByText("Pinned variables")).toBeInTheDocument();
    await user.click(inspector.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("current-line")).toHaveTextContent("Line 5");
    expect(document.querySelector(".cm-trace-line")).toHaveTextContent("print");
    await user.click(inspector.getByRole("button", { name: "Previous" }));
    expect(screen.getByTestId("current-line")).toHaveTextContent("Line 4");
    fireEvent.change(timeline, {
      target: { value: String(fixture.result.steps.length - 1) },
    });
    expect(inspector.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(
      inspector.getByRole("button", { name: "Restart playback" }),
    );
    expect(inspector.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(
      requests.filter((r) => r.url === "/api/runs" && r.method === "POST"),
    ).toHaveLength(1);
    expect(requests.find((r) => r.url === "/api/runs")!.body.draft.code).toBe(
      fixture.draft.code,
    );
    expect(requests.find((r) => r.url === "/api/runs")!.body.draft.input).toBe(
      fixture.draft.input,
    );
  });
  it("preserves the captured source while autosaving later edits", async () => {
    const user = await loadAndRun();
    await user.click(screen.getByRole("tab", { name: "Working draft" }));
    await user.click(screen.getByRole("tab", { name: "Input" }));
    await user.clear(screen.getByLabelText("Program input"));
    await user.paste('{"args":[[9]],"kwargs":{}}');
    await waitFor(
      () => expect(workspace.branches[0]!.draft.input).toContain("[9]"),
      { timeout: 2000 },
    );
    expect(currentRun!.snapshot!.input).toBe(fixture.draft.input);
    await user.click(screen.getByRole("tab", { name: "Run snapshot" }));
    expect(screen.getByLabelText("Program input")).toHaveValue(
      fixture.draft.input,
    );
    expect(screen.getByLabelText("Program input")).toHaveAttribute("readonly");
    expect(
      screen.getByRole("textbox", { name: "Run source" }),
    ).toHaveTextContent("running_total");
  });
  it("keeps the draft when execution submission fails", async () => {
    failRun = true;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("textbox", { name: "Program code" });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Load example" }),
      "loop",
    );
    await user.click(screen.getByRole("button", { name: /Run code/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Execution is temporarily unavailable",
    );
    expect(
      screen.getByRole("textbox", { name: "Program code" }),
    ).toHaveTextContent("running_total");
    expect(workspace.branches[0]!.draft.code).toBe(fixture.draft.code);
  });
});
