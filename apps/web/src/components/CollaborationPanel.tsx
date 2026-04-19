import { useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  GitBranch,
  Link,
  Lock,
  MessageSquare,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { SharedRevision, Workspace, Snapshot } from "@debugroom/contracts";
import type { useWorkspace } from "../hooks/useWorkspace";
import { api } from "../api";
import Modal from "./Modal";
type Controller = ReturnType<typeof useWorkspace>;
type CommentRow = {
  id: string;
  snapshotId: string;
  line: number;
  body: string;
  author: string;
  createdAt: string;
  revision: number;
  branchId: string;
  outdated: boolean;
};
type Notes = { hypothesis: string; conclusion: string; revision: number };
type Case = { id: string; name: string; input: string; expected: string };
type Share = SharedRevision & {
  entryPoint: string | null;
  problem: string | null;
};

export default function CollaborationPanel({
  model,
  line,
  onEditDraft,
}: {
  model: Controller;
  line: number;
  onEditDraft: () => void;
}) {
  const { workspace, branch, draft, session } = model;
  const [versions, setVersions] = useState<
    {
      id: string;
      branchId: string;
      revision: number;
      reason: string;
      createdAt: string;
    }[]
  >([]);
  const [shares, setShares] = useState<Share[]>([]),
    [comments, setComments] = useState<CommentRow[]>([]),
    [notes, setNotes] = useState<Notes>({
      hypothesis: "",
      conclusion: "",
      revision: 0,
    }),
    [cases, setCases] = useState<Case[]>([]);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [inviteUrl, setInviteUrl] = useState(""),
    [inviteExpiry, setInviteExpiry] = useState("");
  const [dialog, setDialog] = useState<
      "invite" | "revoke" | "share" | "case" | "delete" | null
    >(null),
    [kind, setKind] = useState<"hint" | "selection" | "full">("hint");
  const [shareTitle, setShareTitle] = useState(""),
    [shareBody, setShareBody] = useState(""),
    [startLine, setStartLine] = useState(1),
    [endLine, setEndLine] = useState(1);
  const [commentBody, setCommentBody] = useState(""),
    [commentLine, setCommentLine] = useState(line),
    [caseName, setCaseName] = useState(""),
    [caseExpected, setCaseExpected] = useState("");
  const [notesDirty, setNotesDirty] = useState(false),
    [initialStudentRevision, setInitialStudentRevision] = useState(
      workspace?.studentRevision ?? 0,
    );
  useEffect(
    () => setInitialStudentRevision(workspace?.studentRevision ?? 0),
    [workspace?.id],
  );
  useEffect(() => setCommentLine(line), [line]);
  useEffect(() => {
    if (!workspace) return;
    let active = true;
    api<{
      versions: {
        id: string;
        branchId: string;
        revision: number;
        reason: string;
        createdAt: string;
      }[];
    }>(`/api/workspaces/${workspace.id}/snapshots`)
      .then((data) => {
        if (active) setVersions(data.versions);
      })
      .catch((error) => model.setError(error.message));
    return () => {
      active = false;
    };
  }, [workspace?.id, model.run?.id, branch?.revision]);

  async function refresh() {
    if (!workspace || !branch) return;
    const [shared, feedback, regressions] = await Promise.all([
      api<{ shares: Share[] }>(`/api/workspaces/${workspace.id}/shares`),
      api<{ comments: CommentRow[] }>(
        `/api/workspaces/${workspace.id}/comments`,
      ),
      api<{ testCases: Case[] }>(`/api/branches/${branch.id}/test-cases`),
    ]);
    setShares(shared.shares);
    setComments(feedback.comments);
    setCases(regressions.testCases);
  }
  useEffect(() => {
    let alive = true;
    if (!workspace || !branch) return;
    setNotesDirty(false);
    setNotice("");
    Promise.all([
      api<{ shares: Share[] }>(`/api/workspaces/${workspace.id}/shares`),
      api<{ comments: CommentRow[] }>(
        `/api/workspaces/${workspace.id}/comments`,
      ),
      api<Notes>(`/api/branches/${branch.id}/notes`),
      api<{ testCases: Case[] }>(`/api/branches/${branch.id}/test-cases`),
    ])
      .then(([s, c, n, t]) => {
        if (alive) {
          setShares(s.shares);
          setComments(c.comments);
          setNotes(n);
          setCases(t.testCases);
        }
      })
      .catch((e) => {
        if (alive) model.setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [workspace?.id, branch?.id]);
  useEffect(() => {
    if (!workspace?.invitationActive) return;
    const timer = setInterval(
      () => void refresh().catch((e) => model.setError(e.message)),
      4000,
    );
    return () => clearInterval(timer);
  }, [workspace?.id, branch?.id, workspace?.invitationActive]);
  if (!workspace || !branch || !draft) return null;
  const isTutor = session?.role === "tutor",
    isMentor = branch.kind === "mentor";
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      model.setError(
        error instanceof Error
          ? error.message
          : "This action could not be completed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openMentor() {
    await perform(async () => {
      if (!(await model.flush())) return;
      const updated = await api<Workspace>(
        `/api/workspaces/${workspace!.id}/mentor-copy`,
        { method: "POST", body: {} },
      );
      await model.refreshWorkspace();
      await model.chooseWorkspace(
        updated.id,
        updated.branches.find((b) => b.kind === "mentor")!.id,
      );
      onEditDraft();
    });
  }
  async function createInvite() {
    await perform(async () => {
      if (!(await model.flush())) return;
      const invitation = await api<{ url: string; expiresAt: string }>(
        `/api/workspaces/${workspace!.id}/invitations`,
        { method: "POST" },
      );
      setInviteUrl(invitation.url);
      setInviteExpiry(invitation.expiresAt);
      setDialog(null);
      await model.refreshWorkspace();
      setNotice(
        "Invitation created. Open the link in a separate browser profile to try the student view.",
      );
    });
  }
  async function publishShare() {
    await perform(async () => {
      if (!(await model.flush())) return;
      await api(`/api/workspaces/${workspace!.id}/shares`, {
        method: "POST",
        body: {
          branchId: branch!.id,
          kind,
          title: shareTitle,
          body: shareBody,
          ...(kind === "selection" ? { startLine, endLine } : {}),
        },
      });
      await refresh();
      setDialog(null);
      setShareTitle("");
      setShareBody("");
      setNotice("Your selected feedback is now visible to the student.");
    });
  }
  async function exportWorkspace() {
    await perform(async () => {
      if (!(await model.flush())) return;
      const data = await api(`/api/workspaces/${workspace!.id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const href = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = href;
      link.download = `debugroom-${workspace!.id}.json`;
      link.click();
      URL.revokeObjectURL(href);
      setNotice("Exported the work and feedback you can access.");
    });
  }
  async function saveNotes() {
    await perform(async () => {
      const saved = await api<Notes>(`/api/branches/${branch!.id}/notes`, {
        method: "PUT",
        body: {
          hypothesis: notes.hypothesis,
          conclusion: notes.conclusion,
          expectedRevision: notes.revision,
        },
      });
      setNotes(saved);
      setNotesDirty(false);
      setNotice("Investigation notes saved.");
    });
  }
  const preview =
    kind === "full"
      ? draft.code
      : kind === "selection"
        ? draft.code
            .split("\n")
            .slice(startLine - 1, endLine)
            .join("\n")
        : "";
  return (
    <section
      className="collaboration-panel"
      aria-label="Investigation and collaboration"
    >
      <div className="collaboration-heading">
        <div>
          <h2>
            <Users size={17} /> Work through it together.
          </h2>
          <p>
            {isMentor
              ? "This mentor copy stays private until you share selected work."
              : "Keep your question, observations, and feedback in one place."}
          </p>
        </div>
        <div className="collaboration-actions">
          {isTutor && (
            <>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setDialog("invite")}
              >
                <Link size={14} />{" "}
                {workspace.invitationActive
                  ? "New invitation"
                  : "Invite student"}
              </button>
              {workspace.invitationActive && (
                <button
                  className="icon-button danger-text"
                  title="Revoke student access"
                  aria-label="Revoke student access"
                  onClick={() => setDialog("revoke")}
                >
                  <Lock size={14} />
                </button>
              )}
            </>
          )}
          <button
            className="secondary"
            onClick={exportWorkspace}
            disabled={busy}
          >
            <Download size={14} /> Export
          </button>
        </div>
      </div>
      {notice && (
        <div className="notice" role="status">
          <Check size={14} />
          {notice}
        </div>
      )}
      {inviteUrl && (
        <div className="invitation-card">
          <div>
            <ShieldCheck size={15} />
            <strong>Private student invitation</strong>
            <small>
              One use · expires {new Date(inviteExpiry).toLocaleDateString()}
            </small>
          </div>
          <div>
            <input
              aria-label="Student invitation link"
              value={inviteUrl}
              readOnly
            />
            <button
              className="secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(inviteUrl)
                  .then(() => setNotice("Invitation link copied."))
                  .catch(() =>
                    setNotice("Select and copy the invitation link above."),
                  )
              }
            >
              <Copy size={13} /> Copy
            </button>
          </div>
        </div>
      )}
      {isTutor &&
        workspace.invitationActive &&
        workspace.studentRevision > initialStudentRevision && (
          <div className="student-change">
            <GitBranch size={14} /> The student draft is now at revision{" "}
            {workspace.studentRevision}.
            <button
              className="text-button"
              onClick={() =>
                setInitialStudentRevision(workspace.studentRevision)
              }
            >
              Mark as seen
            </button>
          </div>
        )}
      <div className="investigation-grid">
        <div className="investigation-notes">
          <h3>
            <BookOpen size={14} /> Your investigation{" "}
            <span>{isMentor ? "mentor only" : "student copy"}</span>
          </h3>
          <label>
            What do you think is happening?
            <textarea
              value={notes.hypothesis}
              onChange={(e) => {
                setNotes({ ...notes, hypothesis: e.target.value });
                setNotesDirty(true);
              }}
              placeholder="Start with a hypothesis you can test."
            />
          </label>
          <label>
            What did the evidence show?
            <textarea
              value={notes.conclusion}
              onChange={(e) => {
                setNotes({ ...notes, conclusion: e.target.value });
                setNotesDirty(true);
              }}
              placeholder="Record the observation and the next question."
            />
          </label>
          <button
            className="secondary"
            disabled={busy || !notesDirty}
            onClick={saveNotes}
          >
            <Check size={13} /> Save notes
          </button>
        </div>
        <div className="feedback-area">
          <div className="feedback-heading">
            <h3>
              <MessageSquare size={14} /> Shared feedback
            </h3>
            {isTutor &&
              (isMentor ? (
                <button
                  className="secondary"
                  onClick={() => setDialog("share")}
                >
                  <Plus size={13} /> Share feedback
                </button>
              ) : (
                <button
                  className="secondary"
                  onClick={openMentor}
                  disabled={busy}
                >
                  <GitBranch size={13} /> Open mentor copy
                </button>
              ))}
          </div>
          {shares.length ? (
            <div className="shared-list">
              {shares.map((share) => (
                <article className="shared-card" key={share.id}>
                  <div>
                    <strong>{share.title}</strong>
                    <span>
                      {share.kind === "hint"
                        ? "Question / hint"
                        : share.kind === "selection"
                          ? "Selected lines"
                          : "Shared copy"}
                    </span>
                  </div>
                  <p>{share.body}</p>
                  {share.source && (
                    <details>
                      <summary>View shared source</summary>
                      <pre>{share.source}</pre>
                    </details>
                  )}
                  {share.kind === "full" && share.source !== null && (
                    <button
                      className="text-button"
                      onClick={() => {
                        model.edit({
                          code: share.source!,
                          input: share.input ?? draft.input,
                          language: share.language,
                          entryPoint: share.entryPoint,
                          problem: share.problem ?? draft.problem,
                        });
                        onEditDraft();
                      }}
                    >
                      Load into my draft →
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-feedback">
              <MessageSquare size={24} />
              <p>
                {isTutor
                  ? "Share a question, a few selected lines, or a complete experiment."
                  : "Feedback your tutor shares will appear here."}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="investigation-grid lower">
        <div className="regression-cases">
          <div className="feedback-heading">
            <h3>
              <FlaskGlyph /> Regression inputs
            </h3>
            <button className="secondary" onClick={() => setDialog("case")}>
              <Plus size={13} /> Save current input
            </button>
          </div>
          <p className="small-note">
            Expected results are your notes, not an automatic grade.
          </p>
          {cases.length ? (
            cases.map((item) => (
              <div className="case-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.expected || "No expected result recorded"}</span>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    model.edit({ input: item.input });
                    onEditDraft();
                  }}
                >
                  Use input →
                </button>
              </div>
            ))
          ) : (
            <p className="small-note">
              Keep an input that reproduces a bug or checks an edge case.
            </p>
          )}
        </div>
        <div className="line-comments">
          <h3>
            <MessageSquare size={14} /> Comments on source lines
          </h3>
          {model.run?.snapshot && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await api(
                    `/api/snapshots/${model.run!.snapshotId}/comments`,
                    {
                      method: "POST",
                      body: { line: commentLine, body: commentBody },
                    },
                  );
                  setCommentBody("");
                  await refresh();
                });
              }}
            >
              <label>
                Line{" "}
                <input
                  type="number"
                  aria-label="Comment source line"
                  min={1}
                  max={model.run.snapshot.code.split("\n").length}
                  value={commentLine}
                  onChange={(e) => setCommentLine(Number(e.target.value))}
                />
                <span>on run {model.run.id.slice(0, 8)}</span>
              </label>
              <textarea
                aria-label="Line comment"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Ask a question or leave an observation."
              />
              <button
                className="secondary"
                disabled={busy || !commentBody.trim()}
              >
                <Send size={12} /> Add comment
              </button>
            </form>
          )}
          {!model.run && (
            <p className="small-note">
              Select a run to attach feedback to its exact source.
            </p>
          )}
          <div className="comments-list">
            {comments.map((comment) => (
              <article key={comment.id}>
                <div>
                  <strong>{comment.author}</strong>
                  <span>
                    Line {comment.line} · revision {comment.revision}
                    {comment.outdated ? " · older version" : ""}
                  </span>
                </div>
                <p>{comment.body}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
      {versions.some(
        (version) =>
          version.branchId === branch.id &&
          version.reason === "before_tutor_edit",
      ) && (
        <details className="preserved-versions">
          <summary>Versions preserved before tutor edits</summary>
          {versions
            .filter(
              (version) =>
                version.branchId === branch.id &&
                version.reason === "before_tutor_edit",
            )
            .map((version) => (
              <div key={version.id}>
                <span>
                  Revision {version.revision} ·{" "}
                  {new Date(version.createdAt).toLocaleString()}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    void perform(async () => {
                      const snapshot = await api<Snapshot>(
                        `/api/snapshots/${version.id}`,
                      );
                      const content = JSON.stringify(snapshot, null, 2),
                        url = URL.createObjectURL(
                          new Blob([content], { type: "application/json" }),
                        ),
                        link = document.createElement("a");
                      link.href = url;
                      link.download = `debugroom-preserved-${version.revision}.json`;
                      link.click();
                      URL.revokeObjectURL(url);
                    })
                  }
                >
                  Download preserved version →
                </button>
              </div>
            ))}
        </details>
      )}
      {isTutor && (
        <div className="workspace-management">
          <button
            className="text-button danger-text"
            onClick={() => setDialog("delete")}
          >
            <Trash2 size={12} /> Delete workspace
          </button>
        </div>
      )}
      {dialog === "invite" && (
        <Modal title="Invite one student" onClose={() => setDialog(null)}>
          <p className="dialog-description">
            The student can open this workspace without an account. Your mentor
            copy remains private. Creating a new link revokes previous student
            links and sessions.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button className="primary" disabled={busy} onClick={createInvite}>
              Create private link
            </button>
          </div>
        </Modal>
      )}
      {dialog === "revoke" && (
        <Modal title="Revoke student access?" onClose={() => setDialog(null)}>
          <p className="dialog-description">
            Existing invitation links and student sessions will stop working.
            The saved work remains in your workspace.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="stop-button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api(
                    `/api/workspaces/${workspace.id}/invitations/revoke`,
                    { method: "POST" },
                  );
                  setInviteUrl("");
                  setDialog(null);
                  await model.refreshWorkspace();
                  setNotice("Student access revoked.");
                })
              }
            >
              Revoke access
            </button>
          </div>
        </Modal>
      )}
      {dialog === "share" && (
        <Modal
          title="Choose what the student sees"
          onClose={() => setDialog(null)}
        >
          <div className="share-kinds">
            {(["hint", "selection", "full"] as const).map((type) => (
              <button
                key={type}
                className={kind === type ? "selected" : ""}
                onClick={() => setKind(type)}
              >
                {type === "hint"
                  ? "Question / hint"
                  : type === "selection"
                    ? "Selected lines"
                    : "Complete copy"}
              </button>
            ))}
          </div>
          <label className="form-label">
            Title
            <input
              value={shareTitle}
              onChange={(e) => setShareTitle(e.target.value)}
              maxLength={120}
              placeholder="Give this feedback a short title"
            />
          </label>
          <label className="form-label">
            Your feedback
            <textarea
              value={shareBody}
              onChange={(e) => setShareBody(e.target.value)}
              placeholder="What should the student investigate?"
            />
          </label>
          {kind === "selection" && (
            <div className="line-range">
              <label>
                From line
                <input
                  type="number"
                  min={1}
                  max={draft.code.split("\n").length}
                  value={startLine}
                  onChange={(e) => setStartLine(Number(e.target.value))}
                />
              </label>
              <label>
                To line
                <input
                  type="number"
                  min={startLine}
                  max={draft.code.split("\n").length}
                  value={endLine}
                  onChange={(e) => setEndLine(Number(e.target.value))}
                />
              </label>
            </div>
          )}
          {kind !== "hint" && (
            <div className="share-preview">
              <span>Source the student will receive</span>
              <pre>{preview}</pre>
              {kind === "full" && (
                <>
                  <span>Input included with the copy</span>
                  <pre>{draft.input}</pre>
                </>
              )}
            </div>
          )}
          <p className="small-note">
            {kind === "hint"
              ? "Only your title and feedback will be shared."
              : kind === "selection"
                ? "Only the selected source lines and your feedback will be shared."
                : "The current code, input, and problem notes will be shared as an immutable copy."}
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !shareTitle.trim()}
              onClick={publishShare}
            >
              <Send size={14} /> Share with student
            </button>
          </div>
        </Modal>
      )}
      {dialog === "case" && (
        <Modal title="Save a regression input" onClose={() => setDialog(null)}>
          <label className="form-label">
            Name
            <input
              value={caseName}
              onChange={(e) => setCaseName(e.target.value)}
              placeholder="For example: empty list"
            />
          </label>
          <label className="form-label">
            Expected result, in your words
            <textarea
              value={caseExpected}
              onChange={(e) => setCaseExpected(e.target.value)}
              placeholder="What should this case demonstrate?"
            />
          </label>
          <pre className="input-preview">{draft.input}</pre>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !caseName.trim()}
              onClick={() =>
                void perform(async () => {
                  await api(`/api/branches/${branch.id}/test-cases`, {
                    method: "POST",
                    body: {
                      name: caseName,
                      input: draft.input,
                      expected: caseExpected,
                    },
                  });
                  setDialog(null);
                  setCaseName("");
                  setCaseExpected("");
                  await refresh();
                })
              }
            >
              Save input
            </button>
          </div>
        </Modal>
      )}
      {dialog === "delete" && (
        <Modal title="Delete this workspace?" onClose={() => setDialog(null)}>
          <p className="dialog-description">
            Access is removed immediately. Drafts, run history, and feedback
            will be deleted. Export anything you want to keep before continuing.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setDialog(null)}>
              Keep workspace
            </button>
            <button
              className="stop-button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  if (!(await model.flush())) return;
                  await api(`/api/workspaces/${workspace.id}`, {
                    method: "DELETE",
                  });
                  window.location.reload();
                })
              }
            >
              Delete workspace
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
function FlaskGlyph() {
  return <span aria-hidden="true">◇</span>;
}
