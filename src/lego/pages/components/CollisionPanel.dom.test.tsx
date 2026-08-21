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
const onPieceSelectionChange = vi.fn();
const onSelectPiece = vi.fn();
const onPieceVolumeChange = vi.fn();

function panel(project: LegoProject, selectedId: string | null = "hull") {
  return (
    <CollisionPanel
      project={project}
      pack={loaded}
      raw={null}
      onChange={onChange}
      onPieceCollisionChange={onPieceCollisionChange}
      onPieceSelectionChange={onPieceSelectionChange}
      selectedId={selectedId}
      onSelectPiece={onSelectPiece}
      onPieceVolumeChange={onPieceVolumeChange}
    />
  );
}

function show(project: LegoProject) {
  return render(panel(project));
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

/** The last piece override the panel handed back, with the piece it was for. */
function sentPiece(): [string, unknown] {
  const call = onPieceVolumeChange.mock.calls.at(-1);
  if (!call) throw new Error("the panel sent nothing for a piece");
  return [call[0], call[1]];
}

beforeEach(() => {
  onChange.mockClear();
  onPieceCollisionChange.mockClear();
  onPieceSelectionChange.mockClear();
  onSelectPiece.mockClear();
  onPieceVolumeChange.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("a unit that has never had a volume set", () => {
  it("opens on the unit's own bounding box", () => {
    show(unit());
    expect(screen.getByLabelText("Size X")).toHaveProperty("value", "2");
    expect(screen.getByLabelText("Size Z")).toHaveProperty("value", "2");
    expect(screen.getByLabelText("Offset from the aim point X")).toHaveProperty(
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
    type("Offset from the aim point Z", "-3");

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
    expect(screen.getByLabelText("Offset from the aim point Y")).toHaveProperty(
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
      screen.getByLabelText("Shoot at each piece").getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("is on for a unit that asked for it", () => {
    show(unit({ pieceCollision: true }));
    expect(
      screen.getByLabelText("Shoot at each piece").getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("reports the switch being thrown, each way", () => {
    const { rerender } = show(unit());
    fireEvent.click(screen.getByLabelText("Shoot at each piece"));
    expect(onPieceCollisionChange).toHaveBeenLastCalledWith(true);

    rerender(panel(unit({ pieceCollision: true })));
    fireEvent.click(screen.getByLabelText("Shoot at each piece"));
    expect(onPieceCollisionChange).toHaveBeenLastCalledWith(false);
  });

  /** The volume above still selects the unit and still measures explosions, so
   *  it is worth getting right even once shots go past it. */
  it("says the volume above still has a job once pieces are hit instead", () => {
    show(unit({ pieceCollision: true }));
    expect(
      screen.getByText(/still what you click to select the unit/),
    ).toBeTruthy();
  });
});

describe("clicking the unit piece by piece", () => {
  it("is off unless the unit asked for it", () => {
    show(unit());
    expect(
      screen.getByLabelText("Click on each piece").getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("is on for a unit that asked for it", () => {
    show(unit({ pieceSelection: true }));
    expect(
      screen.getByLabelText("Click on each piece").getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("reports the switch being thrown, each way", () => {
    const { rerender } = show(unit());
    fireEvent.click(screen.getByLabelText("Click on each piece"));
    expect(onPieceSelectionChange).toHaveBeenLastCalledWith(true);

    rerender(panel(unit({ pieceSelection: true })));
    fireEvent.click(screen.getByLabelText("Click on each piece"));
    expect(onPieceSelectionChange).toHaveBeenLastCalledWith(false);
  });

  /**
   * The pair is two switches, not one setting. Throwing one must leave the
   * other alone, and the panel must not claim the volume above is still the
   * click target once the pieces are.
   */
  it("leaves the other switch alone when it is thrown", () => {
    show(unit());
    fireEvent.click(screen.getByLabelText("Click on each piece"));
    expect(onPieceCollisionChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Shoot at each piece"));
    expect(onPieceSelectionChange).toHaveBeenCalledTimes(1);
  });

  it("stops saying the volume above is what you click", () => {
    show(unit({ pieceCollision: true, pieceSelection: true }));
    expect(
      screen.queryByText(/still what you click to select the unit/),
    ).toBeNull();
    expect(screen.getByText(/sphere an explosion measures/)).toBeTruthy();
  });
});

/**
 * The per-piece fields (issue #1842). Same rule as the unit's own volume, one
 * level down: the panel opens on the box the engine measures and the first
 * thing touched has to hand back that whole box, not the one number typed.
 *
 * The unit's hull is the two elmo triangle from `pack()` above, flat in y, so
 * the engine's box round it is 2 by 1 by 2: the y axis clamps up to one elmo
 * because `InitShape` will not take less.
 */
describe("changing one piece's box", () => {
  it("opens on the box the engine measures round that piece", () => {
    show(unit({ pieceCollision: true }));
    expect(screen.getByLabelText("Box size X")).toHaveProperty("value", "2");
    expect(screen.getByLabelText("Offset in the piece X")).toHaveProperty(
      "value",
      "1",
    );
  });

  it("hands back the whole measured box when one number is typed", () => {
    show(unit({ pieceCollision: true }));
    type("Box size Y", "8");

    expect(sentPiece()).toEqual([
      "hull",
      {
        hit: true,
        volume: { type: "box", scales: [2, 8, 2], offsets: [1, 0, 1] },
      },
    ]);
  });

  it("will not take a size under an elmo, since the engine clamps it anyway", () => {
    show(unit({ pieceCollision: true }));
    type("Box size X", "0.2");

    expect(sentPiece()[1]).toHaveProperty("volume.scales", [1, 1, 2]);
  });

  it("switches a piece out of the hit test with no volume of its own", () => {
    show(unit({ pieceCollision: true }));
    fireEvent.click(screen.getByLabelText("Anything hits hull"));

    expect(sentPiece()).toEqual(["hull", { hit: false }]);
  });

  it("keeps a box somebody set when the piece is switched off", () => {
    const volume: LegoCollisionVolume = {
      type: "box",
      scales: [9, 9, 9],
      offsets: [0, 0, 0],
    };
    const project = unit({ pieceCollision: true });
    show({
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === "hull"
          ? { ...piece, collision: { hit: true, volume } }
          : piece,
      ),
    });
    fireEvent.click(screen.getByLabelText("Anything hits hull"));

    expect(sentPiece()).toEqual(["hull", { hit: false, volume }]);
  });

  /** Null is the absence of the key, so the piece goes back to being measured
   *  rather than storing a copy of what was measured. */
  it("hands a piece back to its measured box on request", () => {
    const project = unit({ pieceCollision: true });
    show({
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === "hull" ? { ...piece, collision: { hit: false } } : piece,
      ),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Use the measured box" }),
    );

    expect(onPieceVolumeChange).toHaveBeenCalledWith("hull", null);
  });

  it("says the fields reach nothing while neither piece switch is on", () => {
    show(unit());
    expect(
      screen.getByText(/the engine never looks at a piece's box/),
    ).toBeTruthy();
  });

  it("says nothing of the sort once the unit is hit piece by piece", () => {
    show(unit({ pieceCollision: true }));
    expect(
      screen.queryByText(/the engine never looks at a piece's box/),
    ).toBeNull();
  });

  /**
   * A script taken over before any of this existed has no include line, and an
   * export will never add one to a script the user owns. So the file would be
   * written and never read, silently. The only fix is a line the user adds.
   */
  it("says so when an owned script does not pull the file in", () => {
    const project = unit({ pieceCollision: true, script: "-- mine\n" });
    show({
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === "hull" ? { ...piece, collision: { hit: false } } : piece,
      ),
    });

    expect(screen.getByText(/does not pull the file in/)).toBeTruthy();
    expect(
      screen.getByText('include("coilbox/walker_collision.lua")'),
    ).toBeTruthy();
  });

  it("says nothing of the sort about a script that does pull it in", () => {
    const project = unit({
      pieceCollision: true,
      script: '-- mine\ninclude("coilbox/walker_collision.lua")\n',
    });
    show({
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === "hull" ? { ...piece, collision: { hit: false } } : piece,
      ),
    });

    expect(screen.queryByText(/does not pull the file in/)).toBeNull();
  });
});
