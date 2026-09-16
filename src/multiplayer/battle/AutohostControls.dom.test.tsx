// @vitest-environment happy-dom

/**
 * `AutohostControls` in a real lobby battle vs a direct room (issue #2871).
 * A direct room has no autohost, so Balance and Lock/Unlock become requests
 * worded as asks, and Fix colours/Ring unready drop out entirely since the
 * founder has no direct way to honour either (same reasoning #2738 used to
 * hide this whole panel).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutohostControls } from "./AutohostControls";

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

describe("AutohostControls in an ordinary lobby battle", () => {
  it("shows every command with its plain label", () => {
    render(
      <AutohostControls
        locked={false}
        directRoom={false}
        onCommand={vi.fn()}
      />,
    );
    expect(screen.getByText("Host commands")).toBeTruthy();
    expect(screen.getByText("Balance")).toBeTruthy();
    expect(screen.getByText("Fix colours")).toBeTruthy();
    expect(screen.getByText("Ring unready")).toBeTruthy();
    expect(screen.getByText("Lock")).toBeTruthy();
  });

  it("sends the plain command text", () => {
    const onCommand = vi.fn();
    render(
      <AutohostControls
        locked={false}
        directRoom={false}
        onCommand={onCommand}
      />,
    );
    fireEvent.click(screen.getByText("Balance"));
    expect(onCommand).toHaveBeenCalledWith("!balance");
  });
});

describe("AutohostControls in a direct room", () => {
  it("keeps only Balance and Lock, worded as requests", () => {
    render(
      <AutohostControls locked={false} directRoom={true} onCommand={vi.fn()} />,
    );
    expect(screen.getByText("Ask the host")).toBeTruthy();
    expect(screen.getByText("Suggest balance")).toBeTruthy();
    expect(screen.getByText("Suggest lock")).toBeTruthy();
    expect(screen.queryByText("Fix colours")).toBeNull();
    expect(screen.queryByText("Ring unready")).toBeNull();
    expect(screen.queryByText("Balance")).toBeNull();
  });

  it("still sends the plain !balance/!lock text, unchanged for a real autohost elsewhere", () => {
    const onCommand = vi.fn();
    render(
      <AutohostControls
        locked={false}
        directRoom={true}
        onCommand={onCommand}
      />,
    );
    fireEvent.click(screen.getByText("Suggest balance"));
    expect(onCommand).toHaveBeenCalledWith("!balance");
    fireEvent.click(screen.getByText("Suggest lock"));
    expect(onCommand).toHaveBeenCalledWith("!lock");
  });

  it("suggests unlock when the room is locked", () => {
    render(
      <AutohostControls locked={true} directRoom={true} onCommand={vi.fn()} />,
    );
    expect(screen.getByText("Suggest unlock")).toBeTruthy();
  });
});
