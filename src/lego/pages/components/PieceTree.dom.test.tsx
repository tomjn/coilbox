// @vitest-environment happy-dom

/**
 * The piece hierarchy on screen, and what a drag between two rows does
 * (issue #586).
 *
 * `../../reparent.test.ts` proves which moves are legal and `../../model.test.ts`
 * proves what hangs off what. This is the half in between: the real component,
 * so the shape of the list, the selection it reports and the reach of a drag are
 * asserted rather than assumed.
 *
 * happy-dom lays nothing out, so `document.elementFromPoint` answers nothing and
 * the drag's hit test is stubbed below. Everything either side of that hit test
 * is the component's own: the threshold, the legality check, the drop.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "../../model";
import { PieceTree } from "./PieceTree";

function piece(id: string, parentId: string): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

/**
 * base
 *  ├ hull        (geometry)
 *  │  ├ turret   (geometry)
 *  │  │  └ barrel
 *  │  └ skirt
 *  └ flare       (empty)
 */
function walker(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "base",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-21T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      { ...piece("hull", "base"), partId: "cube" },
      { ...piece("turret", "hull"), partId: "cube" },
      piece("barrel", "turret"),
      piece("skirt", "hull"),
      piece("flare", "base"),
    ],
  };
}

const handlers = {
  onSelect: vi.fn(),
  onReparent: vi.fn(),
  onToggleHidden: vi.fn(),
  onHoverChange: vi.fn(),
};

function show(project: LegoProject, selectedIds: string[] = []) {
  return render(
    <PieceTree project={project} selectedIds={selectedIds} {...handlers} />,
  );
}

/** The row for a piece: the element the drag code identifies rows by. */
function row(pieceId: string): HTMLElement {
  const found = document.querySelector(`[data-piece-id="${pieceId}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`no row for ${pieceId}`);
  return found;
}

/** The row's own button: the one that selects the piece, not the eye beside it. */
function rowButton(pieceId: string): HTMLButtonElement {
  const found = row(pieceId).querySelector("button");
  if (!found) throw new Error(`no select button for ${pieceId}`);
  return found;
}

/**
 * Drag `from` onto `to`, past the four-pixel threshold, with the hit test
 * answering the row the pointer is meant to be over.
 */
function drag(from: string, to: string | null) {
  document.elementFromPoint = () => (to ? row(to) : null);
  const start = row(from);
  fireEvent.pointerDown(start, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(start, { clientX: 0, clientY: 40 });
  fireEvent.pointerUp(start, { clientX: 0, clientY: 40 });
}

beforeEach(() => {
  for (const handler of Object.values(handlers)) handler.mockClear();
  // happy-dom has no layout, so nothing is ever under a point until a test says
  // so. Pointer capture is the same: the container asks for it mid-drag.
  document.elementFromPoint = () => null;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
});

afterEach(() => {
  cleanup();
});

describe("the shape of the list", () => {
  it("shows every piece in the unit", () => {
    show(walker());
    expect(
      [...document.querySelectorAll("[data-piece-id]")].map(
        (element) => (element as HTMLElement).dataset.pieceId,
      ),
    ).toEqual(["base", "hull", "turret", "barrel", "skirt", "flare"]);
  });

  /** The tree is the hierarchy, not a flat list that happens to be indented. */
  it("nests a piece inside the row of the piece that carries it", () => {
    show(walker());
    const hull = row("hull").closest("li");
    if (!hull) throw new Error("no list item for hull");
    expect(within(hull).getByText("turret")).toBeTruthy();
    expect(within(hull).getByText("barrel")).toBeTruthy();
    expect(within(hull).queryByText("flare")).toBeNull();
  });

  /**
   * The whole tree stays on screen while something in it is selected. The
   * builder once showed a single clipped row at this moment, so a selection
   * losing rows is worth saying out loud even though what went wrong then was
   * layout rather than markup.
   */
  it("loses no rows when a piece is selected", () => {
    const { rerender } = show(walker());
    const before = document.querySelectorAll("[data-piece-id]").length;
    rerender(
      <PieceTree project={walker()} selectedIds={["turret"]} {...handlers} />,
    );
    expect(document.querySelectorAll("[data-piece-id]")).toHaveLength(before);
  });

  it("says which pieces have geometry and which are bare points", () => {
    show(walker());
    expect(screen.getAllByLabelText("Geometry piece")).toHaveLength(2);
    expect(screen.getAllByLabelText("Empty piece")).toHaveLength(4);
  });
});

describe("selecting", () => {
  it("marks the selected pieces and nothing else", () => {
    show(walker(), ["turret", "skirt"]);
    expect(rowButton("turret").getAttribute("aria-pressed")).toBe("true");
    expect(rowButton("skirt").getAttribute("aria-pressed")).toBe("true");
    expect(rowButton("hull").getAttribute("aria-pressed")).toBe("false");
  });

  it("replaces the selection on a plain click", () => {
    show(walker(), ["hull"]);
    fireEvent.click(rowButton("turret"));
    expect(handlers.onSelect).toHaveBeenCalledWith("turret", false);
  });

  it("adds to the selection on Shift, Cmd or Ctrl", () => {
    show(walker(), ["hull"]);
    const turret = rowButton("turret");
    fireEvent.click(turret, { shiftKey: true });
    fireEvent.click(turret, { metaKey: true });
    fireEvent.click(turret, { ctrlKey: true });
    expect(handlers.onSelect.mock.calls).toEqual([
      ["turret", true],
      ["turret", true],
      ["turret", true],
    ]);
  });
});

describe("hiding a piece", () => {
  it("offers to hide what is shown and to show what is hidden", () => {
    const project = walker();
    project.pieces = project.pieces.map((p) =>
      p.id === "skirt" ? { ...p, hidden: true } : p,
    );
    show(project);
    fireEvent.click(screen.getByRole("button", { name: "Show skirt" }));
    expect(handlers.onToggleHidden).toHaveBeenCalledWith("skirt");
    expect(screen.getByRole("button", { name: "Hide hull" })).toBeTruthy();
  });

  /**
   * A piece under a hidden parent is not drawn either, so it reads as dimmed.
   * Its own button still offers to hide it: the toggle acts on the piece's own
   * flag whatever an ancestor is doing.
   */
  it("dims what an ancestor has hidden without claiming it is hidden itself", () => {
    const project = walker();
    project.pieces = project.pieces.map((p) =>
      p.id === "hull" ? { ...p, hidden: true } : p,
    );
    show(project);
    expect(rowButton("turret").className).toContain("text-muted-foreground");
    expect(rowButton("flare").className).not.toContain("text-muted-foreground");
    expect(screen.getByRole("button", { name: "Hide turret" })).toBeTruthy();
  });
});

describe("dragging a row onto another", () => {
  it("moves the dragged piece under the row it was dropped on", () => {
    show(walker());
    drag("barrel", "hull");
    expect(handlers.onReparent).toHaveBeenCalledWith("barrel", "hull");
  });

  /** A piece cannot hang off something it already carries. */
  it("refuses a drop onto the dragged piece's own descendant", () => {
    show(walker());
    drag("hull", "barrel");
    expect(handlers.onReparent).not.toHaveBeenCalled();
  });

  it("does nothing when the drop lands on no row at all", () => {
    show(walker());
    drag("barrel", null);
    expect(handlers.onReparent).not.toHaveBeenCalled();
  });

  /** The root is the unit, so it has nowhere to move to. It still takes drops. */
  it("will not carry the root piece anywhere", () => {
    show(walker());
    drag("base", "hull");
    expect(handlers.onReparent).not.toHaveBeenCalled();

    drag("turret", "base");
    expect(handlers.onReparent).toHaveBeenCalledWith("turret", "base");
  });

  /** A click is a press and a release. Only a press that travels is a drag. */
  it("takes a press that never moves as a click, not a drop", () => {
    show(walker());
    document.elementFromPoint = () => row("hull");
    const start = row("barrel");
    fireEvent.pointerDown(start, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(start, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(start, { clientX: 1, clientY: 1 });
    expect(handlers.onReparent).not.toHaveBeenCalled();
  });

  /** What is being carried, and where it would land, said in words. */
  it("names the piece being carried and the piece it would land on", () => {
    show(walker());
    document.elementFromPoint = () => row("hull");
    const start = row("barrel");
    fireEvent.pointerDown(start, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(start, { clientX: 0, clientY: 40 });
    expect(screen.getByText("barrel onto hull")).toBeTruthy();
  });
});

describe("hovering a row", () => {
  it("reports the piece under the pointer, and that it has left", () => {
    show(walker());
    fireEvent.mouseEnter(row("turret"));
    expect(handlers.onHoverChange).toHaveBeenCalledWith("turret");
    fireEvent.mouseLeave(row("turret"));
    expect(handlers.onHoverChange).toHaveBeenCalledWith(null);
  });

  /** Mid-drag a row already means a drop target, so a second highlight on it
   *  would be two things saying different words about the same row. */
  it("says nothing while a drag is going", () => {
    show(walker());
    document.elementFromPoint = () => row("hull");
    fireEvent.pointerDown(row("barrel"), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(row("barrel"), { clientX: 0, clientY: 40 });
    handlers.onHoverChange.mockClear();
    fireEvent.mouseEnter(row("skirt"));
    expect(handlers.onHoverChange).not.toHaveBeenCalled();
  });
});
