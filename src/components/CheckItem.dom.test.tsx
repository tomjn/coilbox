// @vitest-environment happy-dom
/**
 * The shared checks-drawer row: it shows its icon, location, message and tag,
 * only becomes a button when it is given something to jump to, and a
 * section's heading carries the count of what it holds.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckItem, CheckSection } from "./CheckItem";

afterEach(cleanup);

describe("a check row", () => {
  it("shows its location, message and tag", () => {
    render(
      <ul>
        <CheckItem
          severity="warning"
          location="line 12"
          message="`turn` at speed 0 never finishes."
          tag="speed-zero"
        />
      </ul>,
    );
    expect(screen.getByText("line 12")).toBeTruthy();
    expect(screen.getByText("`turn` at speed 0 never finishes.")).toBeTruthy();
    expect(screen.getByText("speed-zero")).toBeTruthy();
  });

  it("renders as a plain row with no onSelect", () => {
    render(
      <ul>
        <CheckItem severity="info" message="Nothing to click here." />
      </ul>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Nothing to click here.")).toBeTruthy();
  });

  it("renders as a button and calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <CheckItem
          severity="error"
          message="names `Ghost`, which the script never defines."
          onSelect={onSelect}
        />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("leaves out the location when there is none", () => {
    render(
      <ul>
        <CheckItem severity="warning" message="Nowhere in particular." />
      </ul>,
    );
    expect(screen.queryByText(/line/)).toBeNull();
  });
});

describe("a check section", () => {
  it("shows the title with the count in the heading", () => {
    render(
      <CheckSection title="Problems in the BOS" count={3}>
        <CheckItem severity="info" message="one" />
      </CheckSection>,
    );
    expect(screen.getByText("Problems in the BOS (3)")).toBeTruthy();
  });
});
