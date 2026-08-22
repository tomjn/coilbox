// @vitest-environment happy-dom

/**
 * The aim point panel: the reading it opens on, and what taking it over sends
 * back (issue #1815).
 *
 * `../../aimPoint.test.ts` covers what the point means to the engine. This is
 * the panel above it, and the thing the pure module cannot say: the panel opens
 * on a point nobody stored, measured off the unit's bounding box, and typing
 * one number has to hand back all three. Send one axis and the unit is saved
 * aimed at somewhere it was never shown.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoPiece, LegoProject } from "../../model";
import { newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { AimPointPanel } from "./AimPointPanel";

/** One part: a triangle two elmos out along x and z, and flat in y. Its box is
 *  therefore centred on (1, 0, 1). */
function pack(): LoadedPack {
  const part: LegoPartInfo = {
    id: "tri",
    packId: "lego",
    shapeId: "tri",
    name: "tri",
    category: "grey",
    colourway: "grey",
    shape: "tri",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [2, 0, 2] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [part],
    byId: new Map([["tri", part]]),
    // x, y, z, nx, ny, nz, u, v
    vertices: new Float32Array([
      0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 1, 0, 0, 0, 2, 0, 0, 1, 0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  };
}

const loaded = pack();

function unit(over: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "base",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-21T00:00:00Z",
  });
  const hull: LegoPiece = {
    id: "hull",
    name: "hull",
    parentId: "base",
    partId: "tri",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
  return { ...base, pieces: [...base.pieces, hull], ...over };
}

const onChange = vi.fn();

function show(project: LegoProject) {
  return render(
    <AimPointPanel
      project={project}
      pack={loaded}
      raw={null}
      onChange={onChange}
    />,
  );
}

function type(label: string, value: string) {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

/** The last point the panel handed back. */
function sent(): [number, number, number] | null {
  const call = onChange.mock.calls.at(-1);
  if (!call) throw new Error("the panel sent nothing");
  return call[0];
}

beforeEach(() => {
  onChange.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("a unit that has never been given an aim point", () => {
  it("opens on the middle of the unit's bounding box", () => {
    show(unit());
    expect(screen.getByLabelText("Aim point X")).toHaveProperty("value", "1");
    expect(screen.getByLabelText("Aim point Y")).toHaveProperty("value", "0");
    expect(screen.getByLabelText("Aim point Z")).toHaveProperty("value", "1");
  });

  it("says the reading is derived, and offers no way back to it", () => {
    show(unit());
    expect(screen.getByText(/middle of the model's bounding box/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Use the bounding box centre" }),
    ).toBeNull();
  });

  /** The one that matters. Typing one number takes the point over, so what
   *  goes back has to be all three with that one changed. */
  it("hands back the whole point when one number is typed", () => {
    show(unit());
    type("Aim point Y", "6");

    expect(sent()).toEqual([1, 6, 1]);
  });
});

describe("a unit with an aim point of its own", () => {
  it("shows what was stored rather than the box", () => {
    show(unit({ mid: [0, 9, 0] }));
    expect(screen.getByLabelText("Aim point Y")).toHaveProperty("value", "9");
    expect(screen.getByLabelText("Aim point X")).toHaveProperty("value", "0");
  });

  it("keeps the other two axes when one is changed", () => {
    show(unit({ mid: [0, 9, 0] }));
    type("Aim point X", "3");

    expect(sent()).toEqual([3, 9, 0]);
  });

  /** Null is the absence of the key, so the unit goes back to being measured
   *  rather than storing a copy of what was measured. */
  it("hands the point back to the bounding box on request", () => {
    show(unit({ mid: [0, 9, 0] }));
    fireEvent.click(
      screen.getByRole("button", { name: "Use the bounding box centre" }),
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("what the panel says moves with the point", () => {
  it("names the collision sphere and the collision volume", () => {
    show(unit());
    expect(screen.getByText(/collision sphere is centred here/)).toBeTruthy();
    expect(screen.getByText(/stays on the geometry/)).toBeTruthy();
  });
});

describe("what the panel says about dragging the point", () => {
  /** The handles are the viewport's, and it only puts them on the point while
   *  this panel is open, so this panel is where that has to be said. */
  it("says the handles are on the point and that they only move it", () => {
    show(unit());
    expect(screen.getByText(/handles are on the point itself/)).toBeTruthy();
    expect(screen.getByText(/Move only/)).toBeTruthy();
  });
});
