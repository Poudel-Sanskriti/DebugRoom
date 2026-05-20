import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Code2,
  Play,
  Search,
  Sparkles,
} from "lucide-react";
import Modal from "./Modal";
import { problems, type PracticeProblem } from "../problems";
import "./problem-library.css";

export default function ProblemLibrary({
  onClose,
  onOpen,
  canCreate,
}: {
  onClose: () => void;
  onOpen: (
    problem: PracticeProblem,
    mode: "practice" | "solution",
    caseIndex: number,
  ) => Promise<boolean>;
  canCreate: boolean;
}) {
  const [query, setQuery] = useState("");
  const [pattern, setPattern] = useState("All patterns");
  const [selectedId, setSelectedId] = useState(problems[0]!.id);
  const [caseIndex, setCaseIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patterns = [...new Set(problems.map((problem) => problem.pattern))];
  const filtered = useMemo(
    () =>
      problems.filter(
        (problem) =>
          (pattern === "All patterns" || problem.pattern === pattern) &&
          `${problem.number} ${problem.title} ${problem.pattern}`
            .toLowerCase()
            .includes(query.toLowerCase().trim()),
      ),
    [query, pattern],
  );
  const selected =
    filtered.find((problem) => problem.id === selectedId) ?? filtered[0];
  const selectedCase = selected?.cases[caseIndex] ?? selected?.cases[0];
  async function open(mode: "practice" | "solution") {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      if (
        await onOpen(
          selected,
          mode,
          Math.min(caseIndex, selected.cases.length - 1),
        )
      )
        onClose();
      else
        setError(
          "The workspace could not be opened. Close the library to review the save or connection message.",
        );
    } catch {
      setError("Could not open this problem. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Problem library" onClose={busy ? () => {} : onClose} wide>
      <div className="library-hero">
        <div>
          <span className="library-eyebrow">
            <Sparkles size={13} /> YOUR FIRST 15
          </span>
          <h3>
            Understand the pattern.
            <br />
            Then make it yours.
          </h3>
          <p>
            Fifteen easy interview classics. Real code, visible state, and room
            to experiment.
          </p>
        </div>
        <div className="library-stat">
          <strong>15</strong>
          <span>Easy problems</span>
          <small>Python · step by step</small>
        </div>
      </div>
      <div className="library-filters">
        <label>
          <Search size={15} />
          <input
            aria-label="Search problems"
            placeholder="Search a problem or pattern…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCaseIndex(0);
            }}
          />
        </label>
        <select
          aria-label="Filter by pattern"
          value={pattern}
          onChange={(e) => {
            setPattern(e.target.value);
            setCaseIndex(0);
          }}
        >
          <option>All patterns</option>
          {patterns.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <span>{filtered.length} problems</span>
      </div>
      <div className="library-content">
        <nav className="library-list" aria-label="Practice problems">
          {filtered.map((problem) => (
            <button
              key={problem.id}
              aria-pressed={selected?.id === problem.id}
              onClick={() => {
                setSelectedId(problem.id);
                setCaseIndex(0);
              }}
            >
              <span className="library-number">
                {String(problems.indexOf(problem) + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{problem.title}</strong>
                <small>
                  #{problem.number} · {problem.pattern}
                </small>
              </span>
              <span className="library-easy">Easy</span>
            </button>
          ))}
          {!filtered.length && (
            <p className="library-empty">
              No matches. Try another title or choose All patterns.
            </p>
          )}
        </nav>
        {selected && (
          <article className="library-detail" aria-label="Selected problem">
            <div className="library-detail-heading">
              <span className="library-easy">Easy</span>
              <span>{selected.pattern}</span>
              <a href={selected.url} target="_blank" rel="noreferrer">
                LeetCode <ArrowUpRight size={13} />
              </a>
            </div>
            <h3>{selected.title}</h3>
            <p>{selected.summary}</p>
            <div className="library-watch">
              <Play size={16} />
              <div>
                <strong>What you’ll see</strong>
                <p>{selected.watch}</p>
              </div>
            </div>
            <label className="library-case-label">
              Try an input
              <select
                aria-label="Preview test case"
                value={selected.cases.indexOf(selectedCase!)}
                onChange={(e) => setCaseIndex(Number(e.target.value))}
              >
                {selected.cases.map((item, index) => (
                  <option value={index} key={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="library-example">
              <span>Arguments</span>
              <pre>{JSON.stringify(selectedCase?.args)}</pre>
              <span>Expected result</span>
              <pre>{JSON.stringify(selectedCase?.expected)}</pre>
            </div>
            <details className="library-disclosure">
              <summary>Constraints</summary>
              <ul>
                {selected.constraints.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
            <details className="library-disclosure" key={selected.id}>
              <summary>Need a hint?</summary>
              {selected.hints.map((hint, i) => (
                <details key={hint}>
                  <summary>Hint {i + 1}</summary>
                  <p>{hint}</p>
                </details>
              ))}
            </details>
            <div className="library-complexity">
              <span>Walkthrough complexity</span>
              <strong>{selected.time} time</strong>
              <strong>{selected.space} space</strong>
            </div>
            {error && (
              <p role="alert" className="library-error">
                {error}
              </p>
            )}
            {canCreate ? (
              <>
                <div className="library-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void open("practice")}
                  >
                    <Code2 size={15} /> Practice yourself
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void open("solution")}
                  >
                    <Play size={15} />
                    {busy ? "Opening…" : "Watch solution"}
                  </button>
                </div>
                <p className="library-footnote">
                  <BookOpen size={12} /> Opens in a new saved workspace.
                  Practice starts with a method stub.
                </p>
              </>
            ) : (
              <p className="library-footnote">
                Browse the cases and hints here. Ask your tutor to open a
                practice workspace.
              </p>
            )}
          </article>
        )}
      </div>
    </Modal>
  );
}
