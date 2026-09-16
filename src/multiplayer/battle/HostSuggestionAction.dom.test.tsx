// @vitest-environment happy-dom

/**
 * The Accept/Reject line a founder sees under a `!balance`/`!lock`/`!unlock`
 * chat message in a direct room (issue #2871).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostSuggestionAction } from "./HostSuggestionAction";

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

describe("HostSuggestionAction", () => {
  it("labels Accept with what it does and calls onAccept", () => {
    const onAccept = vi.fn();
    render(
      <HostSuggestionAction
        suggestion={{ kind: "balance" }}
        onAccept={onAccept}
        onReject={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Accept: balance the teams/ }),
    );
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("captions the buttons with a friendly sentence, drawn alongside the buttons rather than over any command text", () => {
    render(
      <HostSuggestionAction
        suggestion={{ kind: "balance" }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("Asked to balance the teams.")).toBeTruthy();
  });

  it("calls onReject from its own button", () => {
    const onReject = vi.fn();
    render(
      <HostSuggestionAction
        suggestion={{ kind: "lock" }}
        onAccept={vi.fn()}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("labels Accept for unlock distinctly from lock", () => {
    render(
      <HostSuggestionAction
        suggestion={{ kind: "unlock" }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Accept: unlock the room/ }),
    ).toBeTruthy();
  });
});
