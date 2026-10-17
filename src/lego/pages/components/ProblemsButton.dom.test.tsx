// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { problem } from "../../problems";
import { ProblemsButton } from "./ProblemsButton";

const items = [
  problem("document", "error", "The root piece is missing."),
  problem("balance", "warning", "Looks as if it would tip.", ["a", "b"]),
  problem("pack", "warning", "An atlas is missing."),
];

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("ProblemsButton", () => {
  it("shows no button for a unit with no problems", () => {
    render(<ProblemsButton problems={[]} statuses={{}} onSelect={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the count on the button", () => {
    render(
      <ProblemsButton problems={items} statuses={{}} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Problems/ }).textContent).toBe(
      "3",
    );
  });

  it("hands the problem to the page when its row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ProblemsButton problems={items} statuses={{}} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Problems/ }));
    fireEvent.click(screen.getByText("Looks as if it would tip."));
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });

  it("only shows the text of a problem with no piece", () => {
    const onSelect = vi.fn();
    render(
      <ProblemsButton problems={items} statuses={{}} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Problems/ }));
    fireEvent.click(screen.getByText("An atlas is missing."));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hides a muted source, remembers it, and keeps errors", () => {
    render(
      <ProblemsButton problems={items} statuses={{}} onSelect={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Problems/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Balance" }));
    expect(screen.queryByText("Looks as if it would tip.")).toBeNull();
    expect(screen.getByText("The root piece is missing.")).toBeTruthy();
    expect(localStorage.getItem("coilbox.lego.mutedProblems")).toBe(
      '["balance"]',
    );
  });

  it("says when a check is still running", () => {
    render(
      <ProblemsButton
        problems={items}
        statuses={{ overlap: "checking" }}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Problems/ }));
    expect(screen.getByText(/Overlap: checking/)).toBeTruthy();
  });
});
