import { useState } from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import TraceInspector from "./TraceInspector";
import fixture from "../test-fixtures/loop.json";
import type { Run } from "@debugroom/contracts";
const run = {
  id: "run",
  status: "finished",
  outcome: "completed",
  snapshot: { ...fixture.draft, revision: 1 },
  result: fixture.result,
} as Run;
function Playback() {
  const [index, setIndex] = useState(0);
  return (
    <TraceInspector
      run={run}
      index={index}
      onIndex={setIndex}
      onViewSource={() => {}}
    />
  );
}
it("plays captured observations at the selected speed and pauses without changing the trace", async () => {
  vi.useFakeTimers();
  try {
    render(<Playback />);
    fireEvent.change(screen.getByRole("combobox", { name: "Playback speed" }), {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Play playback" }));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(
      screen.getByRole("slider", { name: "Execution timeline" }),
    ).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "Pause playback" }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByRole("slider", { name: "Execution timeline" }),
    ).toHaveValue("1");
    expect(fixture.result.steps[0]!.index).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
