import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_LIMIT,
  autosaveCheckpoint,
  checkpointsFor,
  forgetProjectCheckpoints,
  removeCheckpoint,
  renameCheckpoint,
  saveCheckpoint,
} from "./checkpoints";
import { setOverride } from "./overrides";
import { EMPTY_EDITS, editSlot, type GameEdits } from "./project";

/** A `GameEdits` that differs from `EMPTY_EDITS` by reference, standing in for
 *  a project a person has actually changed. */
function edited(): GameEdits {
  return editSlot(EMPTY_EDITS, "overrides", (o) =>
    setOverride(o, "armcom", "health", 4000, 3000),
  );
}

describe("saveCheckpoint", () => {
  it("adds a manual checkpoint to the front of the project's list", () => {
    const first = saveCheckpoint(
      {},
      "p1",
      "Before rebalance",
      undefined,
      edited(),
    );
    expect(checkpointsFor(first, "p1")).toHaveLength(1);
    expect(checkpointsFor(first, "p1")[0]).toMatchObject({
      name: "Before rebalance",
      kind: "manual",
    });

    const second = saveCheckpoint(
      first,
      "p1",
      "After rebalance",
      "notes",
      edited(),
    );
    const list = checkpointsFor(second, "p1");
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      name: "After rebalance",
      description: "notes",
    });
    expect(list[1].name).toBe("Before rebalance");
  });

  it("falls back to a name when given a blank one", () => {
    const all = saveCheckpoint({}, "p1", "   ", undefined, edited());
    expect(checkpointsFor(all, "p1")[0].name).toBe("Checkpoint");
  });

  it("never caps manual checkpoints", () => {
    let all = {};
    for (let i = 0; i < AUTOSAVE_LIMIT + 3; i++) {
      all = saveCheckpoint(all, "p1", `Save ${i}`, undefined, edited());
    }
    expect(checkpointsFor(all, "p1")).toHaveLength(AUTOSAVE_LIMIT + 3);
  });

  it("is not skipped by an unchanged edits reference, unlike autosave", () => {
    const snapshot = edited();
    const first = saveCheckpoint({}, "p1", "One", undefined, snapshot);
    const second = saveCheckpoint(first, "p1", "Two", undefined, snapshot);
    expect(checkpointsFor(second, "p1")).toHaveLength(2);
  });

  it("keeps each project's checkpoints apart", () => {
    const all = saveCheckpoint(
      saveCheckpoint({}, "p1", "P1 save", undefined, edited()),
      "p2",
      "P2 save",
      undefined,
      edited(),
    );
    expect(checkpointsFor(all, "p1")).toHaveLength(1);
    expect(checkpointsFor(all, "p2")).toHaveLength(1);
  });
});

describe("autosaveCheckpoint", () => {
  it("takes an autosave when edits differ from the last checkpoint", () => {
    const all = autosaveCheckpoint({}, "p1", edited(), false);
    expect(checkpointsFor(all, "p1")).toHaveLength(1);
    expect(checkpointsFor(all, "p1")[0].kind).toBe("autosave");
  });

  it("skips when the project has no edits yet", () => {
    const all = autosaveCheckpoint({}, "p1", EMPTY_EDITS, true);
    expect(checkpointsFor(all, "p1")).toHaveLength(0);
  });

  it("skips a tick where nothing changed since the last checkpoint, manual or automatic", () => {
    const snapshot = edited();
    const afterManual = saveCheckpoint({}, "p1", "Named", undefined, snapshot);
    const afterTick = autosaveCheckpoint(afterManual, "p1", snapshot, false);
    expect(afterTick).toBe(afterManual);
  });

  it("takes a new autosave once edits move on from the last checkpoint", () => {
    const first = autosaveCheckpoint({}, "p1", edited(), false);
    const changedAgain = editSlot(
      checkpointsFor(first, "p1")[0].edits,
      "overrides",
      (o) => setOverride(o, "armcom", "metalCost", 500, 1200),
    );
    const second = autosaveCheckpoint(first, "p1", changedAgain, false);
    expect(checkpointsFor(second, "p1")).toHaveLength(2);
  });

  it("keeps only the newest AUTOSAVE_LIMIT autosaves", () => {
    let all = {};
    let current = edited();
    for (let i = 0; i < AUTOSAVE_LIMIT + 3; i++) {
      current = editSlot(current, "overrides", (o) =>
        setOverride(o, "armcom", "health", i, -1),
      );
      all = autosaveCheckpoint(all, "p1", current, false);
    }
    const list = checkpointsFor(all, "p1");
    expect(list).toHaveLength(AUTOSAVE_LIMIT);
    expect(list.every((c) => c.kind === "autosave")).toBe(true);
  });

  it("keeps every manual checkpoint even once autosaves around it are capped", () => {
    let all = saveCheckpoint({}, "p1", "Kept forever", undefined, edited());
    let current = edited();
    for (let i = 0; i < AUTOSAVE_LIMIT + 3; i++) {
      current = editSlot(current, "overrides", (o) =>
        setOverride(o, "armcom", "health", i, -1),
      );
      all = autosaveCheckpoint(all, "p1", current, false);
    }
    const list = checkpointsFor(all, "p1");
    expect(list.filter((c) => c.kind === "autosave")).toHaveLength(
      AUTOSAVE_LIMIT,
    );
    expect(list.some((c) => c.name === "Kept forever")).toBe(true);
  });
});

describe("renameCheckpoint", () => {
  it("changes the name and description of an existing checkpoint", () => {
    const saved = saveCheckpoint({}, "p1", "Old name", undefined, edited());
    const id = checkpointsFor(saved, "p1")[0].id;
    const renamed = renameCheckpoint(saved, "p1", id, {
      name: "New name",
      description: "New description",
    });
    expect(checkpointsFor(renamed, "p1")[0]).toMatchObject({
      name: "New name",
      description: "New description",
    });
  });

  it("drops the description when given a blank one", () => {
    const saved = saveCheckpoint({}, "p1", "Name", "Has one", edited());
    const id = checkpointsFor(saved, "p1")[0].id;
    const renamed = renameCheckpoint(saved, "p1", id, {
      name: "Name",
      description: "  ",
    });
    expect(checkpointsFor(renamed, "p1")[0].description).toBeUndefined();
  });

  it("leaves the list unchanged for a blank name", () => {
    const saved = saveCheckpoint({}, "p1", "Name", undefined, edited());
    const id = checkpointsFor(saved, "p1")[0].id;
    expect(renameCheckpoint(saved, "p1", id, { name: "  " })).toBe(saved);
  });

  it("leaves the list unchanged for an id it does not hold", () => {
    const saved = saveCheckpoint({}, "p1", "Name", undefined, edited());
    expect(renameCheckpoint(saved, "p1", "missing", { name: "New" })).toBe(
      saved,
    );
  });
});

describe("removeCheckpoint", () => {
  it("removes one checkpoint, keeping the rest", () => {
    const one = saveCheckpoint({}, "p1", "One", undefined, edited());
    const two = saveCheckpoint(one, "p1", "Two", undefined, edited());
    const id = checkpointsFor(two, "p1").find((c) => c.name === "One")
      ?.id as string;
    const after = removeCheckpoint(two, "p1", id);
    expect(checkpointsFor(after, "p1").map((c) => c.name)).toEqual(["Two"]);
  });

  it("drops the project's key entirely once its last checkpoint goes", () => {
    const one = saveCheckpoint({}, "p1", "Only", undefined, edited());
    const id = checkpointsFor(one, "p1")[0].id;
    const after = removeCheckpoint(one, "p1", id);
    expect(Object.hasOwn(after, "p1")).toBe(false);
  });
});

describe("forgetProjectCheckpoints", () => {
  it("drops a project's checkpoints and leaves others alone", () => {
    const all = saveCheckpoint(
      saveCheckpoint({}, "p1", "P1", undefined, edited()),
      "p2",
      "P2",
      undefined,
      edited(),
    );
    const after = forgetProjectCheckpoints(all, "p1");
    expect(checkpointsFor(after, "p1")).toHaveLength(0);
    expect(checkpointsFor(after, "p2")).toHaveLength(1);
  });

  it("is a no-op for a project with none", () => {
    expect(forgetProjectCheckpoints({}, "p1")).toEqual({});
  });
});
