import type { Draft } from "@debugroom/contracts";
import { arrayProblems } from "./arrays";
import { structureProblems } from "./structures";
import type { PracticeProblem } from "./types";

const order = [
  1, 217, 242, 121, 125, 283, 704, 20, 206, 21, 141, 226, 169, 136, 70,
];
export const problems = [...arrayProblems, ...structureProblems].sort(
  (a, b) => order.indexOf(a.number) - order.indexOf(b.number),
);
export const problemInput = (problem: PracticeProblem, caseIndex = 0) =>
  JSON.stringify({ args: problem.cases[caseIndex]!.args, kwargs: {} }, null, 2);
const heading = (problem: PracticeProblem) =>
  `LeetCode #${problem.number} · ${problem.title}`;
export function problemDraft(
  problem: PracticeProblem,
  mode: "practice" | "solution",
  caseIndex = 0,
): Draft {
  return {
    language: "python",
    entryPoint: problem.entryPoint,
    code: mode === "practice" ? problem.starter : problem.solution,
    input: problemInput(problem, caseIndex),
    problem: `${heading(problem)}\n\n${problem.summary}\n\nConstraints\n${problem.constraints.map((text) => `• ${text}`).join("\n")}\n\nWatch for\n${problem.watch}\n\nPractice cases\n${problem.cases.map((item) => `${item.name}: ${JSON.stringify(item.args)} → ${JSON.stringify(item.expected)}`).join("\n")}\n\nOriginal problem: ${problem.url}`,
  };
}
export function problemForDraft(draft: Draft | null | undefined) {
  return problems.find((problem) =>
    draft?.problem.startsWith(heading(problem) + "\n"),
  );
}
export type { PracticeProblem } from "./types";
