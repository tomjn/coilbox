// @vitest-environment happy-dom

/**
 * Typing the range a piece may turn through (issue #3353). A range is kept
 * only once both ends are numbers and the first is below the second.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoPiece } from "../../model";
import { JointLimitFields } from "./JointLimitFields";

function piece(over: Partial<LegoPiece> = {}): LegoPiece {
  return {
    id: "t",
    name: "turret",
    parentId: "base",
    partId: "x",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role: "turret",
    ...over,
  };
}

const onChange = vi.fn();

function type(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

beforeEach(() => onChange.mockReset());
afterEach(cleanup);

describe("JointLimitFields", () => {
  it("offers nothing for a piece that is not a turret, barrel or arm", () => {
    render(
      <JointLimitFields piece={piece({ role: "wheel" })} onChange={onChange} />,
    );
    expect(screen.queryByLabelText("Turn from")).toBeNull();
  });

  it("offers a turn range on a turret and a lift range on a barrel", () => {
    const { unmount } = render(
      <JointLimitFields piece={piece()} onChange={onChange} />,
    );
    expect(screen.getByLabelText("Turn from")).toBeTruthy();
    expect(screen.queryByLabelText("Lift from")).toBeNull();
    unmount();
    render(
      <JointLimitFields
        piece={piece({ role: "barrel" })}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("Lift from")).toBeTruthy();
    expect(screen.queryByLabelText("Turn from")).toBeNull();
  });

  it("offers both on an aim point", () => {
    render(
      <JointLimitFields piece={piece({ role: "aim" })} onChange={onChange} />,
    );
    expect(screen.getByLabelText("Turn to")).toBeTruthy();
    expect(screen.getByLabelText("Lift to")).toBeTruthy();
  });

  it("stores nothing until both ends are in", () => {
    render(<JointLimitFields piece={piece()} onChange={onChange} />);
    type("Turn from", "-30");
    expect(onChange).not.toHaveBeenCalled();
    type("Turn to", "90");
    expect(onChange).toHaveBeenCalledWith({ yaw: { min: -30, max: 90 } });
  });

  it("keeps nothing when the first end is not below the second", () => {
    render(
      <JointLimitFields
        piece={piece({ limits: { yaw: { min: -30, max: 90 } } })}
        onChange={onChange}
      />,
    );
    type("Turn from", "100");
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("Turn from").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("clears the range when both ends are emptied, leaving the other axis", () => {
    render(
      <JointLimitFields
        piece={piece({
          role: "aim",
          limits: { yaw: { min: -30, max: 90 }, pitch: { min: 0, max: 40 } },
        })}
        onChange={onChange}
      />,
    );
    type("Turn from", "");
    expect(onChange).not.toHaveBeenCalled();
    type("Turn to", "");
    expect(onChange).toHaveBeenCalledWith({ pitch: { min: 0, max: 40 } });
  });

  it("clears the limits altogether when the last range goes", () => {
    render(
      <JointLimitFields
        piece={piece({ limits: { yaw: { min: -30, max: 90 } } })}
        onChange={onChange}
      />,
    );
    type("Turn from", "");
    type("Turn to", "");
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
