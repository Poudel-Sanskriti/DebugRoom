export type ProblemCase = {
  name: string;
  args: unknown[];
  expected: unknown;
};

export type PracticeProblem = {
  id: string;
  number: number;
  title: string;
  pattern: string;
  difficulty: "Easy";
  url: string;
  summary: string;
  constraints: string[];
  hints: string[];
  time: string;
  space: string;
  watch: string;
  entryPoint: string;
  solution: string;
  starter: string;
  cases: ProblemCase[];
};
