// @vitest-environment happy-dom

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { type BodyPlan, projectFromPlan } from "../../bodyPlans";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { bakedPieces } from "../../s3oBuild";
import type { ScriptTimeline } from "../../scriptPlayback";
import { skeletonJoints } from "../../skeletonJoints";
import { applyTimelineFrame } from "./animationPlayback";
import type { SceneState } from "./sceneState";
import { buildSkeleton, disposeSkeleton } from "./skeletonLayer";

/** A bare plan has no parts, so the pack is never read. */
const pack = {} as LoadedPack;

const PLAN: BodyPlan = {
  id: "test.bare",
  label: "Bare",
  description: "A base, a body and one leg with no parts, for tests.",
  proportions: [],
  bones() {
    return [
      { id: "base", name: "base", parent: null, position: [0, 0, 0] },
      { id: "body", name: "body", parent: "base", position: [0, 10, 0] },
      { id: "thigh", name: "thigh", parent: "body", position: [3, -2, 1] },
      { id: "foot", name: "foot", parent: "thigh", position: [0, -5, 0] },
    ];
  },
  presets: [],
};

function bareUnit(): LegoProject {
  let n = 0;
  return projectFromPlan(PLAN, {
    id: "u",
    rootPieceId: "root",
    name: "Unit",
    packId: "p",
    packVersion: "1",
    now: "2026-01-01T00:00:00.000Z",
    newId: () => `piece-${++n}`,
  });
}

/** The scene the viewport builds for a unit of empty pieces: one group each,
 *  nested like the document, and the skeleton drawn over it. */
function scene(project: LegoProject) {
  const root = new THREE.Group();
  const groups = new Map<string, THREE.Group>();
  const rest = new Map<string, [number, number, number]>();
  const { pieces } = bakedPieces(project, pack, null);
  for (const piece of project.pieces) groups.set(piece.id, new THREE.Group());
  for (const piece of project.pieces) {
    const group = groups.get(piece.id) as THREE.Group;
    const offset = pieces.get(piece.id)?.offset ?? [0, 0, 0];
    group.position.set(...offset);
    rest.set(piece.id, [...offset]);
    (piece.parentId ? groups.get(piece.parentId) : root)?.add(group);
  }
  const skeleton = buildSkeleton(
    skeletonJoints(project, pack, null),
    new THREE.PointsMaterial(),
  ) as THREE.Group;
  const state = {
    root,
    overlay: new THREE.Group(),
    groups,
    rest,
    drive: null,
    restTilt: new THREE.Quaternion(),
    selectedGroups: [],
    selectOutlines: [],
    selectOverlays: [],
    hoveredId: null,
    hoverOutline: { visible: false },
    pieceCollisionBoxes: new Map(),
    skeleton,
  } as unknown as SceneState;
  return { state, skeleton };
}

function names(project: LegoProject, timeline: string[]) {
  return timeline.map((name) => {
    const piece = project.pieces.find((p) => p.name === name);
    if (!piece) throw new Error(`no piece ${name}`);
    return piece;
  });
}

/** One frame that turns the thigh a quarter turn about x and leaves the rest. */
function kneeBend(project: LegoProject): ScriptTimeline {
  const order = ["base", "body", "thigh", "foot"];
  names(project, order);
  return {
    fps: 30,
    pieces: order,
    frames: [
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        Math.PI / 2,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ],
    ],
    hidden: [],
  } as unknown as ScriptTimeline;
}

function positions(skeleton: THREE.Group, role: "bones" | "dots") {
  const object = skeleton.children.find((c) => c.userData.role === role) as
    | THREE.LineSegments
    | THREE.Points;
  return Array.from(object.geometry.getAttribute("position").array);
}

describe("the skeleton while a script poses a unit with no parts", () => {
  it("moves the joint below a turning bone and leaves the others", () => {
    const project = bareUnit();
    const { state, skeleton } = scene(project);
    const before = positions(skeleton, "dots");

    applyTimelineFrame(state, project, kneeBend(project), 0);
    const after = positions(skeleton, "dots");

    // base, body, thigh stay put. The foot swings from (3, 3, 1) to hang
    // forward of the thigh: y stays 8 - 5 * cos and z moves by 5 * sin.
    expect(after.slice(0, 9)).toEqual(before.slice(0, 9));
    expect(before.slice(9)).toEqual([3, 3, 1]);
    expect(after[9]).toBeCloseTo(3);
    expect(after[10]).toBeCloseTo(8);
    expect(Math.abs((after[11] as number) - 1)).toBeCloseTo(5);
    disposeSkeleton(skeleton);
  });

  it("moves the bone line that ends on the turning joint", () => {
    const project = bareUnit();
    const { state, skeleton } = scene(project);
    const before = positions(skeleton, "bones");

    applyTimelineFrame(state, project, kneeBend(project), 0);
    const after = positions(skeleton, "bones");

    // Three bones with a parent, so three segments of six numbers each. The
    // last one runs thigh to foot, and only its far end moves.
    expect(after).toHaveLength(18);
    expect(after.slice(0, 12)).toEqual(before.slice(0, 12));
    expect(after.slice(12, 15)).toEqual(before.slice(12, 15));
    expect(after.slice(15)).not.toEqual(before.slice(15));
  });

  it("moves each joint's label with its joint", () => {
    const project = bareUnit();
    const { state, skeleton } = scene(project);
    const foot = project.pieces.find((p) => p.name === "foot")?.id;
    const label = skeleton.children.find(
      (c) => c instanceof THREE.Sprite && c.userData.pieceId === foot,
    ) as THREE.Sprite;
    const before = label.position.clone();

    applyTimelineFrame(state, project, kneeBend(project), 0);

    expect(label.position.distanceTo(before)).toBeGreaterThan(1);
  });

  it("follows a script that moves the whole unit", () => {
    const project = bareUnit();
    const { state, skeleton } = scene(project);
    const timeline = {
      fps: 30,
      pieces: ["base", "body", "thigh", "foot"],
      frames: [
        [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0,
        ],
      ],
      hidden: [],
    } as unknown as ScriptTimeline;
    state.root.position.set(100, 0, 0);

    applyTimelineFrame(state, project, timeline, 0);

    // The overlay follows the root, so the drawing stays in the root's space.
    expect(positions(skeleton, "dots").slice(0, 3)).toEqual([0, 0, 0]);
  });
});
