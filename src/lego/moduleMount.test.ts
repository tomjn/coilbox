import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { insertCompound, selectionAsCompound } from "./compounds";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
} from "./model";
import {
  clearStaleMount,
  defaultMount,
  insertModule,
  moduleConnectors,
} from "./moduleMount";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { worldMatrix } from "./reparent";

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

/** A hull 2 wide, 1 high and 4 long, and a leg 0.5 by 2 by 0.5. */
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

function doc(pieces: LegoPiece[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return { ...base, pieces: [...base.pieces, ...pieces] };
}

/** A unit with a hull on it. */
const UNIT = doc([piece({ id: "hull", partId: "hull" })]);

/** A module: a leg with a hull piece on top of it, anchored at the leg. */
const MODULE: LegoProject = {
  ...doc([
    piece({ id: "leg", partId: "leg" }),
    piece({
      id: "pod",
      partId: "hull",
      parentId: "leg",
      position: [0, 1.5, 0],
    }),
  ]),
  id: "module",
  rootPieceId: "leg",
  pieces: [
    piece({ id: "leg", partId: "leg", parentId: null }),
    piece({
      id: "pod",
      partId: "hull",
      parentId: "leg",
      position: [0, 1.5, 0],
    }),
  ],
};

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

function at(project: LegoProject, pieceId: string, local: Vec3): number[] {
  const p = new THREE.Vector3(...local).applyMatrix4(
    worldMatrix(project, pieceId),
  );
  return [p.x, p.y, p.z].map((n) => Math.round(n * 1e6) / 1e6 + 0);
}

describe("module mount on the document", () => {
  it("is read back from a saved module", () => {
    const json = JSON.stringify({
      ...MODULE,
      schemaVersion: 1,
      mount: { piece: "pod", connector: "-y" },
    });
    expect(parseLegoProjectJson(json)?.mount).toEqual({
      piece: "pod",
      connector: "-y",
    });
  });

  it("is absent for a module saved before mounts", () => {
    const json = JSON.stringify({ ...MODULE, schemaVersion: 1 });
    expect(parseLegoProjectJson(json)?.mount).toBeUndefined();
  });

  it("is dropped when it names a piece the module does not have", () => {
    const json = JSON.stringify({
      ...MODULE,
      schemaVersion: 1,
      mount: { piece: "gone", connector: "-y" },
    });
    expect(parseLegoProjectJson(json)?.mount).toBeUndefined();
  });

  it("is dropped when it is not a piece and a connector", () => {
    const json = JSON.stringify({
      ...MODULE,
      schemaVersion: 1,
      mount: { piece: "pod" },
    });
    expect(parseLegoProjectJson(json)?.mount).toBeUndefined();
  });

  it("is cleared when its piece is deleted", () => {
    const withMount = { ...MODULE, mount: { piece: "pod", connector: "-y" } };
    const without = {
      ...withMount,
      pieces: withMount.pieces.filter((p) => p.id !== "pod"),
    };
    expect(clearStaleMount(without).mount).toBeUndefined();
    expect(clearStaleMount(withMount)).toBe(withMount);
  });
});

describe("moduleConnectors", () => {
  it("lists the connectors of every piece of the module", () => {
    const list = moduleConnectors(MODULE, pack());
    expect(list.filter((c) => c.piece === "leg")).toHaveLength(6);
    expect(list.filter((c) => c.piece === "pod")).toHaveLength(6);
  });

  it("names a box's faces and the piece they are on", () => {
    const bottom = moduleConnectors(MODULE, pack()).find(
      (c) => c.piece === "leg" && c.connector === "-y",
    );
    expect(bottom?.label).toBe("leg, bottom");
  });
});

describe("defaultMount", () => {
  it("is the lowest face of the first piece", () => {
    expect(defaultMount(MODULE, pack())).toEqual({
      piece: "leg",
      connector: "-y",
    });
  });

  it("is none for a first piece with no part to join by", () => {
    const bare: LegoProject = {
      ...MODULE,
      pieces: [piece({ id: "leg", parentId: null })],
    };
    expect(defaultMount(bare, pack())).toBeNull();
  });
});

describe("insertModule", () => {
  it("lands the mount joined to a free face of the target", () => {
    const module = { ...MODULE, mount: { piece: "leg", connector: "-y" } };
    const out = insertModule(UNIT, module, "hull", counter("n"), pack());
    const leg = out.project.pieces.find((p) => p.id === out.rootPieceIds[0]);
    expect(leg?.parentId).toBe("hull");
    expect(leg?.connection).toEqual({ connector: "-y", to: "+y" });
    // The leg's bottom is on the hull's top, and its middle is a leg's
    // half length above that.
    expect(at(out.project, leg?.id as string, [0, -1, 0])).toEqual([0, 0.5, 0]);
    expect(at(out.project, leg?.id as string, [0, 0, 0])).toEqual([0, 1.5, 0]);
  });

  it("moves the rest of the module with its mount", () => {
    const module = { ...MODULE, mount: { piece: "leg", connector: "-y" } };
    const out = insertModule(UNIT, module, "hull", counter("n"), pack());
    const pod = out.project.pieces.find((p) => p.name === "pod");
    expect(at(out.project, pod?.id as string, [0, 0, 0])).toEqual([0, 3, 0]);
  });

  it("seats a mount on a deeper piece without joining it", () => {
    // The pod's bottom is the mount, so the pod sits on the hull and the leg
    // hangs below it.
    const module = { ...MODULE, mount: { piece: "pod", connector: "-y" } };
    const out = insertModule(UNIT, module, "hull", counter("n"), pack());
    const pod = out.project.pieces.find((p) => p.name === "pod");
    const anchor = out.project.pieces.find((p) => p.id === out.rootPieceIds[0]);
    expect(anchor?.connection).toBeUndefined();
    expect(at(out.project, pod?.id as string, [0, -0.5, 0])).toEqual([
      0, 0.5, 0,
    ]);
    expect(at(out.project, pod?.id as string, [0, 0, 0])).toEqual([0, 1, 0]);
  });

  it("takes the next free face for a second module", () => {
    const module = { ...MODULE, mount: { piece: "leg", connector: "-y" } };
    const first = insertModule(UNIT, module, "hull", counter("a"), pack());
    const second = insertModule(
      first.project,
      module,
      "hull",
      counter("b"),
      pack(),
    );
    const joined = second.project.pieces.find(
      (p) => p.id === second.rootPieceIds[0],
    );
    expect(joined?.connection?.to).toBe("+z");
  });

  it("puts the mount where the origin would have been when there is no face", () => {
    const module = { ...MODULE, mount: { piece: "leg", connector: "-y" } };
    const out = insertModule(UNIT, module, "root", counter("n"), pack());
    const leg = out.project.pieces.find((p) => p.id === out.rootPieceIds[0]);
    expect(leg?.connection).toBeUndefined();
    expect(at(out.project, leg?.id as string, [0, -1, 0])).toEqual([0, 0, 0]);
  });

  it("falls back to the origin when the mount names a missing connector", () => {
    const module = { ...MODULE, mount: { piece: "leg", connector: "nope" } };
    const out = insertModule(UNIT, module, "hull", counter("n"), pack());
    expect(out).toEqual(insertCompound(UNIT, MODULE, "hull", counter("n")));
  });

  it("is insertCompound for a module with no mount", () => {
    const out = insertModule(UNIT, MODULE, "hull", counter("n"), pack());
    expect(out).toEqual(insertCompound(UNIT, MODULE, "hull", counter("n")));
  });

  it("is insertCompound while the pack is not loaded", () => {
    const module = { ...MODULE, mount: { piece: "leg", connector: "-y" } };
    const out = insertModule(UNIT, module, "hull", counter("n"), null);
    expect(out).toEqual(insertCompound(UNIT, module, "hull", counter("n")));
  });

  it("keeps the spacing of a module made from several pieces", () => {
    const unit = doc([
      piece({ id: "hull", partId: "hull" }),
      piece({ id: "a", partId: "leg", position: [0, 0, 0] }),
      piece({ id: "b", partId: "leg", position: [3, 0, 0] }),
    ]);
    const set = selectionAsCompound(unit, ["a", "b"], {
      id: "set",
      now: "2026-10-17T00:00:00Z",
      newId: counter("s"),
    }) as LegoProject;
    const module = {
      ...set,
      mount: { piece: set.rootPieceId, connector: "-y" },
    };
    const out = insertModule(UNIT, module, "hull", counter("n"), pack());
    const [first, second] = out.rootPieceIds;
    const a = at(out.project, first, [0, 0, 0]);
    const b = at(out.project, second, [0, 0, 0]);
    expect(b[0] - a[0]).toBeCloseTo(3);
    expect(b[1] - a[1]).toBeCloseTo(0);
  });
});
