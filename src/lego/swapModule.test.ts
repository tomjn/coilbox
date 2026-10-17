import { describe, expect, it } from "vitest";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { placeModule } from "./moduleMount";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { swapModule } from "./swapModule";

type Vec3 = [number, number, number];

function part(id: string, min: Vec3, max: Vec3): LegoPartInfo {
  return {
    id,
    packId: "lego",
    shapeId: id,
    name: id,
    category: "grey",
    colourway: "grey",
    shape: "block",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 0,
    iFirst: 0,
    iCount: 0,
    bbox: { min, max },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
}

function pack(): LoadedPack {
  const parts = [
    part("hull", [-1, -0.5, -2], [1, 0.5, 2]),
    part("leg", [-0.25, -1, -0.25], [0.25, 1, 0.25]),
  ];
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  } as LoadedPack;
}

function piece(extra: Partial<LegoPiece> & { id: string }): LegoPiece {
  return {
    name: extra.id,
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

function doc(
  pieces: LegoPiece[],
  extra: Partial<LegoProject> = {},
): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return { ...base, ...extra, pieces: [...base.pieces, ...pieces] };
}

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

/** A module whose first piece is its root, and which joins by that piece. */
function moduleOf(
  id: string,
  pieces: LegoPiece[],
  extra: Partial<LegoProject> = {},
): LegoProject {
  return {
    ...doc([]),
    id,
    name: id,
    rootPieceId: pieces[0].id,
    pieces: pieces.map((p, i) => (i === 0 ? { ...p, parentId: null } : p)),
    mount: { piece: pieces[0].id, connector: "-y" },
    ...extra,
  };
}

/** A small arm: a base leg, an arm leg above it and a hull nozzle. */
const SMALL = moduleOf(
  "small",
  [
    piece({ id: "base", name: "stand", partId: "leg", role: "buildarm.base" }),
    piece({
      id: "arm",
      name: "arm",
      partId: "leg",
      parentId: "base",
      position: [0, 1.5, 0],
      role: "buildarm.arm",
    }),
    piece({
      id: "nozzle",
      name: "nozzle",
      partId: "hull",
      parentId: "arm",
      position: [0, 1.5, 0],
      role: "buildarm.nozzle",
    }),
  ],
  {
    category: "Arm",
    animations: [{ presetId: "buildarm", params: { period: 6 } }],
  },
);

/** A big arm of the same kind: a hull base with a leg arm on it. */
const BIG = moduleOf(
  "big",
  [
    piece({ id: "base", name: "stand", partId: "hull", role: "buildarm.base" }),
    piece({
      id: "arm",
      name: "arm",
      partId: "leg",
      parentId: "base",
      position: [0, 1.5, 0],
      role: "buildarm.arm",
    }),
  ],
  { category: "Arm", animations: [{ presetId: "buildarm", params: {} }] },
);

/** A module with no roles and no presets. */
const PLAIN = moduleOf("plain", [
  piece({ id: "block", name: "block", partId: "hull" }),
]);

const UNIT = doc([piece({ id: "hull", name: "hull", partId: "hull" })]);

/** The unit with SMALL on the front of its hull. */
function withSmall(): LegoProject {
  const placed = placeModule(
    UNIT,
    SMALL,
    pack(),
    { parentId: "hull", to: "+z" },
    { cycle: 0, twist: 0 },
    counter("a"),
  );
  if (!placed) throw new Error("the module did not place");
  return placed.project;
}

function byName(project: LegoProject, name: string) {
  return project.pieces.find((p) => p.name === name);
}

describe("swapModule", () => {
  it("replaces the instance's pieces with the new module's", () => {
    const start = withSmall();
    const arm = byName(start, "arm") as LegoPiece;
    const out = swapModule(start, pack(), arm.id, BIG, counter("b"));
    expect(out).not.toBeNull();
    const names = out?.project.pieces.map((p) => p.name);
    expect(names).toEqual(["base", "hull", "stand", "arm"]);
    expect(out?.project.pieces.some((p) => p.name === "nozzle")).toBe(false);
  });

  it("joins the new mount where the old root was joined", () => {
    const start = withSmall();
    const oldRoot = byName(start, "stand") as LegoPiece;
    const out = swapModule(start, pack(), oldRoot.id, BIG, counter("b"));
    const root = out?.project.pieces.find(
      (p) => p.id === out?.rootPieceIds[0],
    ) as LegoPiece;
    expect(root.parentId).toBe("hull");
    expect(root.connection?.to).toBe("+z");
    expect(root.connection?.connector).toBe("-y");
    expect(out?.broken).toEqual([]);
  });

  it("records the new module with an instance of its own", () => {
    const start = withSmall();
    const oldRoot = byName(start, "stand") as LegoPiece;
    const out = swapModule(start, pack(), oldRoot.id, BIG, counter("b"));
    const refs = out?.project.pieces.flatMap((p) =>
      p.module ? [p.module] : [],
    );
    expect(refs?.map((r) => r.id)).toEqual(["big", "big"]);
    expect(new Set(refs?.map((r) => r.instance)).size).toBe(1);
    expect(refs?.[0].instance).not.toBe(oldRoot.module?.instance);
  });

  it("gives a free root the old root's parent and transform", () => {
    const free = doc([
      piece({ id: "hull", name: "hull", partId: "hull" }),
      piece({
        id: "base",
        name: "stand",
        partId: "leg",
        parentId: "hull",
        position: [0.5, 2, -1],
        rotation: [0, 0.5, 0],
        scale: [2, 2, 2],
        module: { id: "small", instance: "i1" },
      }),
    ]);
    const out = swapModule(free, pack(), "base", PLAIN, counter("b"));
    const root = out?.project.pieces.find(
      (p) => p.id === out?.rootPieceIds[0],
    ) as LegoPiece;
    expect(root.parentId).toBe("hull");
    expect(root.position).toEqual([0.5, 2, -1]);
    expect(root.rotation).toEqual([0, 0.5, 0]);
    expect(root.scale).toEqual([2, 2, 2]);
    expect(root.connection).toBeUndefined();
  });

  it("keeps what was added from outside under the piece with the same role", () => {
    const start = withSmall();
    const arm = byName(start, "arm") as LegoPiece;
    const added = {
      ...start,
      pieces: [
        ...start.pieces,
        piece({ id: "light", name: "light", parentId: arm.id }),
      ],
    };
    const out = swapModule(added, pack(), arm.id, BIG, counter("b"));
    const light = byName(out?.project as LegoProject, "light");
    const newArm = byName(out?.project as LegoProject, "arm");
    expect(light?.parentId).toBe(newArm?.id);
    expect(out?.moved).toEqual([]);
  });

  it("moves it under the new root and says so when no piece shares the role", () => {
    const start = withSmall();
    const nozzle = byName(start, "nozzle") as LegoPiece;
    const added = {
      ...start,
      pieces: [
        ...start.pieces,
        piece({ id: "flare", name: "flare", parentId: nozzle.id }),
      ],
    };
    const out = swapModule(added, pack(), nozzle.id, BIG, counter("b"));
    const flare = byName(out?.project as LegoProject, "flare");
    expect(flare?.parentId).toBe(out?.rootPieceIds[0]);
    expect(out?.moved).toEqual(["flare"]);
  });

  it("leaves other instances of the same module alone", () => {
    const start = withSmall();
    const twice = placeModule(
      start,
      SMALL,
      pack(),
      { parentId: "hull", to: "-z" },
      { cycle: 0, twist: 0 },
      counter("c"),
    )?.project as LegoProject;
    const first = twice.pieces.find((p) => p.module?.id === "small");
    const out = swapModule(
      twice,
      pack(),
      first?.id as string,
      BIG,
      counter("b"),
    );
    expect(
      out?.project.pieces.filter((p) => p.module?.id === "small"),
    ).toHaveLength(3);
    expect(
      out?.project.pieces.filter((p) => p.module?.id === "big"),
    ).toHaveLength(2);
  });

  it("is null for a piece that came from no module", () => {
    expect(swapModule(UNIT, pack(), "hull", BIG, counter("b"))).toBeNull();
    expect(swapModule(UNIT, pack(), "nope", BIG, counter("b"))).toBeNull();
  });

  describe("presets", () => {
    it("keeps a preset the new module also uses, with the unit's parameters", () => {
      const start = withSmall();
      const root = byName(start, "stand") as LegoPiece;
      const out = swapModule(start, pack(), root.id, BIG, counter("b"));
      expect(out?.project.animations).toEqual([
        { presetId: "buildarm", params: { period: 6 } },
      ]);
      expect(out?.removedPresets).toEqual([]);
    });

    it("removes a preset no piece uses any more and says which", () => {
      const start = withSmall();
      const root = byName(start, "stand") as LegoPiece;
      const out = swapModule(start, pack(), root.id, PLAIN, counter("b"));
      expect(out?.project.animations).toBeUndefined();
      expect(out?.removedPresets).toEqual(["buildarm"]);
    });

    it("keeps a preset the rest of the unit still uses", () => {
      const start = withSmall();
      const root = byName(start, "stand") as LegoPiece;
      const second = {
        ...start,
        pieces: [
          ...start.pieces,
          piece({ id: "other", name: "other", role: "buildarm.arm" }),
        ],
      };
      const out = swapModule(second, pack(), root.id, PLAIN, counter("b"));
      expect(out?.removedPresets).toEqual([]);
      expect(out?.project.animations).toHaveLength(1);
    });

    it("adds the new module's presets the way an insert does", () => {
      const start = {
        ...withSmall(),
        animations: undefined,
      } as LegoProject;
      const root = byName(start, "stand") as LegoPiece;
      const out = swapModule(start, pack(), root.id, BIG, counter("b"));
      expect(out?.presets.added).toEqual(["buildarm"]);
      expect(out?.project.animations).toEqual([
        { presetId: "buildarm", params: {} },
      ]);
    });
  });
});
