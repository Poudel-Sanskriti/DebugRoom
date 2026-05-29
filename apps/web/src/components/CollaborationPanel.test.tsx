import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import CollaborationPanel from "./CollaborationPanel";
import { api } from "../api";
vi.mock("../api", () => ({ api: vi.fn() }));
const request = vi.mocked(api);
function model(role: "tutor" | "student" = "tutor") {
  const draft = {
    language: "python",
    code: 'secret = "DO_NOT_SHARE"\nprint("shared line")\nprint(secret)',
    input: '{"args":["PRIVATE_INPUT"],"kwargs":{}}',
    problem: "",
    entryPoint: null,
  };
  return {
    workspace: { id: "room", studentRevision: 0, invitationActive: false },
    branch: {
      id: "branch",
      kind: role === "tutor" ? "mentor" : "student",
      revision: 0,
    },
    draft,
    session: { role },
    run: null,
    history: [],
    flush: vi.fn().mockResolvedValue(true),
    setError: vi.fn(),
    refreshWorkspace: vi.fn(),
    chooseWorkspace: vi.fn(),
    edit: vi.fn(),
  } as any;
}
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (url, options) => {
    if (options?.method === "POST") return { id: "new" };
    if (url.endsWith("/shares")) return { shares: [] };
    if (url.endsWith("/comments")) return { comments: [] };
    if (url.endsWith("/test-cases")) return { testCases: [] };
    if (url.endsWith("/snapshots")) return { versions: [] };
    return { hypothesis: "", conclusion: "", revision: 0 };
  });
});
it("previews only the selected source and sends a range instead of exposing private input", async () => {
  const user = userEvent.setup(),
    controller = model();
  render(
    <CollaborationPanel model={controller} line={2} onEditDraft={() => {}} />,
  );
  await user.click(
    await screen.findByRole("button", { name: "Share feedback" }),
  );
  const dialog = within(
    screen.getByRole("dialog", { name: "Choose what the student sees" }),
  );
  await user.click(dialog.getByRole("button", { name: "Selected lines" }));
  fireEvent.change(dialog.getByLabelText("From line"), {
    target: { value: "2" },
  });
  fireEvent.change(dialog.getByLabelText("To line"), {
    target: { value: "2" },
  });
  await user.type(dialog.getByLabelText("Title"), "Observe this line");
  expect(dialog.getByText('print("shared line")')).toBeInTheDocument();
  expect(dialog.queryByText(/DO_NOT_SHARE/)).not.toBeInTheDocument();
  expect(dialog.queryByText(/PRIVATE_INPUT/)).not.toBeInTheDocument();
  await user.click(dialog.getByRole("button", { name: "Share with student" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/api/workspaces/room/shares", {
      method: "POST",
      body: {
        branchId: "branch",
        kind: "selection",
        title: "Observe this line",
        body: "",
        startLine: 2,
        endLine: 2,
      },
    }),
  );
  expect(controller.flush).toHaveBeenCalled();
});
it("does not offer tutor controls in the student view", async () => {
  render(
    <CollaborationPanel
      model={model("student")}
      line={1}
      onEditDraft={() => {}}
    />,
  );
  await screen.findByText("Shared feedback");
  expect(
    screen.queryByRole("button", { name: "Invite student" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Share feedback" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete workspace" }),
  ).not.toBeInTheDocument();
});
it("keeps comments and saved inputs collapsed until they are needed", async () => {
  const user = userEvent.setup();
  render(
    <CollaborationPanel model={model()} line={1} onEditDraft={() => {}} />,
  );
  expect(
    await screen.findByText("Questions and shared feedback"),
  ).toBeVisible();
  const comments = screen.getByRole("heading", {
    name: "Comments on source lines",
  });
  expect(comments).not.toBeVisible();
  await user.click(screen.getByText("Comments and saved test inputs"));
  expect(comments).toBeVisible();
});
