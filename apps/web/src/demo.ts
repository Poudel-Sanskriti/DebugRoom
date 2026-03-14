// Hand-written observations, not interpreter output. Line events are BEFORE execution.
export type TraceStep = {
  line: number;
  locals: Readonly<Record<string, number>>;
};
export const demo = {
  problem:
    "Add two numbers\n\nReturn the sum of a and b. For a = 2 and b = 3, the expected result is 5.",
  code: "def add(a, b):\n    total = a + b\n    return total\n",
  input: '{\n  "args": [2, 3],\n  "kwargs": {}\n}',
  steps: [
    { line: 2, locals: { a: 2, b: 3 } },
    { line: 3, locals: { a: 2, b: 3, total: 5 } },
  ] satisfies TraceStep[],
};
