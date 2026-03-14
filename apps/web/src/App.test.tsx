import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("fixture workspace", () => {
  it("starts empty with execution and stepping unavailable", () => {
    render(<App />);
    expect(
      screen.getByRole("textbox", { name: "Python code" }),
    ).toHaveTextContent("# Paste your Python code here");
    expect(screen.getByLabelText(/Input/)).toHaveValue("");
    expect(screen.getByLabelText(/Problem/)).toHaveValue("");
    expect(screen.getByRole("button", { name: /Run code/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("No trace loaded");
  });

  it("keeps the selected line, variables, highlight and boundaries in sync", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("button", { name: /Load demo/ }));
    const inspector = within(
      screen.getByRole("region", { name: "Execution inspector" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 2");
    expect(screen.getByTestId("current-line")).toHaveTextContent("Line 2");
    expect(container.querySelector(".cm-trace-line")).toHaveTextContent(
      "total = a + b",
    );
    expect(
      inspector.queryByText("total", { selector: "code" }),
    ).not.toBeInTheDocument();
    const previous = screen.getByRole("button", { name: /Previous/ });
    const next = screen.getByRole("button", { name: /Next/ });
    expect(previous).toBeDisabled();
    await user.click(previous);
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 2");
    await user.click(next);
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 2");
    expect(screen.getByTestId("current-line")).toHaveTextContent("Line 3");
    expect(container.querySelector(".cm-trace-line")).toHaveTextContent(
      "return total",
    );
    expect(
      inspector.getByText("total", { selector: "code" }).parentElement,
    ).toHaveTextContent("total5int");
    expect(next).toBeDisabled();
    await user.click(next);
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 2");
    await user.click(previous);
    expect(screen.getByTestId("current-line")).toHaveTextContent("Line 2");
    expect(
      inspector.queryByText("total", { selector: "code" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run code/ })).toBeDisabled();
  });

  it("clears stale playback on input edits and reloads the demo at its first step", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("button", { name: /Load demo/ }));
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.type(screen.getByLabelText(/Input/), " ");
    expect(screen.getByRole("status")).toHaveTextContent("No trace loaded");
    expect(container.querySelector(".cm-trace-line")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Load demo/ }));
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 2");
  });

  it("clears stale playback on code edits but leaves problem notes independent", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Load demo/ }));
    await user.type(screen.getByLabelText(/Problem/), " More context.");
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 2");
    const editor = screen.getByRole("textbox", { name: "Python code" });
    editor.focus();
    await user.keyboard("{End} ");
    expect(screen.getByRole("status")).toHaveTextContent("No trace loaded");
  });
});
