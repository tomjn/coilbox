// @vitest-environment happy-dom
/**
 * A lint problem row hands its line back to `onSelect` on click, the parse
 * error takes over the whole list when there is one, and nothing renders at
 * all when there is neither, so an unused drawer never shows an empty list.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LintDiagnostic } from "../bindings";
import { LintProblems } from "./LintProblems";

afterEach(cleanup);

const DIAGNOSTICS: LintDiagnostic[] = [
  {
    rule: "unused-piece",
    severity: "info",
    line: 3,
    message:
      "`flare` is declared as a piece but nothing in the script names it.",
  },
  {
    rule: "speed-zero",
    severity: "warning",
    line: 12,
    message:
      "`turn` at speed 0 never finishes, so anything waiting for it waits forever.",
  },
  {
    rule: "invalid-call",
    severity: "error",
    line: 20,
    message:
      "`call-script` names `Ghost`, which the script never defines, so nothing happens when this runs.",
  },
];

describe("the lint problems list", () => {
  it("shows each diagnostic's line, message and rule", () => {
    render(<LintProblems diagnostics={DIAGNOSTICS} />);
    expect(screen.getByText("line 3")).toBeTruthy();
    expect(screen.getByText(/flare.*is declared as a piece/)).toBeTruthy();
    expect(screen.getByText("unused-piece")).toBeTruthy();
    expect(screen.getByText("speed-zero")).toBeTruthy();
    expect(screen.getByText("invalid-call")).toBeTruthy();
    expect(screen.getByText(/Problems in the BOS/)).toBeTruthy();
  });

  it("hands the row's line back to onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<LintProblems diagnostics={DIAGNOSTICS} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /speed-zero/ }));
    expect(onSelect).toHaveBeenCalledWith(12);
  });

  it("shows the parse error instead of a list when the script did not parse", () => {
    render(
      <LintProblems
        diagnostics={[]}
        error="broken.bos: line 2: expected `)`, found `{`"
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "expected `)`, found `{`",
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = render(<LintProblems diagnostics={[]} />);
    expect(container.textContent).toBe("");
  });
});
