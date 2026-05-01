import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Branch,
  Draft,
  Run,
  Session,
  Workspace,
} from "@debugroom/contracts";
import { api, ClientError, setCsrf, type RuntimeConfig } from "../api";

export type SaveState = "saved" | "unsaved" | "saving" | "conflict" | "error";
type Current = {
  workspaceId: string;
  branchId: string;
  draft: Draft;
  saved: Draft;
  revision: number;
  confirmDirectEdit: boolean;
};
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The request could not be completed";

export function useWorkspace() {
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [config, setConfig] = useState<RuntimeConfig | null>(null),
    [session, setSession] = useState<Session | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<Run[]>([]),
    [run, setRun] = useState<Run | null>(null),
    [submitting, setSubmitting] = useState(false);
  const current = useRef<Current | null>(null),
    saving = useRef<Promise<boolean> | null>(null),
    blocked = useRef(false),
    runRequest = useRef(0);
  const [invitation, setInvitation] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("invite"),
  );
  const localAccess = useRef(
    new URLSearchParams(window.location.hash.slice(1)).get("local"),
  );
  const initialization = useRef<Promise<{
    config: RuntimeConfig;
    session: Session | null;
    workspaces: Workspace[];
  }> | null>(null);

  const installBranch = useCallback((w: Workspace, b: Branch) => {
    current.current = {
      workspaceId: w.id,
      branchId: b.id,
      draft: b.draft,
      saved: b.draft,
      revision: b.revision,
      confirmDirectEdit: false,
    };
    blocked.current = false;
    setWorkspace(w);
    setBranch(b);
    setDraft(b.draft);
    setSaveState("saved");
    setError("");
  }, []);
  useEffect(() => {
    let alive = true;
    if (invitation || localAccess.current)
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    initialization.current ??= (async () => {
      const configuration = await api<RuntimeConfig>("/api/config");
      if (invitation)
        return { config: configuration, session: null, workspaces: [] };
      let identity: Session | null = null;
      if (configuration.localAuth && localAccess.current)
        await api("/api/auth/local", {
          method: "POST",
          body: { token: localAccess.current },
        });
      try {
        identity = await api<Session>("/api/session");
      } catch (error) {
        if (!(error instanceof ClientError && error.status === 401))
          throw error;
      }
      if (!identity)
        return { config: configuration, session: null, workspaces: [] };
      setCsrf(identity.csrf);
      const { workspaces: list } = await api<{ workspaces: Workspace[] }>(
        "/api/workspaces",
      );
      if (!list.length && identity.role === "tutor")
        list.push(
          await api<Workspace>("/api/workspaces", {
            method: "POST",
            body: { title: "My first workspace" },
          }),
        );
      return { config: configuration, session: identity, workspaces: list };
    })();
    initialization.current
      .then((data) => {
        if (!alive) return;
        setConfig(data.config);
        setSession(data.session);
        setWorkspaces(data.workspaces);
        if (data.workspaces[0]) {
          const w = data.workspaces[0];
          const b =
            w.branches.find((b) =>
              data.session?.role === "tutor" && w.invitationActive
                ? b.kind === "mentor"
                : b.kind === "student",
            ) ?? w.branches[0]!;
          installBranch(w, b);
        }
        setLoading(false);
      })
      .catch((error) => {
        if (alive) {
          setError(message(error));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [installBranch]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (blocked.current) return false;
    const task = (async () => {
      while (
        current.current &&
        !same(current.current.draft, current.current.saved)
      ) {
        const before = current.current,
          sent = before.draft;
        setSaveState("saving");
        try {
          const saved = await api<Branch>(
            `/api/branches/${before.branchId}/draft`,
            {
              method: "PUT",
              body: {
                expectedRevision: before.revision,
                draft: sent,
                confirmDirectEdit: before.confirmDirectEdit,
              },
            },
          );
          if (current.current?.branchId !== before.branchId) return true;
          current.current = {
            ...current.current,
            revision: saved.revision,
            saved: sent,
          };
          setBranch((previous) =>
            previous
              ? {
                  ...previous,
                  revision: saved.revision,
                  updatedAt: saved.updatedAt,
                }
              : previous,
          );
          setWorkspace((previous) =>
            previous
              ? {
                  ...previous,
                  branches: previous.branches.map((b) =>
                    b.id === saved.id ? saved : b,
                  ),
                }
              : previous,
          );
        } catch (error) {
          blocked.current = true;
          setSaveState(
            error instanceof ClientError && error.status === 409
              ? "conflict"
              : "error",
          );
          setError(message(error));
          return false;
        }
      }
      setSaveState("saved");
      return true;
    })();
    saving.current = task;
    try {
      return await task;
    } finally {
      saving.current = null;
    }
  }, []);

  const edit = useCallback((patch: Partial<Draft>) => {
    if (!current.current) return;
    const next = { ...current.current.draft, ...patch };
    current.current = { ...current.current, draft: next };
    setDraft(next);
    if (!blocked.current)
      setSaveState(same(next, current.current.saved) ? "saved" : "unsaved");
  }, []);
  useEffect(() => {
    if (saveState !== "unsaved") return;
    const timer = setTimeout(() => void flush(), 650);
    return () => clearTimeout(timer);
  }, [draft, saveState, flush]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (
        current.current &&
        !same(current.current.draft, current.current.saved)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const refreshHistory = useCallback(async (id: string) => {
    const list = await api<{ runs: Run[] }>(`/api/workspaces/${id}/runs`);
    if (current.current?.workspaceId === id) {
      setHistory(list.runs);
      setHistoryHasMore(list.runs.length === 100);
    }
    return list.runs;
  }, []);
  const loadOlderRuns = useCallback(async () => {
    if (!workspace || !history.length) return;
    try {
      const page = await api<{ runs: Run[] }>(
        `/api/workspaces/${workspace.id}/runs?before=${history.at(-1)!.id}`,
      );
      setHistory((previous) => [
        ...previous,
        ...page.runs.filter(
          (run) => !previous.some((item) => item.id === run.id),
        ),
      ]);
      setHistoryHasMore(page.runs.length === 100);
    } catch (error) {
      setError(message(error));
    }
  }, [workspace?.id, history]);
  const selectRun = useCallback(async (id: string) => {
    const request = ++runRequest.current;
    try {
      const selected = await api<Run>(`/api/runs/${id}`);
      if (request === runRequest.current) setRun(selected);
    } catch (error) {
      setError(message(error));
    }
  }, []);
  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    refreshHistory(workspace.id)
      .then((runs) => {
        const latest = runs.find(
          (run) => run.branchId === current.current?.branchId,
        );
        if (alive && latest) void selectRun(latest.id);
      })
      .catch((error) => {
        if (alive) setError(message(error));
      });
    return () => {
      alive = false;
    };
  }, [workspace?.id, branch?.id, refreshHistory, selectRun]);
  useEffect(() => {
    if (!run || run.status === "finished") return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const updated = await api<Run>(`/api/runs/${run.id}`);
        if (alive) {
          setRun((current) =>
            current?.id === updated.id &&
            !(current.status === "finished" && updated.status !== "finished")
              ? updated
              : current,
          );
          if (updated.status === "finished")
            await refreshHistory(updated.workspaceId);
        }
      } catch (error) {
        if (alive) setError(message(error));
      }
    }, 650);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [run?.id, run?.status, refreshHistory]);

  const chooseWorkspace = useCallback(
    async (id: string, branchId?: string) => {
      if (!(await flush())) return;
      try {
        const w = await api<Workspace>(`/api/workspaces/${id}`);
        const b =
          w.branches.find((b) => b.id === branchId) ??
          w.branches.find((b) =>
            session?.role === "tutor" && w.invitationActive
              ? b.kind === "mentor"
              : b.kind === "student",
          ) ??
          w.branches[0]!;
        runRequest.current++;
        setRun(null);
        setHistory([]);
        installBranch(w, b);
      } catch (error) {
        setError(message(error));
      }
    },
    [flush, installBranch, session?.role],
  );
  const createWorkspace = useCallback(
    async (title = "Untitled workspace") => {
      if (!(await flush())) return;
      try {
        const w = await api<Workspace>("/api/workspaces", {
          method: "POST",
          body: { title },
        });
        setWorkspaces((previous) => [w, ...previous]);
        setRun(null);
        setHistory([]);
        installBranch(w, w.branches[0]!);
      } catch (error) {
        setError(message(error));
      }
    },
    [flush, installBranch],
  );
  const renameWorkspace = useCallback(async (title: string) => {
    if (!current.current) return false;
    try {
      const updated = await api<Workspace>(
        `/api/workspaces/${current.current.workspaceId}`,
        { method: "PATCH", body: { title } },
      );
      setWorkspace(updated);
      setWorkspaces((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
      return true;
    } catch (error) {
      setError(message(error));
      return false;
    }
  }, []);
  const startRun = useCallback(async () => {
    if (submitting || !current.current) return;
    setSubmitting(true);
    setError("");
    try {
      if (!(await flush())) return;
      const c = current.current;
      const captured = await api<Run>("/api/runs", {
        method: "POST",
        body: {
          branchId: c.branchId,
          draft: c.draft,
          expectedRevision: c.revision,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      runRequest.current++;
      setRun(captured);
      setHistory((previous) => [captured, ...previous]);
    } catch (error) {
      setError(message(error));
    } finally {
      setSubmitting(false);
    }
  }, [flush, submitting]);
  const stopRun = useCallback(async () => {
    if (!run) return;
    try {
      await api(`/api/runs/${run.id}/cancel`, { method: "POST" });
      await selectRun(run.id);
    } catch (error) {
      setError(message(error));
    }
  }, [run?.id, selectRun]);
  const reloadDraft = useCallback(async () => {
    if (!current.current) return;
    try {
      const w = await api<Workspace>(
        `/api/workspaces/${current.current.workspaceId}`,
      );
      const b = w.branches.find((b) => b.id === current.current!.branchId)!;
      installBranch(w, b);
    } catch (error) {
      setError(message(error));
    }
  }, [installBranch]);
  const retrySave = useCallback(() => {
    blocked.current = false;
    setError("");
    setSaveState("unsaved");
  }, []);
  const joinInvitation = useCallback(async () => {
    if (!invitation) return;
    setLoading(true);
    setError("");
    try {
      const { workspaceId } = await api<{ workspaceId: string }>(
        "/api/invitations/redeem",
        { method: "POST", body: { token: invitation } },
      );
      const identity = await api<Session>("/api/session");
      setCsrf(identity.csrf);
      setSession(identity);
      const w = await api<Workspace>(`/api/workspaces/${workspaceId}`);
      setWorkspaces([w]);
      installBranch(
        w,
        w.branches.find((b) => b.kind === "student")!,
      );
      setInvitation(null);
    } catch (error) {
      setError(message(error));
    } finally {
      setLoading(false);
    }
  }, [invitation, installBranch]);
  const confirmDirectEdit = useCallback(() => {
    if (current.current) current.current.confirmDirectEdit = true;
    blocked.current = false;
    setError("");
    setSaveState(
      current.current && same(current.current.draft, current.current.saved)
        ? "saved"
        : "unsaved",
    );
  }, []);
  const refreshWorkspace = useCallback(async () => {
    if (!current.current) return;
    const w = await api<Workspace>(
      `/api/workspaces/${current.current.workspaceId}`,
    );
    setWorkspace(w);
    const latest = w.branches.find((b) => b.id === current.current?.branchId);
    if (
      latest &&
      current.current &&
      latest.revision > current.current.revision &&
      same(current.current.draft, current.current.saved) &&
      !saving.current
    ) {
      current.current = {
        ...current.current,
        draft: latest.draft,
        saved: latest.draft,
        revision: latest.revision,
      };
      setDraft(latest.draft);
      setBranch(latest);
    }
    setWorkspaces((previous) =>
      previous.map((item) => (item.id === w.id ? w : item)),
    );
  }, []);
  return {
    config,
    session,
    workspaces,
    workspace,
    branch,
    draft,
    saveState,
    error,
    loading,
    history,
    historyHasMore,
    run,
    submitting,
    invitation,
    edit,
    flush,
    chooseWorkspace,
    createWorkspace,
    renameWorkspace,
    startRun,
    stopRun,
    selectRun,
    loadOlderRuns,
    reloadDraft,
    retrySave,
    joinInvitation,
    confirmDirectEdit,
    refreshWorkspace,
    setError,
  };
}
