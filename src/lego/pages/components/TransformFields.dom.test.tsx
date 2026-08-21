// @vitest-environment happy-dom

/**
 * Typing a piece's placement instead of dragging it (issue #586).
 *
 * Three things happen between the keyboard and the document and none of them
 * live in a pure module. A field holds what you type until you leave it, so a
 * half-typed "-" is never parsed as a number. Rotation is degrees on screen and
 * radians in the file. A scale typed with the lock on keeps the proportions the
 * piece already has rather than squaring it up.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoPiece } from "../../model";
import { TransformFields } from "./TransformFields";

function hull(over: Partial<LegoPiece> = {}): LegoPiece {
  return {
    id: "hull",
    name: "hull",
    parentId: "base",
    partId: "tri",
    position: [1, 2, 3],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...over,
  };
}

const onChange = vi.fn();
const onUniformScaleChange = vi.fn();

function show(piece: LegoPiece, uniformScale = true) {
  return render(
    <TransformFields
      piece={piece}
      onChange={onChange}
      uniformScale={uniformScale}
      onUniformScaleChange={onUniformScaleChange}
    />,
  );
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

/** Type a value and leave the field, which is what commits it. */
function type(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
  fireEvent.blur(field(label));
}

/** The last change the panel sent. */
function sent(): Partial<LegoPiece> {
  const call = onChange.mock.calls.at(-1);
  if (!call) throw new Error("the panel sent nothing");
  return call[0];
}

beforeEach(() => {
  onChange.mockClear();
  onUniformScaleChange.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("what the fields show", () => {
  it("shows the piece's own position", () => {
    show(hull());
    expect(field("Position X").value).toBe("1");
    expect(field("Position Y").value).toBe("2");
    expect(field("Position Z").value).toBe("3");
  });

  it("shows rotation in degrees, however it is stored", () => {
    show(hull({ rotation: [Math.PI / 2, 0, -Math.PI] }));
    expect(field("Rotation X").value).toBe("90");
    expect(field("Rotation Z").value).toBe("-180");
  });

  /** Three to a row in a 288px panel, so a long float would not fit. */
  it("rounds a long number down to something that fits", () => {
    show(hull({ position: [1 / 3, 0, 0] }));
    expect(field("Position X").value).toBe("0.333");
  });

  /** Dragging the gizmo, or selecting another piece, changes the document
   *  under the panel. The fields follow it. */
  it("follows the document when it changes underneath", () => {
    const { rerender } = show(hull());
    rerender(
      <TransformFields
        piece={hull({ position: [7, 8, 9] })}
        onChange={onChange}
        uniformScale
        onUniformScaleChange={onUniformScaleChange}
      />,
    );
    expect(field("Position X").value).toBe("7");
  });
});

describe("committing a number", () => {
  it("moves the piece on the axis that was typed into, and no other", () => {
    show(hull());
    type("Position Y", "10");
    expect(sent()).toEqual({ position: [1, 10, 3] });
  });

  /** A number is not parsed as it is typed, or "1." and "-" would move the
   *  piece somewhere odd mid-keystroke. */
  it("says nothing until the field is left", () => {
    show(hull());
    fireEvent.change(field("Position Y"), { target: { value: "-" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("turns rubbish back into what the piece actually is", () => {
    show(hull());
    type("Position Y", "banana");
    expect(onChange).not.toHaveBeenCalled();
    expect(field("Position Y").value).toBe("2");
  });

  it("says nothing when the number typed is the number already there", () => {
    show(hull());
    type("Position Y", "2");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives up on the change when Escape is pressed", () => {
    show(hull());
    fireEvent.change(field("Position Y"), { target: { value: "10" } });
    fireEvent.keyDown(field("Position Y"), { key: "Escape" });
    expect(field("Position Y").value).toBe("2");
  });

  it("stores a rotation in radians from the degrees that were typed", () => {
    show(hull());
    type("Rotation X", "90");
    expect(sent().rotation?.[0]).toBeCloseTo(Math.PI / 2);
    expect(sent().rotation?.[1]).toBe(0);
  });
});

describe("scaling with the lock on", () => {
  /** Keeping the proportions means every axis moves by the same ratio, not that
   *  every axis lands on the same number: a deliberate stretch survives. */
  it("scales every axis by the ratio the typed one moved by", () => {
    show(hull({ scale: [1, 2, 4] }));
    type("Scale X", "3");
    expect(sent()).toEqual({ scale: [3, 6, 12] });
  });

  it("scales one axis on its own once the lock is off", () => {
    show(hull({ scale: [1, 2, 4] }), false);
    type("Scale X", "3");
    expect(sent()).toEqual({ scale: [3, 2, 4] });
  });

  /** An axis already at zero has no ratio to scale by, so it is left as it was
   *  rather than the whole piece collapsing or going infinite. */
  it("survives an axis that is already flat", () => {
    show(hull({ scale: [0, 2, 4] }));
    type("Scale X", "3");
    expect(sent()).toEqual({ scale: [0, 2, 4] });
  });

  it("says which way the lock is set, and offers the other", () => {
    show(hull());
    const lock = screen.getByTitle(/Scaling keeps its proportions/);
    expect(lock.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(lock);
    expect(onUniformScaleChange).toHaveBeenCalledWith(false);
  });
});
