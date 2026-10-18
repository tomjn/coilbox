// @vitest-environment happy-dom

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { type BodyPlan, projectFromPlan } from "../../bodyPlans";
import type { LegoPoseOffset, LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { bakedPieces } from "../../s3oBuild";
import { skeletonJoints } from "../../skeletonJoints";
import { commitGizmo, gizmoMode } from "./gizmoCommit";
import { applyPoseOffsets } from "./poseMode";
import type { SceneState } from "./sceneState";
import { buildSkeleton } from "./skeletonLayer";

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

function scene(project: LegoProject) {
  const root = new THREE.Group();
  const groups = new Map<string, THREE.Group>();
  const rest = new Map<string, [number, number, number]>();
  const { pieces } = bakedPieces(project, pack, null);
  for (const piece of project.pieces) {
    const group = new THREE.Group();
    group.userData.pieceId = piece.id;
    groups.set(piece.id, group);
  }
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
  const onPose = vi.fn<(id: string, offset: LegoPoseOffset) => void>();
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
    posing: true,
    onPoseRef: { current: onPose },
    onSnapChange: () => {},
    projectRef: { current: project },
    gizmo: { object: null as THREE.Object3D | null },
  } as unknown as SceneState;
  return { state, onPose };
}

function idOf(project: LegoProject, name: string) {
  const piece = project.pieces.find((p) => p.name === name);
  if (!piece) throw new Error(`no piece ${name}`);
  return piece.id;
}

describe("posing the baked scene", () => {
  it("turns and moves a piece from its rest and carries its children", () => {
    const project = bareUnit();
    const { state } = scene(project);
    const thigh = idOf(project, "thigh");
    const foot = idOf(project, "foot");
    const restFoot = new THREE.Vector3();
    (state.groups.get(foot) as THREE.Group).getWorldPosition(restFoot);

    applyPoseOffsets(state, project, {
      [thigh]: { turn: [Math.PI / 2, 0, 0], move: [0, 1, 0] },
    });

    const group = state.groups.get(thigh) as THREE.Group;
    const rest = state.rest.get(thigh) as number[];
    expect(group.rotation.order).toBe("YXZ");
    expect(group.rotation.x).toBeCloseTo(Math.PI / 2);
    expect(group.position.y).toBeCloseTo(rest[1] + 1);
    const posedFoot = new THREE.Vector3();
    (state.groups.get(foot) as THREE.Group).getWorldPosition(posedFoot);
    expect(posedFoot.distanceTo(restFoot)).toBeGreaterThan(1);
  });

  it("does not touch the document or the rest transforms", () => {
    const project = bareUnit();
    const before = JSON.stringify(project);
    const { state } = scene(project);
    const rests = JSON.stringify([...state.rest]);

    applyPoseOffsets(state, project, {
      [idOf(project, "thigh")]: { turn: [1, 0.5, 0.2], move: [1, 2, 3] },
    });

    expect(JSON.stringify(project)).toBe(before);
    expect(JSON.stringify([...state.rest])).toBe(rests);
  });

  it("puts every piece back at rest when the pose is empty", () => {
    const project = bareUnit();
    const { state } = scene(project);
    const thigh = idOf(project, "thigh");
    const group = state.groups.get(thigh) as THREE.Group;
    const rest = group.position.clone();

    applyPoseOffsets(state, project, { [thigh]: { turn: [1, 0, 0] } });
    applyPoseOffsets(state, project, {});

    expect(group.position.toArray()).toEqual(rest.toArray());
    expect(group.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
  });

  it("turns a finished drag into the angles a Turn takes and re-applies it exactly", () => {
    const project = bareUnit();
    const { state, onPose } = scene(project);
    const thigh = idOf(project, "thigh");
    const group = state.groups.get(thigh) as THREE.Group;
    const rest = [...(state.rest.get(thigh) as number[])];

    group.rotation.order = "YXZ";
    group.rotation.set(0.7, -0.4, 0.25);
    group.position.set(rest[0] + 1.5, rest[1] - 2, rest[2]);
    const dragged = group.quaternion.clone();
    state.gizmo.object = group;
    commitGizmo(state);

    expect(onPose).toHaveBeenCalledTimes(1);
    const [id, offset] = onPose.mock.calls[0];
    expect(id).toBe(thigh);
    expect(offset.turn).toEqual([0.7, -0.4, 0.25]);
    expect(offset.move?.[0]).toBeCloseTo(1.5);
    expect(offset.move?.[1]).toBeCloseTo(-2);
    expect(offset.move?.[2]).toBeCloseTo(0);

    applyPoseOffsets(state, project, { [thigh]: offset });
    expect(group.quaternion.angleTo(dragged)).toBeLessThan(1e-9);
  });

  it("does not move a joined piece off its face", () => {
    const project = bareUnit();
    const thigh = idOf(project, "thigh");
    const joined = {
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === thigh
          ? {
              ...piece,
              connection: { parentConnector: "a", childConnector: "b" },
            }
          : piece,
      ),
    } as unknown as LegoProject;
    const { state, onPose } = scene(joined);
    const group = state.groups.get(thigh) as THREE.Group;
    group.rotation.order = "YXZ";
    group.rotation.set(0.5, 0, 0);
    group.position.x += 4;
    state.gizmo.object = group;
    commitGizmo(state);

    expect(onPose.mock.calls[0][1].move).toEqual([0, 0, 0]);
    expect(onPose.mock.calls[0][1].turn).toEqual([0.5, 0, 0]);
  });
});

describe("the gizmo while posing", () => {
  it("falls back from scale to move, because a pose never resizes", () => {
    expect(gizmoMode("scale", false, false, true)).toBe("translate");
    expect(gizmoMode("scale", false, false)).toBe("scale");
    expect(gizmoMode("rotate", false, false, true)).toBe("rotate");
  });
});
