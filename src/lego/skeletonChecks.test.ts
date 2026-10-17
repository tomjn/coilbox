import { describe, expect, it } from "vitest";

import { SAME_POSITION } from "./balance";
import {
  BIPED,
  BODY_PLANS,
  type BodyPlan,
  planProportions,
  projectFromPlan,
  QUADRUPED,
} from "./bodyPlans";
import type { LegoPiece, LegoProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { attachToBone } from "./partOnBone";
import { SAME_PLACE } from "./reparent";
import { skeletonProblems } from "./skeletonChecks";

/** A unit cube centred on its own origin, so its pivot starts at the middle. */
function pack(): LoadedPack {
  const c = 0.5;
  const corners = [
    [-c, -c, -c],
    [c, -c, -c],
    [c, -c, c],
    [-c, -c, c],
    [-c, c, -c],
    [c, c, -c],
    [c, c, c],
    [-c, c, c],
  ];
  const solid = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2,
    3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ];
  const vertices: number[] = [];
  for (const p of corners) vertices.push(...p, 0, 1, 0, 0, 0);
  const block: LegoPartInfo = {
    id: "block",
    packId: "lego",
    shapeId: "block",
    name: "block",
    category: "grey",
    colourway: "grey",
    shape: "block",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: corners.length,
    iFirst: 0,
    iCount: solid.length,
    bbox: { min: [-c, -c, -c], max: [c, c, c] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [block],
    byId: new Map([["block", block]]),
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(solid),
  };
}

const PACK = pack();
const BLOCK = PACK.byId.get("block") as LegoPartInfo;

function unit(plan: BodyPlan = BIPED, proportions?: Record<string, number>) {
  let n = 0;
  return projectFromPlan(plan, {
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
    newId: () => `b${n++}`,
    proportions,
  });
}

function bone(doc: LegoProject, id: string): LegoPiece {
  return doc.pieces.find((p) => p.bone === id) as LegoPiece;
}

function change(
  doc: LegoProject,
  id: string,
  patch: Partial<LegoPiece>,
): LegoProject {
  return {
    ...doc,
    pieces: doc.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  };
}

function add(doc: LegoProject, piece: Partial<LegoPiece> & { id: string }) {
  return {
    ...doc,
    pieces: [
      ...doc.pieces,
      {
        name: piece.id,
        parentId: "root",
        partId: "block",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        ...piece,
      } as LegoPiece,
    ],
  };
}

const run = (doc: LegoProject) => skeletonProblems(doc, PACK, null);

/** Just the foot and wheel problems. */
const ground = (doc: LegoProject) =>
  run(doc).filter((p) => p.message.includes("the ground"));

describe("a foot off the ground", () => {
  it("finds nothing on any body plan at its default or at either end of each proportion", () => {
    // The measured spread: how far from y = 0 the lowest point of any foot or
    // wheel bone lands, over every plan and every proportion at its smallest,
    // default and largest. It decides whether SAME_POSITION is a fit tolerance.
    let widest = 0;
    for (const plan of BODY_PLANS) {
      const settings: Record<string, number>[] = [{}];
      for (const proportion of plan.proportions) {
        settings.push({ [proportion.id]: proportion.min });
        settings.push({ [proportion.id]: proportion.max });
      }
      for (const given of settings) {
        const doc = unit(plan, given);
        const values = planProportions(plan, given);
        const feet = plan
          .bones(values)
          .filter((b) => /^leg\.[lr][12]\.foot$/.test(b.role ?? ""));
        expect(
          run(doc).filter((p) => p.source === "skeleton"),
          plan.id,
        ).toEqual([]);
        // The foot bone's own height, summed down its chain from the plan.
        for (const foot of feet) {
          let y = 0;
          let at: typeof foot | undefined = foot;
          while (at) {
            y += at.position[1];
            at = plan.bones(values).find((b) => b.id === at?.parent);
          }
          widest = Math.max(widest, Math.abs(y));
        }
      }
    }
    expect(widest).toBeLessThan(SAME_POSITION);
  });

  it("reports a foot bone raised off the ground and selects it", () => {
    const doc = unit();
    const foot = bone(doc, "foot.l1");
    const raised = change(doc, foot.id, {
      position: [0, foot.position[1] + 2, 0],
    });
    const found = ground(raised);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      source: "skeleton",
      severity: "warning",
      pieceIds: [foot.id],
    });
    expect(found[0].message).toBe('"lfoot" is 2 elmos above the ground.');
  });

  it("reports a foot below the ground", () => {
    const doc = unit();
    const foot = bone(doc, "foot.r1");
    const found = ground(
      change(doc, foot.id, { position: [0, foot.position[1] - 1.5, 0] }),
    );
    expect(found.map((p) => p.message)).toEqual([
      '"rfoot" is 1.5 elmos below the ground.',
    ]);
  });

  it("lets a foot sit within the tolerance of the ground", () => {
    const doc = unit();
    const foot = bone(doc, "foot.l1");
    const near = change(doc, foot.id, {
      position: [0, foot.position[1] + SAME_POSITION / 2, 0],
    });
    expect(ground(near)).toEqual([]);
  });

  it("measures the lowest point of the piece and what hangs from it", () => {
    const doc = unit();
    const foot = bone(doc, "foot.l1");
    // The foot's own block rests on the ground, and a toe block hangs below it.
    const withBlock = change(doc, foot.id, { partId: "block" });
    const settled = change(withBlock, foot.id, {
      position: [0, foot.position[1] + 0.5, 0],
    });
    expect(ground(settled)).toEqual([]);
    const withToe = add(settled, {
      id: "toe",
      parentId: foot.id,
      position: [0, -1, 0],
    });
    expect(ground(withToe).map((p) => p.message)).toEqual([
      '"lfoot" is 1 elmos below the ground.',
    ]);
  });

  it("checks a wheel by its tread and leaves a bare wheel bone alone", () => {
    const doc = unit();
    const wheeled = add(doc, {
      id: "wheel",
      role: "wheel",
      position: [3, 2, 0],
    });
    // The block's lowest point is half an elmo under its origin: 1.5 up.
    expect(ground(wheeled).map((p) => p.message)).toEqual([
      '"wheel" is 1.5 elmos above the ground.',
    ]);
    const bare = add(doc, {
      id: "axle",
      role: "wheel",
      partId: null,
      position: [3, 2, 0],
    });
    expect(ground(bare)).toEqual([]);
  });

  it("leaves a unit with no foot or wheel alone", () => {
    expect(run(add(unit(), { id: "hat", position: [0, 9, 0] }))).toEqual([]);
  });
});

describe("a pivot away from its joint", () => {
  function legWithBlock(role: string, pivot?: [number, number, number]) {
    return add(unit(), { id: "limb", role, pivot, position: [0, 20, 0] });
  }

  it("reports a thigh turning about the middle of its part", () => {
    const found = run(legWithBlock("leg.l1.thigh")).filter((p) =>
      p.message.includes("middle"),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      source: "skeleton",
      severity: "warning",
      pieceIds: ["limb"],
    });
    expect(found[0].message).toBe(
      '"limb" turns about its middle, not its joint.',
    );
  });

  it("reports a shin and a build arm the same way", () => {
    for (const role of ["leg.r1.shin", "buildarm.arm"]) {
      const found = run(legWithBlock(role)).filter((p) =>
        p.message.includes("middle"),
      );
      expect(
        found.map((p) => p.pieceIds),
        role,
      ).toEqual([["limb"]]);
    }
  });

  it("accepts a pivot on any face", () => {
    const top: [number, number, number] = [0, 0.5, 0];
    const found = run(legWithBlock("leg.l1.thigh", top)).filter((p) =>
      p.message.includes("middle"),
    );
    expect(found).toEqual([]);
  });

  it("accepts a pivot that is on no named place", () => {
    const found = run(legWithBlock("leg.l1.thigh", [0.1, 0.3, 0])).filter((p) =>
      p.message.includes("middle"),
    );
    expect(found).toEqual([]);
  });

  it("leaves a foot, a wheel and a piece with no role alone", () => {
    for (const role of ["leg.l1.foot", "wheel"]) {
      expect(
        run(legWithBlock(role)).filter((p) => p.message.includes("middle")),
        role,
      ).toEqual([]);
    }
    expect(run(add(unit(), { id: "plain" }))).toEqual([]);
  });

  it("leaves a bare piece alone, because its origin is the joint", () => {
    expect(run(unit())).toEqual([]);
    const noPart = add(unit(), {
      id: "limb",
      role: "leg.l1.thigh",
      partId: null,
    });
    expect(run(noPart).filter((p) => p.message.includes("middle"))).toEqual([]);
  });

  it("is quiet for a part the bone placer put on a bone", () => {
    const doc = unit();
    const thigh = bone(doc, "thigh.l1");
    const placed = attachToBone(doc, BLOCK, thigh.id, "part");
    expect(placed).not.toBeNull();
    expect(
      run(placed as LegoProject).filter((p) => p.message.includes("middle")),
    ).toEqual([]);
  });
});

describe("a side that does not match", () => {
  /** Both thighs and shins carry a block, put on by the bone placer. */
  function dressed(): LegoProject {
    let doc = unit();
    for (const id of ["thigh.l1", "thigh.r1"]) {
      doc = attachToBone(doc, BLOCK, bone(doc, id).id, `part-${id}`) ?? doc;
    }
    return doc;
  }

  it("finds nothing on a bare plan, a quadruped, or a dressed pair", () => {
    expect(run(unit())).toEqual([]);
    expect(run(unit(QUADRUPED))).toEqual([]);
    expect(run(dressed())).toEqual([]);
  });

  it("reports a left piece with no right one", () => {
    const doc = unit();
    const right = bone(doc, "shin.r1");
    const lonely: LegoProject = {
      ...doc,
      pieces: doc.pieces.filter(
        (p) => p.id !== right.id && p.parentId !== right.id,
      ),
    };
    const found = run(lonely);
    expect(found.map((p) => p.message)).toEqual([
      '"lshin" has no right side piece.',
    ]);
    expect(found[0].pieceIds).toEqual([bone(doc, "shin.l1").id]);
  });

  it("reports a right piece with no left one", () => {
    const doc = unit();
    const left = bone(doc, "thigh.l1");
    const lonely: LegoProject = {
      ...doc,
      pieces: doc.pieces.filter(
        (p) => !["thigh.l1", "shin.l1", "foot.l1"].includes(p.bone ?? ""),
      ),
    };
    const found = run(lonely).filter((p) => p.message.includes("left side"));
    expect(found.map((p) => p.message)).toEqual([
      '"rthigh" has no left side piece.',
    ]);
    expect(found[0].pieceIds).toEqual([bone(doc, "thigh.r1").id]);
    expect(left.id).toBeTruthy();
  });

  it("reports a pair whose joints are not opposite and selects both", () => {
    const doc = unit();
    const right = bone(doc, "thigh.r1");
    const moved = change(doc, right.id, {
      position: [right.position[0] + 1, 0, 0],
    });
    const found = run(moved).filter((p) => p.message.includes("mirror"));
    expect(found.map((p) => p.message)).toEqual([
      '"rthigh" does not mirror "lthigh".',
    ]);
    expect(found[0].pieceIds).toEqual([right.id, bone(doc, "thigh.l1").id]);
  });

  it("allows an offset up to the tolerance and no more", () => {
    const doc = unit();
    const right = bone(doc, "thigh.r1");
    const within = change(doc, right.id, {
      position: [right.position[0] + SAME_PLACE / 2, 0, 0],
    });
    expect(run(within)).toEqual([]);
    const beyond = change(doc, right.id, {
      position: [right.position[0] + SAME_PLACE * 2, 0, 0],
    });
    expect(
      run(beyond).filter((p) => p.message.includes("mirror")),
    ).toHaveLength(1);
  });

  it("reports a pair whose parts differ in size", () => {
    const doc = dressed();
    const right = doc.pieces.find((p) => p.id === "part-thigh.r1") as LegoPiece;
    const found = run(change(doc, right.id, { scale: [2, 2, 2] })).filter((p) =>
      p.message.includes("mirror"),
    );
    expect(found).toHaveLength(1);
    expect(found[0].pieceIds).toEqual([
      bone(doc, "thigh.r1").id,
      bone(doc, "thigh.l1").id,
    ]);
  });

  it("pairs a hand built walker that has no saved twin", () => {
    const hand = add(
      add(unit(), {
        id: "L",
        role: "leg.l1.shin",
        partId: "block",
        position: [5, 10, 2],
        rotation: [0.3, 0, 0],
      }),
      {
        id: "R",
        role: "leg.r1.shin",
        partId: "block",
        position: [-5, 10, 2],
        rotation: [0.3, 0, 0],
        scale: [-1, 1, 1],
      },
    );
    expect(run(hand).filter((p) => p.message.includes("mirror"))).toEqual([]);
    const off = change(hand, "R", { position: [-5, 10, 3] });
    expect(run(off).filter((p) => p.message.includes("mirror"))).toHaveLength(
      1,
    );
  });

  it("measures about the unit's centre line when the root is moved", () => {
    const doc = unit();
    const slid = change(doc, "root", { position: [40, 0, 0] });
    expect(run(slid)).toEqual([]);
  });
});
