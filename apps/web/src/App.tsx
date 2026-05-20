import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Circle,
  Code2,
  Download,
  FileCode2,
  FlaskConical,
  History,
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
  Square,
  Terminal,
  X,
  AlertTriangle,
  FolderOpen,
  GitBranch,
  Play,
  RotateCw,
  Users,
  Columns2,
  Pencil,
} from "lucide-react";
import { useWorkspace } from "./hooks/useWorkspace";
import TraceInspector, { outcomeName } from "./components/TraceInspector";
import CollaborationPanel from "./components/CollaborationPanel";
import RunComparison from "./components/RunComparison";
import Modal from "./components/Modal";
import { examples } from "./examples";
import ProblemLibrary from "./components/ProblemLibrary";
import ProblemStudyBar from "./components/ProblemStudyBar";
import {
  problemDraft,
  problemForDraft,
  type PracticeProblem,
} from "./problems";
import { api } from "./api";
import type { Draft, Run } from "@debugroom/contracts";
import "./styles.css";
const CodeEditor = lazy(() => import("./CodeEditor"));
const sameSource = (left: Draft | null, right: Draft | undefined) =>
  !!left &&
  !!right &&
  left.code === right.code &&
  left.input === right.input &&
  left.language === right.language &&
  left.entryPoint === right.entryPoint;

export default function App() {
  const model = useWorkspace();
  const { workspace, branch, draft, run } = model;
  const [localKey, setLocalKey] = useState("");
  const [renameTitle, setRenameTitle] = useState<string | null>(null);
  const [index, setIndex] = useState(0),
    [sourceView, setSourceView] = useState<"draft" | "run">("draft"),
    [bottomTab, setBottomTab] = useState<"input" | "problem">("input");
  const [showCollaboration, setShowCollaboration] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [watchRunId, setWatchRunId] = useState<string>();
  const activeProblem = problemForDraft(draft);
  const [showComparison, setShowComparison] = useState(false);
  const [showHistory, setShowHistory] = useState(false),
    [functions, setFunctions] = useState<
      { name: string; signature: string; line: number }[]
    >([]),
    [discoveryError, setDiscoveryError] = useState("");
  const [showReload, setShowReload] = useState(false),
    [showDirect, setShowDirect] = useState(false),
    [directUnlocked, setDirectUnlocked] = useState(false);
  const displayed =
    sourceView === "run" && run?.snapshot ? run.snapshot : draft;
  const pending = run?.status === "queued" || run?.status === "running";
  const readonly =
    sourceView === "run" ||
    (workspace?.invitationActive &&
      model.session?.role === "tutor" &&
      branch?.kind === "student" &&
      !directUnlocked);
  const event = run?.result?.steps[index];
  const highlight =
    sourceView === "run" || sameSource(draft, run?.snapshot)
      ? (event?.line ?? run?.result?.error?.line ?? undefined)
      : undefined;
  useEffect(() => {
    setIndex(0);
    if (run) setSourceView("run");
  }, [run?.id]);
  useEffect(() => {
    setDirectUnlocked(false);
    setSourceView("draft");
  }, [branch?.id]);
  useEffect(() => {
    if (!draft?.code.trim() || draft.language !== "python") {
      setFunctions([]);
      setDiscoveryError("");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<{
        functions: { name: string; signature: string; line: number }[];
        error?: { message: string };
      }>("/api/functions", {
        method: "POST",
        body: { language: "python", code: draft.code },
        signal: controller.signal,
      })
        .then((data) => {
          setFunctions(data.functions);
          setDiscoveryError(data.error?.message ?? "");
          const canEdit = !(
            workspace?.invitationActive &&
            model.session?.role === "tutor" &&
            branch?.kind === "student" &&
            !directUnlocked
          );
          if (
            canEdit &&
            !data.error &&
            draft.entryPoint &&
            draft.entryPoint !== "__module__" &&
            !data.functions.some((fn) => fn.name === draft.entryPoint)
          )
            model.edit({ entryPoint: null });
        })
        .catch((error) => {
          if (error.name !== "AbortError") setDiscoveryError(error.message);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    draft?.code,
    draft?.language,
    draft?.entryPoint,
    branch?.id,
    branch?.kind,
    workspace?.invitationActive,
    model.session?.role,
    directUnlocked,
  ]);
  useEffect(() => {
    if (!workspace) return;
    const timer = setInterval(
      () =>
        void model
          .refreshWorkspace()
          .catch((error) => model.setError(error.message)),
      workspace.invitationActive ? 3500 : 15000,
    );
    return () => clearInterval(timer);
  }, [workspace?.id, workspace?.invitationActive, model.refreshWorkspace]);
  const startRun = useCallback(() => {
    setIndex(0);
    void model.startRun();
  }, [model.startRun]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (draft?.code.trim() && !model.submitting) startRun();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [draft?.code, model.submitting, startRun]);
  const viewRunSource = useCallback(
    (line?: number) => {
      setSourceView("run");
      if (line && run?.result) {
        for (let i = run.result.steps.length - 1; i >= 0; i--) {
          if (run.result.steps[i]!.line === line) {
            setIndex(i);
            break;
          }
        }
      }
    },
    [run?.result],
  );
  function loadExample(id: string) {
    const example = examples.find((item) => item.id === id);
    if (example) {
      setSourceView("draft");
      model.edit(example.draft);
      setBottomTab("input");
    }
  }
  async function openProblem(
    problem: PracticeProblem,
    mode: "practice" | "solution",
    caseIndex: number,
  ) {
    if (model.session?.role !== "tutor") return false;
    if (
      !(await model.createWorkspace(
        `${problem.title} · ${mode === "practice" ? "Practice" : "Walkthrough"}`,
      ))
    )
      return false;
    model.edit(problemDraft(problem, mode, caseIndex));
    setSourceView("draft");
    setBottomTab("input");
    setIndex(0);
    setShowCollaboration(false);
    setShowHistory(false);
    if (!(await model.flush())) return false;
    if (mode === "solution") {
      const started = await model.startRun();
      if (started) setWatchRunId(started.id);
    }
    return true;
  }
  function copyDraft() {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(draft, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "debugroom-draft.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  if (model.loading && !workspace)
    return (
      <div className="app-loading">
        <span className="brand-mark">dr</span>
        <LoaderCircle className="spin" size={24} />
        <p>Opening your workspace…</p>
      </div>
    );
  if (model.invitation)
    return (
      <div className="entry-screen">
        <div className="entry-card">
          <span className="brand-mark">dr</span>
          <h1>Your seat in DebugRoom.</h1>
          <p>
            This private invitation opens one learning workspace. No account or
            email required.
          </p>
          {model.error && (
            <div role="alert" className="error-banner">
              {model.error}
            </div>
          )}
          <button
            className="primary"
            onClick={() => void model.joinInvitation()}
            disabled={model.loading}
          >
            Join workspace <ArrowGlyph />
          </button>
        </div>
      </div>
    );
  if (!model.session)
    return (
      <div className="entry-screen">
        <div className="entry-card">
          <span className="brand-mark">dr</span>
          <h1>A room for better questions.</h1>
          <p>
            Run code, inspect its execution, and work through a problem
            together.
          </p>
          {model.error && (
            <div role="alert" className="error-banner">
              {model.error}
              <button onClick={() => window.location.reload()}>
                Try again
              </button>
            </div>
          )}
          {model.config?.localAuth && !model.config.localAutoAuth && (
            <form
              className="local-signin"
              onSubmit={(event) => {
                event.preventDefault();
                void api("/api/auth/local", {
                  method: "POST",
                  body: { token: localKey },
                })
                  .then(() => window.location.reload())
                  .catch((error) => model.setError(error.message));
              }}
            >
              <label className="form-label">
                Local access key
                <input
                  type="password"
                  autoComplete="off"
                  value={localKey}
                  onChange={(e) => setLocalKey(e.target.value)}
                  required
                  minLength={32}
                />
              </label>
              <p className="small-note">
                Use your private local access link, or read the key from
                .data/local-login-token in the project.
              </p>
              <button className="primary">Open local workspace</button>
            </form>
          )}
          {model.config?.githubAuth && (
            <a className="primary" href="/api/auth/github">
              Sign in with GitHub
            </a>
          )}
        </div>
      </div>
    );
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="DebugRoom home">
          <span className="brand-mark">
            d<span>r</span>
          </span>
          DebugRoom<span className="brand-dot">.</span>
        </a>
        <span className="workspace-label">YOUR THINKING SPACE</span>
        <div className="topbar-right">
          <span className="connection-badge">
            <ShieldCheck size={14} /> Isolated execution
          </span>
          <details className="account-menu">
            <summary aria-label="Account menu">
              <span className="avatar" title={model.session.displayName}>
                {model.session.displayName.slice(0, 1).toUpperCase()}
              </span>
            </summary>
            <div>
              <strong>{model.session.displayName}</strong>
              <span>
                {model.session.role === "tutor" ? "Tutor" : "Student"}
              </span>
              {!model.config?.localAutoAuth && (
                <button
                  onClick={() =>
                    void model.flush().then((ok) => {
                      if (ok)
                        return api("/api/auth/logout", { method: "POST" }).then(
                          () => window.location.reload(),
                        );
                    })
                  }
                >
                  Sign out
                </button>
              )}
            </div>
          </details>
        </div>
      </header>
      <div className="app-layout">
        <aside className="workspace-sidebar">
          <div className="sidebar-heading">
            <span>WORKSPACES</span>
            {model.session.role === "tutor" && (
              <button
                className="icon-button"
                aria-label="Create workspace"
                title="Create workspace"
                onClick={() => void model.createWorkspace()}
              >
                <Plus size={16} />
              </button>
            )}
          </div>
          <nav aria-label="Workspaces">
            {model.workspaces.map((item) => (
              <button
                key={item.id}
                className={`workspace-link ${workspace?.id === item.id ? "selected" : ""}`}
                onClick={() => void model.chooseWorkspace(item.id)}
              >
                <FolderOpen size={16} />
                <span>{item.title}</span>
                {workspace?.id === item.id && <span className="selected-dot" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-tip">
              <FlaskConical size={18} />
              <strong>Make a small change.</strong>
              <p>A good experiment starts with one question.</p>
            </div>
            <span className="session-label">
              {model.session.role === "tutor"
                ? "Tutor & solo workspace"
                : "Private student workspace"}
            </span>
          </div>
        </aside>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="live-dot" /> WORKSPACE /{" "}
                {draft?.language === "cpp" ? "C++" : "PYTHON"}
              </div>
              <h1>
                {model.session.role === "tutor" ? (
                  <button
                    className="workspace-title"
                    aria-label="Rename workspace"
                    onClick={() => setRenameTitle(workspace?.title ?? "")}
                  >
                    {workspace?.title ?? "Your workspace"}
                    <Pencil size={14} />
                  </button>
                ) : (
                  (workspace?.title ?? "Your workspace")
                )}
              </h1>
            </div>
            <div className="heading-actions">
              <button
                className="secondary library-open-button"
                onClick={() => setShowLibrary(true)}
              >
                <BookOpen size={15} /> Problem library{" "}
                <span className="count-pill">15</span>
              </button>
              <button
                className={`secondary ${showCollaboration ? "selected" : ""}`}
                onClick={() => setShowCollaboration((value) => !value)}
              >
                <Users size={15} /> Feedback
              </button>
              <span
                className={`save-indicator ${model.saveState}`}
                role="status"
              >
                {model.saveState === "saving" ? (
                  <LoaderCircle className="spin" size={14} />
                ) : model.saveState === "saved" ? (
                  <Check size={14} />
                ) : (
                  <Circle size={10} />
                )}{" "}
                {model.saveState === "saved"
                  ? "All changes saved"
                  : model.saveState === "saving"
                    ? "Saving…"
                    : model.saveState === "conflict"
                      ? "Save conflict"
                      : model.saveState === "error"
                        ? "Not saved"
                        : "Unsaved changes"}
              </span>
              <button
                className={`secondary ${showHistory ? "selected" : ""}`}
                onClick={() => setShowHistory((value) => !value)}
              >
                <History size={15} /> History{" "}
                <span className="count-pill">{model.history.length}</span>
              </button>
            </div>
          </div>
          <select
            className="mobile-workspaces"
            aria-label="Choose workspace"
            value={workspace?.id ?? ""}
            onChange={(event) => void model.chooseWorkspace(event.target.value)}
          >
            {model.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
          {workspace && workspace.branches.length > 1 && (
            <div className="branch-switcher">
              <GitBranch size={14} />
              <label>
                Working in{" "}
                <select
                  aria-label="Choose branch"
                  value={branch?.id}
                  onChange={(e) =>
                    void model.chooseWorkspace(workspace.id, e.target.value)
                  }
                >
                  {workspace.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.kind === "mentor"
                        ? "Private mentor copy"
                        : "Student copy"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {model.error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={17} />
              <span>{model.error}</span>
              {model.saveState === "conflict" ? (
                <>
                  <button onClick={copyDraft}>
                    <Download size={14} /> Download my draft
                  </button>
                  <button onClick={() => setShowReload(true)}>
                    Reload saved draft
                  </button>
                </>
              ) : model.saveState === "error" ? (
                <button onClick={model.retrySave}>Retry save</button>
              ) : (
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => model.setError("")}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          )}
          {showHistory && (
            <section className="history-panel" aria-label="Run history">
              <div className="history-title">
                {model.history.length >= 2 && (
                  <button
                    className="secondary"
                    onClick={() => setShowComparison(true)}
                  >
                    <Columns2 size={14} /> Compare runs
                  </button>
                )}
                <h2>Every run tells a story.</h2>
                <span>
                  Results stay attached to the source and input that produced
                  them.
                </span>
              </div>
              {model.history.length ? (
                <div className="history-list">
                  {model.history.map((item) => (
                    <button
                      key={item.id}
                      className={`history-item ${run?.id === item.id ? "selected" : ""}`}
                      onClick={() => {
                        void model.selectRun(item.id);
                        setSourceView("run");
                      }}
                    >
                      <span
                        className={`run-dot ${item.outcome === "completed" ? "success" : item.outcome ? "warning" : "pending"}`}
                      />
                      <strong>
                        {item.status === "finished"
                          ? outcomeName(item.outcome)
                          : item.status === "running"
                            ? "Running"
                            : "Queued"}
                      </strong>
                      <code>{item.id.slice(0, 8)}</code>
                      <span>
                        {new Date(item.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <small>
                        {item.attempt ? `attempt ${item.attempt}` : "queued"}
                      </small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty-history">
                  Run a program to start an execution history.
                </p>
              )}
            </section>
          )}
          {draft && displayed && (
            <div className="workspace">
              <section className="workbench" aria-label="Code and input">
                {activeProblem && draft && (
                  <ProblemStudyBar
                    key={activeProblem.id}
                    problem={activeProblem}
                    draft={draft}
                    disabled={
                      !!(
                        workspace?.invitationActive &&
                        model.session.role === "tutor" &&
                        branch?.kind === "student" &&
                        !directUnlocked
                      )
                    }
                    onInput={(input) => {
                      model.edit({ input });
                      setSourceView("draft");
                      setBottomTab("input");
                    }}
                    onLibrary={() => setShowLibrary(true)}
                  />
                )}
                <div className="workspace-toolbar">
                  <div
                    className="source-tabs"
                    role="tablist"
                    aria-label="Source view"
                  >
                    <button
                      role="tab"
                      aria-selected={sourceView === "draft"}
                      className={sourceView === "draft" ? "active" : ""}
                      onClick={() => setSourceView("draft")}
                    >
                      <Code2 size={14} /> Working draft
                    </button>
                    <button
                      role="tab"
                      aria-selected={sourceView === "run"}
                      className={sourceView === "run" ? "active" : ""}
                      disabled={!run?.snapshot}
                      onClick={() => setSourceView("run")}
                    >
                      <History size={14} /> Run snapshot
                    </button>
                  </div>
                  <label className="examples-select">
                    <BookOpen size={14} />
                    <select
                      aria-label="Load example"
                      value=""
                      disabled={!!(readonly && sourceView === "draft")}
                      onChange={(e) => loadExample(e.target.value)}
                    >
                      <option value="" disabled>
                        Examples
                      </option>
                      {examples
                        .filter((item) =>
                          model.config?.languages.includes(item.draft.language),
                        )
                        .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.title}
                          </option>
                        ))}
                    </select>
                    <ChevronDown size={12} />
                  </label>
                </div>
                {sourceView === "run" && run?.snapshot ? (
                  <div className="source-banner">
                    <ShieldCheck size={14} />
                    <span>
                      Captured source · revision {run.snapshot.revision} ·
                      read-only
                    </span>
                    <button onClick={() => setSourceView("draft")}>
                      {sameSource(draft, run.snapshot)
                        ? "Edit draft"
                        : "Return to newer draft"}{" "}
                      →
                    </button>
                  </div>
                ) : workspace?.invitationActive &&
                  model.session.role === "tutor" &&
                  branch?.kind === "student" &&
                  !directUnlocked ? (
                  <div className="source-banner caution">
                    <GitBranch size={14} />
                    <span>This is the student copy.</span>
                    <button onClick={() => setShowDirect(true)}>
                      Unlock direct editing
                    </button>
                  </div>
                ) : (
                  <div className="draft-caption">
                    <span>
                      {branch?.name ?? "Workspace"}{" "}
                      <span>· revision {branch?.revision ?? 0}</span>
                    </span>
                    <span>Changes save automatically</span>
                  </div>
                )}
                <div className="editor-panel">
                  <div className="editor-toolbar">
                    <span>
                      <FileCode2 size={14} />{" "}
                      {displayed.language === "cpp" ? "main.cpp" : "main.py"}
                    </span>
                    {sourceView === "draft" ? (
                      <select
                        className="language-select"
                        aria-label="Program language"
                        value={draft.language}
                        disabled={!!readonly}
                        onChange={(e) =>
                          model.edit({
                            language: e.target.value as "python" | "cpp",
                            entryPoint: null,
                          })
                        }
                      >
                        <option value="python">Python 3.14</option>
                        {model.config?.languages.includes("cpp") && (
                          <option value="cpp">C++20</option>
                        )}
                      </select>
                    ) : (
                      <span className="language">
                        {displayed.language === "cpp"
                          ? "C++20 · Clang 18"
                          : "Python 3.14"}
                      </span>
                    )}
                  </div>
                  <Suspense
                    fallback={
                      <div className="editor-loading">Opening editor…</div>
                    }
                  >
                    <CodeEditor
                      key={`${branch?.id}-${sourceView}-${sourceView === "run" ? run?.id : ""}`}
                      value={displayed.code}
                      onChange={(code) => model.edit({ code })}
                      activeLine={highlight}
                      readOnly={!!readonly}
                      language={displayed.language}
                    />
                  </Suspense>
                  <div className="editor-footer">
                    <span>
                      {displayed.code
                        ? displayed.code.trimEnd().split("\n").length
                        : 0}{" "}
                      lines
                    </span>
                    <span>
                      {highlight
                        ? `Inspecting line ${highlight}`
                        : sourceView === "run"
                          ? "Captured source"
                          : "Working draft"}
                    </span>
                    <span>UTF-8</span>
                  </div>
                </div>
                <div className="input-panel">
                  <div className="input-heading">
                    <div
                      className="bottom-tabs"
                      role="tablist"
                      aria-label="Program context"
                    >
                      <button
                        role="tab"
                        aria-selected={bottomTab === "input"}
                        className={bottomTab === "input" ? "active" : ""}
                        onClick={() => setBottomTab("input")}
                      >
                        <Terminal size={14} /> Input
                      </button>
                      <button
                        role="tab"
                        aria-selected={bottomTab === "problem"}
                        className={bottomTab === "problem" ? "active" : ""}
                        onClick={() => setBottomTab("problem")}
                      >
                        <BookOpen size={14} /> Problem
                      </button>
                    </div>
                    <span className="format-badge">
                      {bottomTab === "input" ? "JSON" : "NOTES"}
                    </span>
                  </div>
                  {bottomTab === "input" ? (
                    <>
                      <label className="sr-only" htmlFor="input">
                        Program input
                      </label>
                      <textarea
                        id="input"
                        spellCheck={false}
                        readOnly={!!readonly}
                        value={displayed.input}
                        onChange={(e) => model.edit({ input: e.target.value })}
                      />
                      <p className="input-help">
                        {displayed.language === "cpp" ? (
                          <>
                            A standalone <code>main()</code> reads text from{" "}
                            <code>stdin</code>. Keep <code>args</code> and{" "}
                            <code>kwargs</code> empty.
                          </>
                        ) : (
                          <>
                            Pass positional values in <code>args</code> and
                            named values in <code>kwargs</code>.
                          </>
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <label className="sr-only" htmlFor="problem">
                        Problem description
                      </label>
                      <textarea
                        id="problem"
                        className="problem-notes"
                        readOnly={!!readonly}
                        value={displayed.problem}
                        onChange={(e) =>
                          model.edit({ problem: e.target.value })
                        }
                        placeholder="Describe the question, constraints, examples, and expected result."
                      />
                    </>
                  )}
                  <div className="run-row">
                    <label className="entry-selector">
                      <span>ENTRY POINT</span>
                      <select
                        aria-label="Entry function"
                        value={
                          sourceView === "run"
                            ? (displayed.entryPoint ?? "")
                            : (draft.entryPoint ?? "")
                        }
                        disabled={!!readonly || displayed.language === "cpp"}
                        onChange={(e) =>
                          model.edit({ entryPoint: e.target.value || null })
                        }
                      >
                        <option value="">
                          {displayed.language === "cpp"
                            ? "main()"
                            : sourceView === "run"
                              ? "Automatic selection"
                              : functions.length === 1
                                ? `Auto · ${functions[0]!.name}()`
                                : "Choose automatically"}
                        </option>
                        <option value="__module__">Run as a script</option>
                        {sourceView === "run" &&
                          displayed.entryPoint &&
                          displayed.entryPoint !== "__module__" &&
                          !functions.some(
                            (fn) => fn.name === displayed.entryPoint,
                          ) && (
                            <option value={displayed.entryPoint}>
                              {displayed.entryPoint}()
                            </option>
                          )}
                        {functions.map((fn) => (
                          <option key={fn.name} value={fn.name}>
                            {fn.name}({fn.signature})
                          </option>
                        ))}
                      </select>
                    </label>
                    {pending ? (
                      <button
                        className="stop-button"
                        onClick={() => void model.stopRun()}
                      >
                        <Square size={13} fill="currentColor" /> Stop run
                      </button>
                    ) : (
                      <button
                        className="primary run-button"
                        disabled={
                          !draft.code.trim() ||
                          model.submitting ||
                          model.saveState === "conflict"
                        }
                        onClick={startRun}
                      >
                        <Play size={15} fill="currentColor" />{" "}
                        {model.submitting
                          ? "Starting…"
                          : sourceView === "run"
                            ? "Run draft"
                            : "Run code"}
                        <kbd>⌘ ↵</kbd>
                      </button>
                    )}
                  </div>
                  {discoveryError && sourceView === "draft" && (
                    <p className="discovery-note">
                      Function detection: {discoveryError}
                    </p>
                  )}
                </div>
              </section>
              <TraceInspector
                autoPlayRunId={watchRunId}
                run={run}
                index={index}
                onIndex={setIndex}
                onViewSource={viewRunSource}
              />
            </div>
          )}
          {showCollaboration && (
            <CollaborationPanel
              model={model}
              line={event?.line ?? 1}
              onEditDraft={() => setSourceView("draft")}
            />
          )}
          {showComparison && (
            <RunComparison
              runs={model.history}
              onClose={() => setShowComparison(false)}
            />
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} /> Your runs are isolated. Your history
              stays yours.
            </span>
            <span>
              {workspace?.expiresAt ? (
                <>
                  Expires{" "}
                  {new Date(workspace.expiresAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}{" "}
                  after inactivity
                </>
              ) : (
                "Stored locally until you delete it"
              )}
            </span>
          </footer>
        </main>
      </div>
      {renameTitle !== null && (
        <Modal title="Name this workspace" onClose={() => setRenameTitle(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void model.renameWorkspace(renameTitle).then((saved) => {
                if (saved) setRenameTitle(null);
              });
            }}
          >
            <label className="form-label">
              Workspace name
              <input
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
                maxLength={120}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setRenameTitle(null)}
              >
                Cancel
              </button>
              <button className="primary">Save name</button>
            </div>
          </form>
        </Modal>
      )}
      {showLibrary && (
        <ProblemLibrary
          onClose={() => setShowLibrary(false)}
          onOpen={openProblem}
          canCreate={model.session.role === "tutor"}
        />
      )}
      {showReload && (
        <Modal
          title="Reload the saved draft?"
          onClose={() => setShowReload(false)}
        >
          <p className="dialog-description">
            This replaces your unsaved text with the latest server version.
            Download your draft first if you want to keep it.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setShowReload(false)}>
              Keep editing
            </button>
            <button
              className="primary"
              onClick={() => {
                setShowReload(false);
                void model.reloadDraft();
              }}
            >
              Reload saved draft
            </button>
          </div>
        </Modal>
      )}
      {showDirect && (
        <Modal
          title="Edit the student copy directly?"
          onClose={() => setShowDirect(false)}
        >
          <p className="dialog-description">
            A snapshot of the student's current work will be preserved before
            each of your saves. Your private mentor copy is the usual place for
            experiments.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setShowDirect(false)}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => {
                setShowDirect(false);
                setDirectUnlocked(true);
                model.confirmDirectEdit();
              }}
            >
              Preserve & unlock
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ArrowGlyph() {
  return <span aria-hidden="true">→</span>;
}
