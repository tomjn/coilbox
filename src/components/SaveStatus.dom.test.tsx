// @vitest-environment happy-dom

/**
 * The `role="status"` region has to exist before its text changes, or a
 * screen reader may miss the announcement (issue #2290). These tests assert
 * the region's presence and identity, not its styling.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SaveStatus } from "./SaveStatus";

afterEach(cleanup);

describe("SaveStatus", () => {
  it("mounts the status region even when idle", () => {
    render(<SaveStatus state={{ kind: "idle" }} onRetry={() => {}} />);

    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
  });

  it("keeps the same status region across a state change", () => {
    const { rerender } = render(
      <SaveStatus state={{ kind: "idle" }} onRetry={() => {}} />,
    );
    const region = screen.getByRole("status");

    rerender(<SaveStatus state={{ kind: "saving" }} onRetry={() => {}} />);

    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toContain("Saving");
  });

  it("keeps the same status region when a save fails", () => {
    const { rerender } = render(
      <SaveStatus state={{ kind: "idle" }} onRetry={() => {}} />,
    );
    const region = screen.getByRole("status");

    rerender(<SaveStatus state={{ kind: "failed" }} onRetry={() => {}} />);

    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toContain("Not saved");
  });
});
