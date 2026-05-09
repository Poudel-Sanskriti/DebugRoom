import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { TraceEvent, TraceValue } from "@debugroom/contracts";
import ExecutionStage from "./ExecutionStage";

const scalar = (value: number): TraceValue => ({
  kind: "scalar",
  type: "int",
  value: String(value),
});
function observation(values: number[], mid: number): TraceEvent {
  return {
    index: 1,
    kind: "line",
    line: 2,
    frameId: "f1",
    frames: [
      {
        id: "f1",
        function: "search",
        line: 2,
        locals: {
          nums: { kind: "ref", id: "o1" },
          low: scalar(0),
          high: scalar(values.length - 1),
          mid: scalar(mid),
        },
        changes: {},
        truncated: false,
      },
    ],
    objects: {
      o1: {
        id: "o1",
        type: "list",
        items: values.map(scalar),
        length: values.length,
        truncated: false,
      },
    },
  };
}
function stage(event: TraceEvent) {
  return (
    <ExecutionStage
      event={event}
      frame={event.frames[0]}
      code="def search(nums):\n    mid = 1"
      speed={700}
      index={1}
      total={10}
    />
  );
}
it("moves existing value tiles and markers and restores the exact earlier state when seeking backward", () => {
  const before = observation([5, 2, 2], 0),
    after = observation([2, 5, 2], 1);
  const { rerender, container } = render(stage(before));
  const tile = screen.getByLabelText("Index 0: 5");
  expect(tile).toHaveStyle({ transform: "translateX(0%)" });
  rerender(stage(after));
  expect(screen.getByLabelText("Index 1: 5")).toBe(tile);
  expect(tile).toHaveStyle({ transform: "translateX(100%)" });
  expect(
    [...container.querySelectorAll(".stage-pointer")].find((node) =>
      node.textContent?.includes("mid"),
    ),
  ).toHaveStyle({ transform: "translateX(100%)" });
  expect(container.querySelectorAll(".stage-cell")).toHaveLength(3);
  rerender(stage(before));
  expect(tile).toHaveStyle({ transform: "translateX(0%)" });
  expect(screen.getByLabelText("Index 2: 2")).toBeInTheDocument();
});
it("lets the learner turn index markers off and on without altering captured values", () => {
  const { container } = render(stage(observation([1, 3, 5], -1)));
  fireEvent.click(screen.getByText("Index markers", { selector: "summary" }));
  const marker = screen.getByRole("button", { name: "mid" });
  expect(container.querySelector(".is-beyond")).toHaveTextContent("mid-1");
  fireEvent.click(marker);
  expect(marker).toHaveAttribute("aria-pressed", "false");
  expect(container.querySelector(".is-beyond")).toBeNull();
  expect(screen.getByLabelText("Captured values")).toHaveTextContent("mid-1");
});
it("shows active recursive frames and only displays a return when captured", () => {
  const event = observation([], 0);
  event.frames = [1, 2, 3].map((n) => ({
    id: `f${n}`,
    function: "factorial",
    line: 2,
    locals: { n: scalar(4 - n) },
    changes: {},
    truncated: false,
  }));
  event.frameId = "f3";
  event.kind = "return";
  event.returnValue = scalar(1);
  render(stage(event));
  expect(screen.getAllByText("factorial()")).toHaveLength(3);
  expect(screen.getByText("↗ Return value")).toBeInTheDocument();
});
