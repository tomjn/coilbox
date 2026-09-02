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

  /**
   * The row this sits in is a flex container with a `gap`, which puts space
   * either side of every item it contains, even an empty one (issue #2290
   * follow-up). happy-dom does no layout, so this cannot assert the gap
   * itself, it can only assert the region drops the `flex` layout class when
   * idle, which is what takes it out of the row's flow.
   */
  it("is not a flex item while idle, so it cannot widen the row's gap", () => {
    const { rerender } = render(
      <SaveStatus state={{ kind: "idle" }} onRetry={() => {}} />,
    );
    const region = screen.getByRole("status");
    expect(region.className).not.toContain("flex");

    rerender(<SaveStatus state={{ kind: "saving" }} onRetry={() => {}} />);
    expect(region.className).toContain("flex");
  });
});
