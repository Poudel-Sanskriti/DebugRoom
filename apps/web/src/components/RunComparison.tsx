import { useEffect, useState } from "react";
import type { Run } from "@debugroom/contracts";
import { api } from "../api";
import Modal from "./Modal";
import { outcomeName } from "./TraceInspector";
import { valueText } from "./ValueView";

export default function RunComparison({
  runs,
  onClose,
}: {
  runs: Run[];
  onClose: () => void;
}) {
  const [leftId, setLeftId] = useState(runs[1]?.id ?? runs[0]?.id ?? ""),
    [rightId, setRightId] = useState(runs[0]?.id ?? "");
  const [left, setLeft] = useState<Run | null>(null),
    [right, setRight] = useState<Run | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    Promise.all([
      api<Run>(`/api/runs/${leftId}`),
      api<Run>(`/api/runs/${rightId}`),
    ])
      .then(([l, r]) => {
        if (alive) {
          setLeft(l);
          setRight(r);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [leftId, rightId]);
  const leftLines = left?.snapshot?.code.split("\n") ?? [],
    rightLines = right?.snapshot?.code.split("\n") ?? [];
  const count = Math.min(Math.max(leftLines.length, rightLines.length), 1000);
  return (
    <Modal title="Compare two experiments" onClose={onClose} wide>
      <p className="dialog-description">
        Each column shows the exact source, input, and observed result of that
        run.
      </p>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      <div className="comparison-selectors">
        {[leftId, rightId].map((value, index) => (
          <label key={index}>
            {index === 0 ? "Earlier experiment" : "Compare with"}
            <select
              aria-label={
                index === 0 ? "First run to compare" : "Second run to compare"
              }
              value={value}
              onChange={(e) =>
                (index === 0 ? setLeftId : setRightId)(e.target.value)
              }
            >
              {runs.map((run) => (
                <option value={run.id} key={run.id}>
                  {run.id.slice(0, 8)} · {outcomeName(run.outcome)} ·{" "}
                  {new Date(run.createdAt).toLocaleTimeString()}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {left && right && (
        <>
          <div className="comparison-results">
            {[left, right].map((run, index) => (
              <div key={index}>
                <strong>{outcomeName(run.outcome)}</strong>
                <p>
                  Revision {run.snapshot?.revision} ·{" "}
                  {run.result?.steps.length ?? 0} steps
                </p>
                <label>Input</label>
                <pre>{run.snapshot?.input}</pre>
                <label>
                  {run.snapshot?.language === "cpp"
                    ? "Exit code"
                    : "Return value"}
                </label>
                <pre>
                  {valueText(
                    run.result?.returnValue,
                    run.result?.objects ?? {},
                  )}
                </pre>
                <label>Output</label>
                <pre>{run.result?.stdout || "No output printed."}</pre>
                {run.result?.error && (
                  <p className="comparison-error">
                    {run.result.error.type}: {run.result.error.message}
                  </p>
                )}
              </div>
            ))}
          </div>
          <h3 className="comparison-source-title">Source by line</h3>
          <div className="source-comparison">
            {Array.from({ length: count }, (_, index) => (
              <div
                key={index}
                className={
                  leftLines[index] !== rightLines[index] ? "different" : ""
                }
              >
                <small>{index + 1}</small>
                <code>{leftLines[index] ?? ""}</code>
                <small>{index + 1}</small>
                <code>{rightLines[index] ?? ""}</code>
              </div>
            ))}
          </div>
          {Math.max(leftLines.length, rightLines.length) > count && (
            <p className="small-note">Showing the first 1,000 lines.</p>
          )}
        </>
      )}
    </Modal>
  );
}
