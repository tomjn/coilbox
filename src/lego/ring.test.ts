/**
 * Symmetry around the vertical axis (issue #3317): a ring of copies of a piece,
 * evenly spaced about the root's vertical axis.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { insertCompound, selectionAsCompound } from "./compounds";
import { connectPiece } from "./connectors";
import { withoutDanglingTwins } from "./mirror";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
  projectProblems,
} from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { worldMatrix } from "./reparent";
import {
  canRingTwin,
  followRing,
  onAxis,
  resizeRing,
  ringTwins,
  unringPiece,
} from "./ring";
import { RING_MAX, RING_MIN, ringMembers } from "./ringSet";

type Vec3 = [number, number, number];

function project(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
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
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
        ...piece,
      })),
    ],
  };
}

let issued = 0;
/** Ids that never repeat across a file, so two calls cannot collide. */
function ids() {
  return () => `n${++issued}`;
}

function round(values: number[]): number[] {
  return values.map((n) => Number(n.toFixed(5)) + 0);
}

function origin(doc: LegoProject, id: string): number[] {
  const point = new THREE.Vector3().applyMatrix4(worldMatrix(doc, id));
  return round([point.x, point.y, point.z]);
}

function pieceOf(doc: LegoProject, id: string): LegoPiece {
  return doc.pieces.find((piece) => piece.id === id) as LegoPiece;
}

function ringOf(doc: LegoProject, id: string): LegoProject {
  const out = ringTwins(doc, id, 3, ids());
  if (!out) throw new Error("no ring");
  return out.project;
}

describe("which pieces can be given a ring", () => {
  const doc = project([{ id: "leg", position: [3, 0, 0] }, { id: "mast" }]);

  it("allows a piece off the vertical axis", () => {
    expect(canRingTwin(doc, "leg")).toBe(true);
  });

  it("refuses a piece on the axis at any height, which is its own copy", () => {
    const high = project([{ id: "mast", position: [0, 4, 0] }]);
    expect(onAxis(high, "mast")).toBe(true);
    expect(canRingTwin(high, "mast")).toBe(false);
  });

  it("allows a piece on the centre line but off the axis", () => {
    // A mirror would call this on the centre line. A ring does not.
    const ahead = project([{ id: "nose", position: [0, 0, 3] }]);
    expect(canRingTwin(ahead, "nose")).toBe(true);
  });

  it("refuses the root and a piece that is not there", () => {
    expect(canRingTwin(doc, "root")).toBe(false);
    expect(canRingTwin(doc, "ghost")).toBe(false);
  });

  it("measures the axis in the root's space, through a moved parent", () => {
    const doc = project([
      { id: "arm", position: [5, 0, 0] },
      { id: "tip", parentId: "arm", position: [-5, 2, 0] },
      { id: "elbow", parentId: "arm", position: [1, 2, 0] },
    ]);
    expect(onAxis(doc, "tip")).toBe(true);
    expect(onAxis(doc, "elbow")).toBe(false);
  });
});

describe("giving a piece a ring", () => {
  it("adds count - 1 copies at whole fractions of a turn", () => {
    const doc = project([{ id: "leg", position: [3, 1, 0] }]);
    const out = ringTwins(doc, "leg", 3, ids());
    if (!out) throw new Error("no ring");
    expect(out.ids).toHaveLength(2);
    expect(origin(out.project, "leg")).toEqual([3, 1, 0]);
    const [a, b] = out.ids;
    // Three copies are at 0, 120 and 240 degrees.
    expect(origin(out.project, a)).toEqual(
      round([-1.5, 1, -3 * Math.sin(Math.PI / 3)]),
    );
    expect(origin(out.project, b)).toEqual(
      round([-1.5, 1, 3 * Math.sin(Math.PI / 3)]),
    );
  });

  it("turns about the root's axis, not the world's", () => {
    const doc = project([{ id: "leg", position: [2, 0, 0] }]);
    const moved: LegoProject = {
      ...doc,
      pieces: doc.pieces.map((piece) =>
        piece.id === "root"
          ? { ...piece, position: [10, 0, 0] as Vec3 }
          : piece,
      ),
    };
    const out = ringTwins(moved, "leg", 2, ids());
    if (!out) throw new Error("no ring");
    expect(origin(out.project, out.ids[0])).toEqual([8, 0, 0]);
  });

  it("turns about the root's axis when the root is turned", () => {
    const doc = project([{ id: "leg", position: [2, 0, 0] }]);
    const turned: LegoProject = {
      ...doc,
      pieces: doc.pieces.map((piece) =>
        piece.id === "root"
          ? { ...piece, rotation: [0, Math.PI / 2, 0] as Vec3 }
          : piece,
      ),
    };
    const out = ringTwins(turned, "leg", 4, ids());
    if (!out) throw new Error("no ring");
    const spots = [pieceOf(turned, "leg").id, ...out.ids].map((id) =>
      origin(out.project, id),
    );
    // Four spots, each two from the axis and a quarter turn from the next.
    for (const spot of spots) {
      expect(Math.hypot(spot[0], spot[2])).toBeCloseTo(2, 4);
    }
    expect(new Set(spots.map((s) => s.join(","))).size).toBe(4);
  });

  it("makes proper rotations with no negative scale", () => {
    const doc = project([{ id: "leg", position: [3, 0, 1], scale: [1, 2, 3] }]);
    const out = ringTwins(doc, "leg", 5, ids());
    if (!out) throw new Error("no ring");
    for (const id of out.ids) {
      expect(pieceOf(out.project, id).scale.every((s) => s > 0)).toBe(true);
      expect(worldMatrix(out.project, id).determinant()).toBeGreaterThan(0);
    }
  });

  it("carries the subtree and keeps roles", () => {
    const doc = project([
      { id: "thigh", position: [3, 0, 0], role: "leg.l1.thigh" },
      {
        id: "shin",
        parentId: "thigh",
        position: [0, -1, 0],
        role: "leg.l1.shin",
      },
    ]);
    const out = ringTwins(doc, "thigh", 3, ids());
    if (!out) throw new Error("no ring");
    const copy = pieceOf(out.project, out.ids[0]);
    expect(copy.role).toBe("leg.l1.thigh");
    const shin = out.project.pieces.find(
      (piece) => piece.parentId === copy.id,
    ) as LegoPiece;
    expect(shin.role).toBe("leg.l1.shin");
    expect(out.project.pieces).toHaveLength(doc.pieces.length + 4);
  });

  it("gives every copy a name of its own", () => {
    const doc = project([{ id: "leg", name: "leg", position: [3, 0, 0] }]);
    const out = ringTwins(doc, "leg", 4, ids());
    if (!out) throw new Error("no ring");
    expect(projectProblems(out.project)).toEqual([]);
  });

  it("gives each copy a module instance of its own", () => {
    const doc = project([
      {
        id: "wheel",
        position: [3, 0, 0],
        module: { id: "wheel", instance: "i1" },
      },
    ]);
    const out = ringTwins(doc, "wheel", 3, ids());
    if (!out) throw new Error("no ring");
    const instances = [...out.ids, "wheel"].map(
      (id) => pieceOf(out.project, id).module?.instance,
    );
    expect(new Set(instances).size).toBe(3);
  });

  it("links the copies into one ring that every member can lead", () => {
    const out = ringTwins(
      project([{ id: "leg", position: [3, 0, 0] }]),
      "leg",
      4,
      ids(),
    );
    if (!out) throw new Error("no ring");
    const all = new Set(["leg", ...out.ids]);
    for (const id of all) {
      const members = ringMembers(out.project.pieces, id);
      expect(members?.[0]).toBe(id);
      expect(new Set(members)).toEqual(all);
    }
  });

  it("hangs a child's copies off the copies of its parent", () => {
    const doc = ringOf(
      project([
        { id: "thigh", position: [3, 0, 0] },
        { id: "shin", parentId: "thigh", position: [0, -1, 0] },
      ]),
      "thigh",
    );
    const thighs = ringMembers(doc.pieces, "thigh") as string[];
    const withFoot: LegoProject = {
      ...doc,
      pieces: [
        ...doc.pieces,
        {
          ...pieceOf(doc, "shin"),
          id: "foot",
          name: "foot",
          position: [0, -1, 0],
          parentId: "thigh",
        },
      ],
    };
    const out = ringTwins(withFoot, "foot", 3, ids());
    if (!out) throw new Error("no ring");
    const parents = out.ids.map((id) => pieceOf(out.project, id).parentId);
    expect(parents).toEqual(thighs.slice(1));
  });

  it("refuses a piece on the axis", () => {
    const doc = project([{ id: "mast", position: [0, 3, 0] }]);
    expect(ringTwins(doc, "mast", 3, ids())).toBeNull();
  });

  it("refuses a count outside the limits", () => {
    const doc = project([{ id: "leg", position: [3, 0, 0] }]);
    expect(ringTwins(doc, "leg", RING_MIN - 1, ids())).toBeNull();
    expect(ringTwins(doc, "leg", RING_MAX + 1, ids())).toBeNull();
    expect(ringTwins(doc, "leg", 2.5, ids())).toBeNull();
  });
});

describe("keeping a ring in step", () => {
  it("moves the others by the same rotation", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const members = ringMembers(doc.pieces, "leg") as string[];
    const moved: LegoProject = {
      ...doc,
      pieces: doc.pieces.map((piece) =>
        piece.id === "leg" ? { ...piece, position: [5, 2, 1] as Vec3 } : piece,
      ),
    };
    const out = followRing(moved, "leg");
    const r = Math.hypot(5, 1);
    for (const id of members.slice(1)) {
      const spot = origin(out, id);
      expect(Math.hypot(spot[0], spot[2])).toBeCloseTo(r, 4);
      expect(spot[1]).toBe(2);
    }
    expect(new Set(members.map((id) => origin(out, id).join(","))).size).toBe(
      3,
    );
  });

  it("lets a copy lead", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const members = ringMembers(doc.pieces, "leg") as string[];
    const lead = members[1];
    const moved: LegoProject = {
      ...doc,
      pieces: doc.pieces.map((piece) =>
        piece.id === lead ? { ...piece, position: [0, 0, 6] as Vec3 } : piece,
      ),
    };
    const out = followRing(moved, lead);
    expect(
      Math.hypot(origin(out, "leg")[0], origin(out, "leg")[2]),
    ).toBeCloseTo(6, 4);
  });

  it("turns each copy with the piece", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const members = ringMembers(doc.pieces, "leg") as string[];
    const turned: LegoProject = {
      ...doc,
      pieces: doc.pieces.map((piece) =>
        piece.id === "leg"
          ? { ...piece, rotation: [0.4, 0, 0] as Vec3 }
          : piece,
      ),
    };
    const out = followRing(turned, "leg");
    const tip = (id: string) =>
      new THREE.Vector3(0, 1, 0)
        .applyMatrix4(worldMatrix(out, id))
        .sub(new THREE.Vector3().applyMatrix4(worldMatrix(out, id)));
    // The up axis is unchanged by a turn about the vertical axis.
    for (const id of members)
      expect(round([tip(id).y])).toEqual(round([tip("leg").y]));
  });

  it("returns the document untouched for a piece with no ring", () => {
    const doc = project([{ id: "leg", position: [3, 0, 0] }]);
    expect(followRing(doc, "leg")).toBe(doc);
  });

  it("quietly stops when a member has gone", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const members = ringMembers(doc.pieces, "leg") as string[];
    const gone: LegoProject = {
      ...doc,
      pieces: doc.pieces.filter((piece) => piece.id !== members[1]),
    };
    expect(followRing(gone, "leg")).toBe(gone);
  });
});

describe("joins", () => {
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
      part("leg", [-0.25, -1, -0.5], [0.5, 1, 0.25]),
    ];
    return {
      manifest: {} as LoadedPack["manifest"],
      library: { packs: [], atlases: [], dir: "", problems: [] },
      parts,
      byId: new Map(parts.map((p) => [p.id, p])),
      vertices: new Float32Array(),
      indices: new Uint16Array(),
    };
  }
  const joined = connectPiece(
    project([
      { id: "hull", partId: "hull" },
      { id: "leg", partId: "leg", parentId: "hull" },
    ]),
    pack(),
    "leg",
    { connector: "-x", to: "+x" },
  );

  it("joins a half-turn copy to the opposite face by the same connector", () => {
    const out = ringTwins(joined, "leg", 2, ids(), pack());
    if (!out) throw new Error("no ring");
    const copy = pieceOf(out.project, out.ids[0]);
    expect(copy.connection?.to).toBe("-x");
    expect(copy.connection?.connector).toBe("-x");
  });

  it("leaves a copy free where its parent has no face", () => {
    const out = ringTwins(joined, "leg", 3, ids(), pack());
    if (!out) throw new Error("no ring");
    expect(pieceOf(out.project, out.ids[0]).connection).toBeUndefined();
  });

  it("keeps a following copy joined", () => {
    const out = ringTwins(joined, "leg", 2, ids(), pack());
    if (!out) throw new Error("no ring");
    const followed = followRing(out.project, "leg", pack());
    expect(pieceOf(followed, out.ids[0]).connection?.to).toBe("-x");
  });
});

describe("changing the count", () => {
  it("adds copies and spaces the whole ring again", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const out = resizeRing(doc, "leg", 5, ids());
    const members = ringMembers(out.pieces, "leg") as string[];
    expect(members).toHaveLength(5);
    expect(out.pieces.filter((piece) => piece.ring)).toHaveLength(5);
    const angles = members.map((id) => {
      const spot = origin(out, id);
      return (
        Math.round((Math.atan2(-spot[2], spot[0]) * 180) / Math.PI + 360) % 360
      );
    });
    expect([...angles].sort((a, b) => a - b)).toEqual([0, 72, 144, 216, 288]);
    expect(members.every((id) => pieceOf(out, id).ring?.count === 5)).toBe(
      true,
    );
    expect(projectProblems(out)).toEqual([]);
  });

  it("removes copies with their subtrees and keeps the one that leads", () => {
    const doc = ringOf(
      project([
        { id: "thigh", position: [3, 0, 0] },
        { id: "shin", parentId: "thigh", position: [0, -1, 0] },
      ]),
      "thigh",
    );
    // ringTwins copied the shin too: three thighs and three shins.
    const out = resizeRing(doc, "thigh", 2, ids());
    const members = ringMembers(out.pieces, "thigh") as string[];
    expect(members).toHaveLength(2);
    expect(out.pieces.length).toBe(doc.pieces.length - 2);
    expect(pieceOf(out, "thigh")).toBeDefined();
    expect(projectProblems(out)).toEqual([]);
    const spot = origin(out, members[1]);
    expect(spot).toEqual([-3, 0, 0]);
  });

  it("is a no-op at the same count", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    expect(resizeRing(doc, "leg", 3, ids())).toBe(doc);
  });

  it("refuses a count outside the limits", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    expect(resizeRing(doc, "leg", RING_MIN - 1, ids())).toBe(doc);
    expect(resizeRing(doc, "leg", RING_MAX + 1, ids())).toBe(doc);
  });

  it("is a no-op for a piece with no ring", () => {
    const doc = project([{ id: "leg", position: [3, 0, 0] }]);
    expect(resizeRing(doc, "leg", 4, ids())).toBe(doc);
  });
});

describe("changing the count of a ring with rings under it", () => {
  /** `count` thighs round the axis, each with a chain of children one level
   *  down per name, every level a ring of the same count. */
  function legs(
    count: number,
    names: string[],
    options: { counts?: Record<string, number> } = {},
  ): LegoProject {
    const pieces: Partial<LegoPiece>[] = [];
    names.forEach((name, level) => {
      const n = options.counts?.[name] ?? count;
      for (let i = 0; i < n; i++) {
        const angle = (i * 2 * Math.PI) / n;
        pieces.push({
          id: `${name}${i}`,
          parentId: level === 0 ? "root" : `${names[level - 1]}${i % count}`,
          position:
            level === 0
              ? [3 * Math.cos(angle), 0, -3 * Math.sin(angle)]
              : [0, -level, 0.5 * level],
          rotation: level === 0 ? [0, angle, 0] : [0, 0, 0],
          ring: { next: `${name}${(i + 1) % n}`, count: n },
        });
      }
    });
    return project(pieces);
  }

  function chain(doc: LegoProject, name: string): string[] {
    return ringMembers(doc.pieces, `${name}0`) as string[];
  }

  it("resizes a shin ring with its thigh ring, up and down", () => {
    const doc = legs(6, ["thigh", "shin"]);
    const up = resizeRing(doc, "thigh0", 8, ids());
    const thighs = chain(up, "thigh");
    const shins = chain(up, "shin");
    expect(thighs).toHaveLength(8);
    expect(shins).toHaveLength(8);
    expect(up.pieces.filter((piece) => piece.ring)).toHaveLength(16);
    shins.forEach((id, i) => {
      const shin = pieceOf(up, id);
      expect(shin.parentId).toBe(thighs[i]);
      expect(shin.position).toEqual([0, -1, 0.5]);
      expect(shin.ring?.count).toBe(8);
    });
    expect(up.pieces.filter((piece) => piece.parentId === "root")).toHaveLength(
      8,
    );
    expect(projectProblems(up)).toEqual([]);

    const down = resizeRing(up, "thigh0", 4, ids());
    expect(chain(down, "thigh")).toHaveLength(4);
    const kept = chain(down, "shin");
    expect(kept).toHaveLength(4);
    kept.forEach((id, i) => {
      expect(pieceOf(down, id).parentId).toBe(chain(down, "thigh")[i]);
    });
    expect(down.pieces).toHaveLength(1 + 8);
    expect(projectProblems(down)).toEqual([]);
  });

  it("resizes a ring three deep", () => {
    const doc = legs(3, ["thigh", "shin", "foot"]);
    const out = resizeRing(doc, "thigh0", 5, ids());
    for (const name of ["thigh", "shin", "foot"]) {
      expect(chain(out, name)).toHaveLength(5);
    }
    const [thighs, shins, feet] = ["thigh", "shin", "foot"].map((n) =>
      chain(out, n),
    );
    shins.forEach((id, i) => {
      expect(pieceOf(out, id).parentId).toBe(thighs[i]);
    });
    feet.forEach((id, i) => {
      expect(pieceOf(out, id).parentId).toBe(shins[i]);
      expect(pieceOf(out, id).position).toEqual([0, -2, 1]);
    });
    expect(projectProblems(out)).toEqual([]);
    const back = resizeRing(out, "thigh0", 2, ids());
    expect(back.pieces).toHaveLength(1 + 6);
    expect(chain(back, "foot")).toHaveLength(2);
  });

  it("starts a ring from any thigh", () => {
    const doc = legs(4, ["thigh", "shin"]);
    const out = resizeRing(doc, "thigh2", 6, ids());
    expect(ringMembers(out.pieces, "shin2")).toHaveLength(6);
    expect(ringMembers(out.pieces, "shin0")).toHaveLength(6);
  });

  it("keeps plain children as plain copies", () => {
    const doc = legs(3, ["thigh", "shin"]);
    const { ring: _none, ...knob } = pieceOf(doc, "shin0");
    const withKnob: LegoProject = {
      ...doc,
      pieces: [
        ...doc.pieces,
        { ...knob, id: "knob", name: "knob", parentId: "thigh0" },
      ],
    };
    const out = resizeRing(withKnob, "thigh0", 5, ids());
    // The one knob gains a copy under each of the two new thighs.
    const knobs = out.pieces.filter((piece) => piece.name.startsWith("knob"));
    expect(knobs).toHaveLength(3);
    expect(knobs.every((piece) => piece.ring === undefined)).toBe(true);
    expect(chain(out, "shin")).toHaveLength(5);
  });

  it("keeps a joined child joined to its own parent copy", () => {
    const doc = legs(3, ["thigh", "shin"]);
    const joinedDoc: LegoProject = {
      ...doc,
      pieces: doc.pieces.map((piece) =>
        piece.id.startsWith("shin")
          ? { ...piece, connection: { connector: "top", to: "bottom" } }
          : piece,
      ),
    };
    const out = resizeRing(joinedDoc, "thigh0", 4, ids());
    const copy = pieceOf(out, chain(out, "shin")[3]);
    expect(copy.parentId).toBe(chain(out, "thigh")[3]);
    expect(copy.connection).toEqual({ connector: "top", to: "bottom" });
    expect(projectProblems(out)).toEqual([]);
  });

  it("keeps mirrored twins among the children paired", () => {
    const doc = legs(3, ["thigh", "shin"]);
    const { ring: _none, ...base } = pieceOf(doc, "shin0");
    const twinned: LegoProject = {
      ...doc,
      pieces: [
        ...doc.pieces,
        { ...base, id: "a", name: "a", twin: "b", parentId: "thigh0" },
        { ...base, id: "b", name: "b", twin: "a", parentId: "thigh0" },
      ],
    };
    const out = resizeRing(twinned, "thigh0", 4, ids());
    const pairs = out.pieces.filter((piece) => piece.twin !== undefined);
    expect(pairs).toHaveLength(4);
    for (const piece of pairs) {
      const other = pieceOf(out, piece.twin as string);
      expect(other.twin).toBe(piece.id);
      expect(other.parentId).toBe(piece.parentId);
    }
    expect(projectProblems(out)).toEqual([]);
  });

  it("leaves a child ring with a different count as it was", () => {
    // Two shins per three thighs is not one per parent.
    const doc = legs(3, ["thigh", "shin"], { counts: { shin: 2 } });
    const out = resizeRing(doc, "thigh0", 4, ids());
    expect(chain(out, "thigh")).toHaveLength(4);
    expect(out.pieces.filter((piece) => piece.name.startsWith("shin"))).toEqual(
      doc.pieces.filter((piece) => piece.name.startsWith("shin")).concat([]),
    );
  });
});

describe("a ring saved with the unit", () => {
  it("survives a reload", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const again = parseLegoProjectJson(JSON.stringify(doc));
    if (!again) throw new Error("did not reload");
    expect(ringMembers(again.pieces, "leg")).toEqual(
      ringMembers(doc.pieces, "leg"),
    );
    expect(again.pieces.find((p) => p.id === "leg")?.ring?.count).toBe(3);
  });

  it("leaves a mirror pair and an old unit as they were", () => {
    const old = parseLegoProjectJson(
      JSON.stringify(
        project([
          { id: "left", twin: "right" },
          { id: "right", twin: "left" },
        ]),
      ),
    );
    expect(old?.pieces.find((p) => p.id === "left")?.twin).toBe("right");
    expect(old?.pieces.every((p) => p.ring === undefined)).toBe(true);
  });

  it("ignores a malformed ring field", () => {
    const raw = JSON.parse(JSON.stringify(project([{ id: "leg" }])));
    raw.pieces[1].ring = { next: 4, count: "x" };
    const again = parseLegoProjectJson(JSON.stringify(raw));
    expect(again?.pieces.find((p) => p.id === "leg")?.ring).toBeUndefined();
  });

  it("reports a ring that does not close", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const members = ringMembers(doc.pieces, "leg") as string[];
    const cut: LegoProject = {
      ...doc,
      pieces: doc.pieces.filter((piece) => piece.id !== members[1]),
    };
    expect(projectProblems(cut).length).toBeGreaterThan(0);
  });

  it("lets go of the rest of a ring when one member is deleted", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const members = ringMembers(doc.pieces, "leg") as string[];
    const cut = withoutDanglingTwins({
      ...doc,
      pieces: doc.pieces.filter((piece) => piece.id !== members[1]),
    });
    expect(cut.pieces.every((piece) => piece.ring === undefined)).toBe(true);
    expect(projectProblems(cut)).toEqual([]);
  });

  it("breaks a whole ring", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const out = unringPiece(doc, "leg");
    expect(out.pieces.every((piece) => piece.ring === undefined)).toBe(true);
    expect(out.pieces).toHaveLength(doc.pieces.length);
  });
});

describe("copying a ring", () => {
  const stamp = { id: "set", now: "2026-10-17T00:00:00Z" };

  it("remaps the ring when every member is copied", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const members = ringMembers(doc.pieces, "leg") as string[];
    const newId = ids();
    const set = selectionAsCompound(doc, members, {
      ...stamp,
      newId,
    }) as LegoProject;
    const inserted = insertCompound(doc, set, "root", newId);
    const copies = inserted.rootPieceIds;
    expect(copies).toHaveLength(3);
    const again = ringMembers(inserted.project.pieces, copies[0]);
    expect(new Set(again)).toEqual(new Set(copies));
    expect(projectProblems(inserted.project)).toEqual([]);
  });

  it("drops the ring from a copy of part of one", () => {
    const doc = ringOf(project([{ id: "leg", position: [3, 0, 0] }]), "leg");
    const members = ringMembers(doc.pieces, "leg") as string[];
    const newId = ids();
    const part = selectionAsCompound(doc, members.slice(0, 2), {
      ...stamp,
      newId,
    }) as LegoProject;
    const inserted = insertCompound(doc, part, "root", newId);
    const copies = inserted.project.pieces.filter((p) =>
      inserted.rootPieceIds.includes(p.id),
    );
    expect(copies.every((piece) => piece.ring === undefined)).toBe(true);
    // The original ring is untouched.
    expect(ringMembers(inserted.project.pieces, "leg")).toHaveLength(3);
  });
});
