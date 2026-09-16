// @vitest-environment happy-dom

/**
 * The line under a `!map <name>` chat message a host sees (issue #2795):
 * a single installed match gets a clickable Accept button, more than one
 * lists the names instead of guessing, and no match says so with no button.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapSuggestionAction } from "./MapSuggestionAction";

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("MapSuggestionAction", () => {
  it("offers an Accept button for a single match, and calls onAccept with its name", () => {
    const onAccept = vi.fn();
    render(
      <MapSuggestionAction
        suggestion={{ query: "delta", matches: ["DeltaSiegeDry"] }}
        pending={false}
        onAccept={onAccept}
      />,
    );
    const button = screen.getByRole("button", {
      name: /Accept: DeltaSiegeDry/,
    });
    fireEvent.click(button);
    expect(onAccept).toHaveBeenCalledWith("DeltaSiegeDry");
  });

  it("disables the Accept button while a change is already in flight", () => {
    render(
      <MapSuggestionAction
        suggestion={{ query: "delta", matches: ["DeltaSiegeDry"] }}
        pending={true}
        onAccept={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: /Changing map/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists every match instead of offering Accept when more than one map matches", () => {
    render(
      <MapSuggestionAction
        suggestion={{
          query: "comet",
          matches: ["Comet Catcher Remake", "Comet Catcher Redux"],
        }}
        pending={false}
        onAccept={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Matches: Comet Catcher Remake, Comet Catcher Redux"),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says no installed map matches, with no button, when nothing does", () => {
    render(
      <MapSuggestionAction
        suggestion={{ query: "nonexistentmap", matches: [] }}
        pending={false}
        onAccept={vi.fn()}
      />,
    );
    expect(
      screen.getByText("No installed map matches “nonexistentmap”."),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
