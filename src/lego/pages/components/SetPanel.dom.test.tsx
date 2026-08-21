// @vitest-environment happy-dom

/**
 * The panel for a multi-piece selection (issue #1844).
 *
 * What a set has that one piece does not: a list of what is in it, and the one
 * parent every root of it could move to at once. The reasoning it holds is
 * about the roots of the selection rather than the selection: a piece selected
 * alongside its own parent is already carried by it, so it is not separately
 * reparented and it is not what the picker is about.
 *
 * The "hangs off" picker is Radix, and happy-dom lays nothing out, so it is
 * driven the way a keyboard drives it: open it, focus an option, press Enter.
 * `../../reparent.test.ts` covers which options there are to begin with.
 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "../../model";
import { SetPanel } from "./SetPanel";

const onSelect = vi.fn();
const onReparent = vi.fn();

beforeEach(() => {
  onSelect.mockClear();
  onReparent.mockClear();
});

afterEach(() => {
  cleanup();
});

/** A walker: a hull off the root, a thigh off the hull, a shin off the thigh. */
function walker(): LegoProject {
  const base = newProject({
    id: "walker",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-21T00:00:00Z",
  });
  const piece = (id: string, parentId: string): LegoPiece => ({
    id,
    name: id,
    parentId,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      piece("hull", "root"),
      piece("thigh", "hull"),
      piece("shin", "thigh"),
      piece("arm", "root"),
    ],
  };
}

function show(selectedIds: string[], project: LegoProject = walker()) {
  return render(
    <SetPanel
      project={project}
      selectedIds={selectedIds}
      onSelect={onSelect}
      onReparent={onReparent}
    />,
  );
}

/** The name on every button in the list of what is selected. */
function listed(): string[] {
  return [...document.querySelectorAll("li button")].map(
    (button) => button.textContent ?? "",
  );
}

function hangsOff(): Element | null {
  return document.querySelector('[aria-label="Parent piece"]');
}

/** Open the parent picker and answer what it is offering. */
function openPicker(): string[] {
  fireEvent.pointerDown(hangsOff() as Element, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  return [...document.querySelectorAll('[role="option"]')].map(
    (option) => option.textContent ?? "",
  );
}

/** Pick an option by name, the way a keyboard picks one. */
function choose(name: string) {
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (element) => element.textContent === name,
  ) as HTMLElement;
  option.focus();
  fireEvent.keyDown(option, { key: "Enter" });
}

describe("what the panel says is selected", () => {
  it("counts the selection", () => {
    show(["hull", "arm"]);
    expect(document.body.textContent).toContain("2 pieces selected");
  });

  it("names every selected piece, in the order they were selected", () => {
    show(["arm", "hull", "thigh"]);
    expect(listed()).toEqual(["arm", "hull", "thigh"]);
  });

  it("names a piece that is carried by another in the set, even though it is not a root", () => {
    // It is in the selection and the gizmo moves it, so leaving it out of the
    // list would be the panel disagreeing with the viewport.
    show(["hull", "thigh"]);
    expect(listed()).toEqual(["hull", "thigh"]);
  });

  it("skips an id the document no longer has, rather than breaking the panel", () => {
    show(["hull", "ghost"]);
    expect(listed()).toEqual(["hull"]);
    expect(document.body.textContent).toContain("2 pieces selected");
  });

  it("narrows to one piece when its name is clicked", () => {
    show(["hull", "arm"]);
    const button = [...document.querySelectorAll("li button")].find(
      (element) => element.textContent === "arm",
    ) as HTMLElement;
    act(() => {
      button.click();
    });
    expect(onSelect).toHaveBeenCalledWith("arm");
  });

  it("says how a set is moved", () => {
    show(["hull", "arm"]);
    expect(document.body.textContent).toContain("keeps its shape");
  });
});

describe("the parent picker", () => {
  it("is there when the set has somewhere it could go", () => {
    show(["hull", "arm"]);
    expect(hangsOff()).not.toBeNull();
  });

  it("is gone when the set is nothing but the root", () => {
    // The root is the unit rather than a piece in it, so it hangs off nothing
    // and there is no move to offer.
    show(["root"]);
    expect(hangsOff()).toBeNull();
    expect(document.body.textContent).toContain("1 pieces selected");
  });

  it("shows the parent the set shares", () => {
    // Both hang off the root piece, which this unit calls "base".
    show(["hull", "arm"]);
    expect(hangsOff()?.textContent).toBe("base");
  });

  it("says so when the set does not agree on a parent", () => {
    // arm hangs off the root, thigh off the hull, and neither carries the
    // other, so there is no one move to offer.
    show(["thigh", "arm"]);
    expect(hangsOff()?.textContent).toBe("Several");
  });

  it("ignores the parent of a piece another in the set already carries", () => {
    // thigh hangs off hull, which is selected, so thigh is not separately
    // moved and its parent is not part of the question. What is left is hull
    // and arm, which agree.
    show(["hull", "thigh", "arm"]);
    expect(hangsOff()?.textContent).toBe("base");
  });

  it("agrees on a parent once the odd one out is dropped", () => {
    show(["thigh", "shin"]);
    // shin hangs off thigh, so the only root is thigh, whose parent is hull.
    expect(hangsOff()?.textContent).toBe("hull");
  });

  it("offers only somewhere every root of the set could go", () => {
    show(["thigh", "arm"]);
    // Not thigh or shin: the hull cannot move inside the leg it carries.
    // "Several" is the standing answer rather than an option.
    expect(openPicker()).toEqual(["Several", "base", "hull"]);
  });

  it("moves the roots of the set, not everything selected", () => {
    // thigh is already carried by hull, so it comes along rather than being
    // separately reparented. Moving it too would take it out of the hull and
    // hang it beside its own parent.
    show(["hull", "thigh"]);
    openPicker();
    choose("arm");
    expect(onReparent).toHaveBeenCalledWith("arm", ["hull"]);
  });

  it("moves every root when the set has several", () => {
    show(["thigh", "arm"]);
    openPicker();
    choose("hull");
    expect(onReparent).toHaveBeenCalledWith("hull", ["thigh", "arm"]);
  });
});
