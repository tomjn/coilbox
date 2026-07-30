import { describe, expect, it } from "vitest";

import {
  insertCompound,
  insertCompoundAt,
  selectionAsCompound,
  subtreeAsCompound,
  validateCompoundName,
} from "./compounds";
import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  newProject,
} from "./model";

function project(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: null,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

/** Predictable ids, so a test can say which piece it means. */
function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

const TURRET = project([
  {
    id: "turret",
    name: "turret",
    parentId: "root",
    position: [0, 4, 0],
    rotation: [0, 1, 0],
    scale: [2, 2, 2],
  },
  { id: "barrel", name: "barrel", parentId: "turret", position: [0, 0, 3] },
  { id: "flare", name: "flare", parentId: "barrel", position: [0, 0, 1] },
]);

describe("subtreeAsCompound", () => {
  it("takes the piece and everything under it, and nothing else", () => {
    const compound = subtreeAsCompound(TURRET, "turret", {
      id: "c1",
      now: "2026-07-28T00:00:00Z",
      newId: counter("new"),
    });

    expect(compound?.pieces.map((piece) => piece.name)).toEqual([
      "turret",
      "barrel",
      "flare",
    ]);
  });

  it("stands the subtree root at the origin, untransformed", () => {
    const compound = subtreeAsCompound(TURRET, "turret", {
      id: "c1",
      now: "2026-07-28T00:00:00Z",
      newId: counter("new"),
    });
    const root = compound?.pieces.find(
      (piece) => piece.id === compound.rootPieceId,
    );

    expect(root?.parentId).toBeNull();
    expect(root?.position).toEqual([0, 0, 0]);
    expect(root?.rotation).toEqual([0, 0, 0]);
    expect(root?.scale).toEqual([1, 1, 1]);
  });

  it("keeps the arrangement below the root", () => {
    const compound = subtreeAsCompound(TURRET, "turret", {
      id: "c1",
      now: "2026-07-28T00:00:00Z",
      newId: counter("new"),
    }) as LegoProject;
    const barrel = compound.pieces.find((piece) => piece.name === "barrel");

    expect(barrel?.position).toEqual([0, 0, 3]);
    expect(childrenOf(compound, barrel?.id ?? null)).toHaveLength(1);
  });

  it("gives every piece a fresh id, so it cannot collide on insert", () => {
    const compound = subtreeAsCompound(TURRET, "turret", {
      id: "c1",
      now: "2026-07-28T00:00:00Z",
      newId: counter("new"),
    }) as LegoProject;

    expect(compound.pieces.map((piece) => piece.id)).toEqual([
      "new0",
      "new1",
      "new2",
    ]);
  });

  it("is null for a piece that is not there", () => {
    expect(
      subtreeAsCompound(TURRET, "ghost", {
        id: "c1",
        now: "2026-07-28T00:00:00Z",
        newId: counter("new"),
      }),
    ).toBeNull();
  });
});

const LEGS = project([
  { id: "left", name: "left", parentId: "root", position: [-3, 0, 0] },
  { id: "foot", name: "foot", parentId: "left", position: [0, -1, 0] },
  { id: "right", name: "right", parentId: "root", position: [3, 0, 0] },
]);

function liftLegs(project: LegoProject = LEGS): LegoProject {
  return selectionAsCompound(project, ["left", "right"], {
    id: "c1",
    now: "2026-07-28T00:00:00Z",
    newId: counter("new"),
  }) as LegoProject;
}

describe("selectionAsCompound", () => {
  it("takes every selected piece, with nothing invented to hold them", () => {
    const compound = liftLegs();

    expect(compound.pieces.map((piece) => piece.name)).toEqual([
      "left",
      "foot",
      "right",
    ]);
    expect(
      compound.pieces.filter((piece) => piece.parentId === null),
    ).toHaveLength(2);
  });

  it("keeps the distance between the pieces that were selected", () => {
    const compound = liftLegs();
    const right = compound.pieces.find((piece) => piece.name === "right");

    // The first selected piece stands at the origin, as a single lifted piece
    // does, and the second is the six elmos away it was in the unit.
    expect(compound.pieces[0]?.position).toEqual([0, 0, 0]);
    expect(right?.position).toEqual([6, 0, 0]);
  });

  it("places the set in the first piece's frame, so a turn comes with it", () => {
    const turned = {
      ...LEGS,
      pieces: LEGS.pieces.map((piece) =>
        piece.id === "left"
          ? {
              ...piece,
              rotation: [0, Math.PI / 2, 0] as [number, number, number],
            }
          : piece,
      ),
    };
    const right = liftLegs(turned).pieces.find(
      (piece) => piece.name === "right",
    );

    expect(right?.position[0]).toBeCloseTo(0);
    expect(right?.position[1]).toBeCloseTo(0);
    expect(right?.position[2]).toBeCloseTo(6);
  });

  it("takes a piece selected with its own ancestor once, under the ancestor", () => {
    const compound = selectionAsCompound(LEGS, ["left", "foot"], {
      id: "c1",
      now: "2026-07-28T00:00:00Z",
      newId: counter("new"),
    }) as LegoProject;

    expect(compound.pieces.map((piece) => piece.name)).toEqual([
      "left",
      "foot",
    ]);
    expect(childrenOf(compound, compound.rootPieceId)).toHaveLength(1);
  });

  it("is null when nothing in the selection is in the document", () => {
    expect(
      selectionAsCompound(LEGS, ["ghost"], {
        id: "c1",
        now: "2026-07-28T00:00:00Z",
        newId: counter("new"),
      }),
    ).toBeNull();
  });
});

describe("insertCompound", () => {
  const compound = subtreeAsCompound(TURRET, "turret", {
    id: "c1",
    now: "2026-07-28T00:00:00Z",
    newId: counter("c"),
  }) as LegoProject;

  it("hangs the compound's root off the chosen piece", () => {
    const host = project([{ id: "hull", name: "hull", parentId: "root" }]);

    const { project: after, rootPieceIds } = insertCompound(
      host,
      compound,
      "hull",
      counter("i"),
    );

    expect(after.pieces).toHaveLength(host.pieces.length + 3);
    expect(
      after.pieces.find((piece) => piece.id === rootPieceIds[0])?.parentId,
    ).toBe("hull");
  });

  it("falls back to the unit's root when the parent has gone", () => {
    const host = project([]);

    const { project: after, rootPieceIds } = insertCompound(
      host,
      compound,
      "ghost",
      counter("i"),
    );

    expect(
      after.pieces.find((piece) => piece.id === rootPieceIds[0])?.parentId,
    ).toBe("root");
  });

  it("renames pieces that clash with ones already in the unit", () => {
    const host = project([{ id: "b", name: "barrel", parentId: "root" }]);

    const { project: after } = insertCompound(
      host,
      compound,
      "root",
      counter("i"),
    );

    expect(after.pieces.map((piece) => piece.name)).toContain("barrel2");
    expect(
      after.pieces.filter((piece) => piece.name === "barrel"),
    ).toHaveLength(1);
  });

  it("keeps the compound's own hierarchy", () => {
    const host = project([]);

    const { project: after, rootPieceIds } = insertCompound(
      host,
      compound,
      "root",
      counter("i"),
    );
    const barrel = childrenOf(after, rootPieceIds[0])[0];

    expect(barrel.name).toBe("barrel");
    expect(childrenOf(after, barrel.id).map((piece) => piece.name)).toEqual([
      "flare",
    ]);
  });

  it("hangs every root of a compound made from a set off the same piece", () => {
    const host = project([{ id: "hull", name: "hull", parentId: "root" }]);

    const { project: after, rootPieceIds } = insertCompound(
      host,
      liftLegs(),
      "hull",
      counter("i"),
    );
    const roots = rootPieceIds.map((id) =>
      after.pieces.find((piece) => piece.id === id),
    );

    expect(rootPieceIds).toHaveLength(2);
    expect(roots.map((piece) => piece?.parentId)).toEqual(["hull", "hull"]);
    // Still six elmos apart, which is the point of pasting a set.
    expect(roots.map((piece) => piece?.position)).toEqual([
      [0, 0, 0],
      [6, 0, 0],
    ]);
    expect(after.pieces).toHaveLength(host.pieces.length + 3);
  });

  it("inserting twice gives two independent copies", () => {
    const host = project([]);

    const once = insertCompound(host, compound, "root", counter("a"));
    const twice = insertCompound(once.project, compound, "root", counter("b"));
    const ids = twice.project.pieces.map((piece) => piece.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(twice.project.pieces).toHaveLength(host.pieces.length + 6);
  });
});

describe("insertCompoundAt", () => {
  const compound = subtreeAsCompound(TURRET, "turret", {
    id: "c1",
    now: "2026-07-28T00:00:00Z",
    newId: counter("c"),
  }) as LegoProject;

  it("puts the source transform on the inserted root rather than the origin", () => {
    const host = project([{ id: "hull", name: "hull", parentId: "root" }]);

    const { project: after, rootPieceId } = insertCompoundAt(
      host,
      compound,
      "hull",
      { position: [0, 4, 0], rotation: [0, 1, 0], scale: [2, 2, 2] },
      counter("i"),
    );
    const root = after.pieces.find((piece) => piece.id === rootPieceId);

    expect(root?.position).toEqual([0, 4, 0]);
    expect(root?.rotation).toEqual([0, 1, 0]);
    expect(root?.scale).toEqual([2, 2, 2]);
  });

  it("leaves the rest of the compound's arrangement as insertCompound left it", () => {
    const host = project([{ id: "hull", name: "hull", parentId: "root" }]);

    const { project: after, rootPieceId } = insertCompoundAt(
      host,
      compound,
      "hull",
      { position: [0, 4, 0], rotation: [0, 1, 0], scale: [2, 2, 2] },
      counter("i"),
    );
    const barrel = childrenOf(after, rootPieceId)[0];

    expect(barrel.position).toEqual([0, 0, 3]);
  });
});

describe("validateCompoundName", () => {
  const compounds: LegoProject[] = [
    { ...project([]), id: "a", name: "turret" },
    { ...project([]), id: "b", name: "wheel" },
  ];

  it("accepts a name nothing else is using", () => {
    expect(validateCompoundName(compounds, "a", "hull")).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(validateCompoundName(compounds, "a", "   ")).toBe(
      "Name cannot be empty",
    );
  });

  it("rejects a name another compound already has, regardless of case", () => {
    expect(validateCompoundName(compounds, "a", "Wheel")).toBe(
      "Another compound already has this name",
    );
  });

  it("does not clash with the compound's own current name", () => {
    expect(validateCompoundName(compounds, "a", "turret")).toBeNull();
  });
});
