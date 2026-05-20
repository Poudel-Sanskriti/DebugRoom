import { useState } from "react";
import { ArrowUpRight, BookOpen } from "lucide-react";
import type { Draft } from "@debugroom/contracts";
import { problemInput, type PracticeProblem } from "../problems";
import "./problem-library.css";

export default function ProblemStudyBar({
  problem,
  draft,
  disabled,
  onInput,
  onLibrary,
}: {
  problem: PracticeProblem;
  draft: Draft;
  disabled: boolean;
  onInput: (input: string) => void;
  onLibrary: () => void;
}) {
  const [showGuide, setShowGuide] = useState(false);
  const current = problem.cases.findIndex((_, index) => {
    try {
      return (
        JSON.stringify(JSON.parse(draft.input)) ===
        JSON.stringify(JSON.parse(problemInput(problem, index)))
      );
    } catch {
      return false;
    }
  });
  return (
    <section className="study-bar" aria-label="Practice guide">
      <div className="study-bar-main">
        <button
          className="study-title"
          onClick={() => setShowGuide((value) => !value)}
          aria-expanded={showGuide}
        >
          <BookOpen size={15} />
          <span>
            #{problem.number} · {problem.title}
          </span>
          <small>{showGuide ? "Hide guide" : "Study guide"}</small>
        </button>
        <label>
          Input
          <select
            aria-label="Practice test case"
            disabled={disabled}
            value={current}
            onChange={(event) =>
              onInput(problemInput(problem, Number(event.target.value)))
            }
          >
            {current < 0 && <option value={-1}>Custom input</option>}
            {problem.cases.map((item, index) => (
              <option value={index} key={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button className="text-button" onClick={onLibrary}>
          All 15 problems ↗
        </button>
      </div>
      {showGuide && (
        <div className="study-guide-content">
          <p>{problem.summary}</p>
          <p>
            <strong>Watch:</strong> {problem.watch}
          </p>
          {current >= 0 && (
            <p>
              <strong>Expected:</strong>{" "}
              <code>{JSON.stringify(problem.cases[current]!.expected)}</code>{" "}
              <span className="muted">for the selected input</span>
            </p>
          )}
          <details>
            <summary>Reveal hints</summary>
            <ol>
              {problem.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ol>
          </details>
          <a href={problem.url} target="_blank" rel="noreferrer">
            Original problem <ArrowUpRight size={12} />
          </a>
        </div>
      )}
    </section>
  );
}
