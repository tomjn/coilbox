import { describe, expect, it } from "vitest";
import { type LegoProject, newProject, parseLegoProjectJson } from "./model";
import {
  clampTurn,
  deletePose,
  duplicatePose,
  emptyDraft,
  missingPieces,
  offsetsOf,
  overwritePose,
  type PoseOffsets,
  reduceDraft,
  renamePose,
  savePose,
  withPieceOffset,
} from "./pose";

function unit(): LegoProject {
  const base = newProject({
    id: "u",
    rootPieceId: "root",
    name: "Walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  const piece = (id: string, parentId: string | null) => ({
    id,
    name: id,
    parentId,
    partId: "p",
    position: [1, 2, 3] as [number, number, number],
    rotation: [0.1, 0.2, 0.3] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  });
  return {
    ...base,
    pieces: [piece("root", null), piece("arm", "root"), piece("leg", "root")],
  } as LegoProject;
}

const RAISED: PoseOffsets = {
  arm: { turn: [-1.2, 0.3, 0], move: [0, 2, 0] },
  leg: { turn: [0.4, 0, 0] },
};

describe("saving a pose", () => {
  it("stores the offsets under the name and leaves the pieces alone", () => {
    const before = unit();
    const saved = savePose(before, {
      id: "a",
      name: "Raised",
      offsets: RAISED,
    });
    expect(saved.poses).toEqual([{ id: "a", name: "Raised", pieces: RAISED }]);
    expect(saved.pieces).toBe(before.pieces);
  });

  it("applies back exactly what was saved", () => {
    const saved = savePose(unit(), {
      id: "a",
      name: "Raised",
      offsets: RAISED,
    });
    expect(offsetsOf(saved.poses?.[0] ?? never(), saved)).toEqual(RAISED);
  });

  it("is not changed by later edits to the offsets it was saved from", () => {
    const offsets: PoseOffsets = { arm: { turn: [1, 0, 0] } };
    const saved = savePose(unit(), { id: "a", name: "A", offsets });
    (offsets.arm.turn as number[])[0] = 9;
    expect(saved.poses?.[0].pieces.arm.turn).toEqual([1, 0, 0]);
  });

  it("keeps names unique and gives a blank name a default", () => {
    let project = savePose(unit(), {
      id: "a",
      name: "Raised",
      offsets: RAISED,
    });
    project = savePose(project, { id: "b", name: " Raised ", offsets: RAISED });
    project = savePose(project, { id: "c", name: "", offsets: RAISED });
    expect(project.poses?.map((pose) => pose.name)).toEqual([
      "Raised",
      "Raised 2",
      "Pose",
    ]);
  });

  it("leaves out a piece that is at rest", () => {
    const saved = savePose(unit(), {
      id: "a",
      name: "A",
      offsets: { arm: { turn: [0, 0, 0], move: [0, 0, 0] }, leg: RAISED.leg },
    });
    expect(Object.keys(saved.poses?.[0].pieces ?? {})).toEqual(["leg"]);
  });
});

describe("managing poses", () => {
  const saved = savePose(unit(), { id: "a", name: "Raised", offsets: RAISED });

  it("renames, and refuses a blank or taken name", () => {
    const two = savePose(saved, { id: "b", name: "Crouch", offsets: RAISED });
    expect(renamePose(two, "a", "Arms up").poses?.[0].name).toBe("Arms up");
    expect(renamePose(two, "a", "  ")).toBe(two);
    expect(renamePose(two, "a", "Crouch")).toBe(two);
  });

  it("duplicates next to the original under a free name", () => {
    const copied = duplicatePose(saved, "a", "b");
    expect(copied.poses?.map((pose) => pose.name)).toEqual([
      "Raised",
      "Raised copy",
    ]);
    expect(copied.poses?.[1].pieces).toEqual(RAISED);
  });

  it("overwrites the pieces and keeps the name", () => {
    const next = overwritePose(saved, "a", { leg: { move: [0, -1, 0] } });
    expect(next.poses?.[0]).toEqual({
      id: "a",
      name: "Raised",
      pieces: { leg: { move: [0, -1, 0] } },
    });
  });

  it("deletes, and drops the key with the last pose", () => {
    expect(deletePose(saved, "a").poses).toBeUndefined();
    expect("poses" in deletePose(saved, "a")).toBe(false);
  });

  it("skips and counts pieces the unit no longer has", () => {
    const project = savePose(unit(), {
      id: "a",
      name: "A",
      offsets: { ...RAISED, gone: { turn: [1, 0, 0] } },
    });
    const pose = project.poses?.[0] ?? never();
    expect(missingPieces(pose, project)).toEqual(["gone"]);
    expect(Object.keys(offsetsOf(pose, project)).sort()).toEqual([
      "arm",
      "leg",
    ]);
  });
});

describe("the pose being held", () => {
  it("drops a piece put back to rest", () => {
    const held = withPieceOffset(RAISED, "arm", { turn: [0, 0, 0] });
    expect(Object.keys(held)).toEqual(["leg"]);
  });

  it("undoes and redoes one pose edit at a time", () => {
    let draft = reduceDraft(emptyDraft, {
      type: "set",
      pieceId: "arm",
      offset: { turn: [1, 0, 0] },
    });
    draft = reduceDraft(draft, {
      type: "set",
      pieceId: "arm",
      offset: { turn: [2, 0, 0] },
    });
    expect(draft.offsets.arm.turn).toEqual([2, 0, 0]);
    draft = reduceDraft(draft, { type: "undo" });
    expect(draft.offsets.arm.turn).toEqual([1, 0, 0]);
    draft = reduceDraft(draft, { type: "undo" });
    expect(draft.offsets).toEqual({});
    draft = reduceDraft(draft, { type: "redo" });
    expect(draft.offsets.arm.turn).toEqual([1, 0, 0]);
  });

  it("makes loading a pose one step, and a repeat of the same edit none", () => {
    const loaded = reduceDraft(emptyDraft, { type: "load", offsets: RAISED });
    expect(loaded.past).toHaveLength(1);
    expect(reduceDraft(loaded, { type: "load", offsets: RAISED })).toBe(loaded);
  });

  it("forgets everything when posing is left", () => {
    const loaded = reduceDraft(emptyDraft, { type: "load", offsets: RAISED });
    expect(reduceDraft(loaded, { type: "clear" })).toEqual(emptyDraft);
  });
});

describe("poses in a saved project", () => {
  it("survive a save and a load", () => {
    const saved = savePose(unit(), {
      id: "a",
      name: "Raised",
      offsets: RAISED,
    });
    const read = parseLegoProjectJson(JSON.stringify(saved));
    expect(read?.poses).toEqual(saved.poses);
  });

  it("are absent from a project saved before they existed", () => {
    const old = JSON.stringify(unit());
    const read = parseLegoProjectJson(old);
    expect(read).not.toBeNull();
    expect(read && "poses" in read).toBe(false);
    expect(read?.pieces.map((piece) => piece.position)).toEqual(
      unit().pieces.map((piece) => piece.position),
    );
  });

  it("drop what cannot be read and keep the rest", () => {
    const json = JSON.stringify({
      ...unit(),
      poses: [
        { id: "ok", name: "Fine", pieces: { arm: { turn: [1, 2, 3] } } },
        { id: "ok", name: "Same id", pieces: {} },
        { id: "noname", name: " ", pieces: {} },
        {
          id: "bad",
          name: "Bad",
          pieces: { arm: { turn: [1, 2] }, leg: { move: [0, 1, null] } },
        },
        "nonsense",
      ],
    });
    const read = parseLegoProjectJson(json);
    expect(read?.poses).toEqual([
      { id: "ok", name: "Fine", pieces: { arm: { turn: [1, 2, 3] } } },
      { id: "bad", name: "Bad", pieces: {} },
    ]);
  });
});

describe("a turn held to a joint range", () => {
  const deg = (n: number) => (n * Math.PI) / 180;

  it("leaves a piece with no range free", () => {
    expect(clampTurn(undefined, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("holds yaw to the right of front on the y turn, which a Turn gives as minus the yaw", () => {
    const limits = { yaw: { min: -30, max: 90 } };
    // 90 degrees right is a Turn of -90 degrees about y.
    expect(clampTurn(limits, [0, deg(-90), 0])[1]).toBeCloseTo(deg(-90));
    expect(clampTurn(limits, [0, deg(-120), 0])[1]).toBeCloseTo(deg(-90));
    expect(clampTurn(limits, [0, deg(60), 0])[1]).toBeCloseTo(deg(30));
    expect(clampTurn(limits, [0, deg(10), 0])[1]).toBeCloseTo(deg(10));
  });

  it("holds pitch on the x turn, which a Turn gives as minus the pitch", () => {
    const limits = { pitch: { min: -5, max: 40 } };
    expect(clampTurn(limits, [deg(-60), 0, 0])[0]).toBeCloseTo(deg(-40));
    expect(clampTurn(limits, [deg(20), 0, 0])[0]).toBeCloseTo(deg(5));
    expect(clampTurn(limits, [deg(-10), 0, 3])).toEqual([deg(-10), 0, 3]);
  });

  it("holds a range through the back to its nearer edge", () => {
    const limits = { yaw: { min: 90, max: 270 } };
    // Turns of -90 to -270 degrees, which a group shows as the angles from 90
    // round through 180 to -90.
    expect(clampTurn(limits, [0, deg(170), 0])[1]).toBeCloseTo(deg(170));
    // 20 degrees is 70 from the edge at -270 (the same direction as 90) and
    // 110 from the one at -90, so it is held to -270.
    const held = clampTurn(limits, [0, deg(20), 0])[1];
    expect(held).toBeCloseTo(deg(-270));
  });
});

function never(): never {
  throw new Error("expected a pose");
}
