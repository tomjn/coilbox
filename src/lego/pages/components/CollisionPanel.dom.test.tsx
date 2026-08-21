// @vitest-environment happy-dom

/**
 * The collision panel: the reading it opens on, and what taking it over sends
 * back (issue #586).
 *
 * `../../collisionVolume.test.ts` covers what a volume means to the engine. This
 * is the panel above it, and one thing in particular that the pure module cannot
 * say: the panel opens on a volume nobody stored, derived from the unit's
 * bounding box, and the first field somebody touches has to hand back that whole
 * derived volume rather than the one number they typed. Send a partial and the
 * unit is saved with a volume it never had.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoCollisionVolume, LegoPiece, LegoProject } from "../../model";
import { newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { CollisionPanel } from "./CollisionPanel";

/** One part: a triangle two elmos out along x and z, and flat in y. */
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
const onPieceCollisionChange = vi.fn();

function show(project: LegoProject) {
  return render(
    <CollisionPanel
      project={project}
      pack={loaded}
      raw={null}
      onChange={onChange}
      onPieceCollisionChange={onPieceCollisionChange}
    />,
  );
}

/** Type into one of the three boxes on a row and leave it, which is what
 *  commits the number. */
function type(label: string, value: string) {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

/** The last volume the panel handed back. */
function sent(): LegoCollisionVolume {
  const call = onChange.mock.calls.at(-1);
  if (!call) throw new Error("the panel sent nothing");
  return call[0];
}

beforeEach(() => {
  onChange.mockClear();
  onPieceCollisionChange.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("a unit that has never had a volume set", () => {
  it("opens on the unit's own bounding box", () => {
    show(unit());
    expect(screen.getByLabelText("Size X")).toHaveProperty("value", "2");
    expect(screen.getByLabelText("Size Z")).toHaveProperty("value", "2");
    expect(screen.getByLabelText("Offset from the middle X")).toHaveProperty(
      "value",
      "0",
    );
  });

  it("says the reading is derived, and offers no way back to it", () => {
    show(unit());
    expect(
      screen.getByText(/Derived from the model's bounding box/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Use the bounding box" }),
    ).toBeNull();
  });

  /**
   * The one that matters. Typing one number takes the volume over, so what goes
   * back has to be the whole derived volume with that one number changed. A
   * partial would save the unit a volume it was never shown.
   */
  it("hands back the whole derived volume when one number is typed", () => {
    show(unit());
    type("Size Y", "5");

    expect(sent()).toEqual({
      type: "box",
      scales: [2, 5, 2],
      offsets: [0, 0, 0],
    });
  });

  it("does the same for an offset", () => {
    show(unit());
    type("Offset from the middle Z", "-3");

    expect(sent()).toEqual({
      type: "box",
      scales: [2, 0, 2],
      offsets: [0, 0, -3],
    });
  });
});

describe("a unit with a volume of its own", () => {
  const custom: LegoCollisionVolume = {
    type: "cyly",
    scales: [4, 9, 4],
    offsets: [0, 1, 0],
  };

  it("shows what was stored rather than the bounding box", () => {
    show(unit({ collisionVolume: custom }));
    expect(screen.getByLabelText("Size Y")).toHaveProperty("value", "9");
    expect(screen.getByLabelText("Offset from the middle Y")).toHaveProperty(
      "value",
      "1",
    );
  });

  it("keeps the shape when a size is changed, rather than reverting to a box", () => {
    show(unit({ collisionVolume: custom }));
    type("Size X", "6");

    expect(sent()).toEqual({
      type: "cyly",
      scales: [6, 9, 4],
      offsets: [0, 1, 0],
    });
  });

  /** Null is the absence of the key, so the unit goes back to being derived
   *  rather than storing a copy of what was derived. */
  it("hands the volume back to the bounding box on request", () => {
    show(unit({ collisionVolume: custom }));
    fireEvent.click(
      screen.getByRole("button", { name: "Use the bounding box" }),
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("what the panel warns about", () => {
  it("says a sphere ignores two of its three sizes", () => {
    show(
      unit({
        collisionVolume: {
          type: "sphere",
          scales: [1, 2, 3],
          offsets: [0, 0, 0],
        },
      }),
    );
    expect(screen.getByText(/A sphere cannot be stretched/)).toBeTruthy();
  });

  it("says a cylinder is round whichever axis it runs along", () => {
    show(
      unit({
        collisionVolume: {
          type: "cylz",
          scales: [1, 2, 3],
          offsets: [0, 0, 0],
        },
      }),
    );
    expect(screen.getByText(/A cylinder is round/)).toBeTruthy();
  });

  /** Under an elmo on every axis and the engine goes back to its own sphere,
   *  so a volume that small is worse than none. */
  it("says when the engine would read the volume as none at all", () => {
    show(
      unit({
        collisionVolume: {
          type: "box",
          scales: [0.5, 0.5, 0.5],
          offsets: [0, 0, 0],
        },
      }),
    );
    expect(screen.getByText(/read it as no volume at all/)).toBeTruthy();
  });

  it("says nothing of the sort about a volume the engine will use", () => {
    show(
      unit({
        collisionVolume: { type: "box", scales: [4, 4, 4], offsets: [0, 0, 0] },
      }),
    );
    expect(screen.queryByText(/read it as no volume at all/)).toBeNull();
    expect(screen.queryByText(/A sphere cannot be stretched/)).toBeNull();
  });
});

describe("hitting the unit piece by piece", () => {
  it("is off unless the unit asked for it", () => {
    show(unit());
    expect(
      screen
        .getByLabelText("Shoot at each piece instead")
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("is on for a unit that asked for it", () => {
    show(unit({ pieceCollision: true }));
    expect(
      screen
        .getByLabelText("Shoot at each piece instead")
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("reports the switch being thrown, each way", () => {
    const { rerender } = show(unit());
    fireEvent.click(screen.getByLabelText("Shoot at each piece instead"));
    expect(onPieceCollisionChange).toHaveBeenLastCalledWith(true);

    rerender(
      <CollisionPanel
        project={unit({ pieceCollision: true })}
        pack={loaded}
        raw={null}
        onChange={onChange}
        onPieceCollisionChange={onPieceCollisionChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Shoot at each piece instead"));
    expect(onPieceCollisionChange).toHaveBeenLastCalledWith(false);
  });

  /** The volume above still selects the unit and still measures explosions, so
   *  it is worth getting right even once shots go past it. */
  it("says the volume above still has a job once pieces are hit instead", () => {
    show(unit({ pieceCollision: true }));
    expect(screen.getByText(/still does two other jobs/)).toBeTruthy();
  });
});
