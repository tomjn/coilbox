/**
 * What the project does after an in-place write, undo or accept (issue #3023).
 *
 * Seen against a copy of SpringMCLegacy: tonnage and track width were written
 * into `units/BRV.lua` and accepted, and the project then reported the game as
 * updated and still listed both fields as its own changes.
 */
import { describe, expect, it } from "vitest";
import { compatibilityState } from "./compatibility";
import type { CarriedChange } from "./inPlace";
import { adoptChecksum, settleInPlace } from "./inPlaceProject";
import { editCounts, type ModProject } from "./project";

const BEFORE = "c0ffee00";
const WRITTEN = "c0ffee01";
const ACCEPTED = "c0ffee02";

const project: ModProject = {
  id: "p1",
  name: "BRV tweaks",
  gameName: "SpringMCLegacy dev",
  authoredChecksum: BEFORE,
  edits: {
    overrides: {
      brv: { "customparams.tonnage": 85, trackwidth: 40 },
      atlas: { metalcost: 900 },
    },
    clones: {},
    menus: {},
    text: {},
    disabled: [],
  },
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

const carried: CarriedChange[] = [
  { unit: "brv", field: "customparams.tonnage", undoable: true },
  { unit: "brv", field: "trackwidth", undoable: true },
];

function unmoved(p: ModProject, current: string) {
  return compatibilityState(
    adoptChecksum(p, current).authoredChecksum,
    current,
    {
      edits: p.edits,
      units: {},
      weaponDefs: {},
      gameName: p.gameName,
    },
  ).kind;
}

describe("after an in-place write", () => {
  const written = settleInPlace(
    project,
    { kind: "write", carried, changed: true },
    BEFORE,
  );

  it("stops counting the written fields as the project's changes", () => {
    expect(written.edits.overrides).toEqual({ atlas: { metalcost: 900 } });
    expect(editCounts(written.edits).fields).toBe(1);
  });

  it("keeps what it wrote so undo can put it back", () => {
    expect(written.writtenInPlace).toEqual({
      brv: { "customparams.tonnage": 85, trackwidth: 40 },
    });
  });

  it("does not report its own write as an update to the game", () => {
    expect(unmoved(written, WRITTEN)).toBe("unmoved");
    expect(adoptChecksum(written, WRITTEN)).toMatchObject({
      authoredChecksum: WRITTEN,
    });
    expect(adoptChecksum(written, WRITTEN).checksumBeforeInPlace).toBe(
      undefined,
    );
  });

  it("waits for a read that is not the one from before the write", () => {
    expect(adoptChecksum(written, BEFORE)).toBe(written);
  });

  it("puts the fields back on undo, keeping anything edited since", () => {
    const adopted = adoptChecksum(written, WRITTEN);
    const edited = {
      ...adopted,
      edits: {
        ...adopted.edits,
        overrides: { ...adopted.edits.overrides, brv: { trackwidth: 44 } },
      },
    };
    const undone = settleInPlace(
      edited,
      { kind: "undo", changed: true },
      WRITTEN,
    );
    expect(undone.edits.overrides).toEqual({
      atlas: { metalcost: 900 },
      brv: { "customparams.tonnage": 85, trackwidth: 44 },
    });
    expect(undone.writtenInPlace).toBeUndefined();
    // Undo put the original files back, which checksum as they did before.
    expect(adoptChecksum(undone, BEFORE).authoredChecksum).toBe(BEFORE);
    expect(unmoved(undone, BEFORE)).toBe("unmoved");
  });

  it("forgets the written fields on accept and follows the game again", () => {
    const adopted = adoptChecksum(written, WRITTEN);
    const accepted = settleInPlace(
      adopted,
      { kind: "accept", changed: true },
      WRITTEN,
    );
    expect(accepted.writtenInPlace).toBeUndefined();
    expect(accepted.edits.overrides).toEqual({ atlas: { metalcost: 900 } });
    // Deleting the backups changes what the game folder checksums to.
    expect(unmoved(accepted, ACCEPTED)).toBe("unmoved");
  });

  it("drops a field the file already held without offering to undo it", () => {
    const held = settleInPlace(
      project,
      {
        kind: "write",
        carried: [{ unit: "atlas", field: "metalcost", undoable: false }],
        changed: false,
      },
      BEFORE,
    );
    expect(held.edits.overrides.atlas).toBeUndefined();
    expect(held.writtenInPlace).toBeUndefined();
    expect(held.checksumBeforeInPlace).toBeUndefined();
  });

  it("merges a second write into what the first one kept", () => {
    const adopted = adoptChecksum(written, WRITTEN);
    const again = settleInPlace(
      {
        ...adopted,
        edits: {
          ...adopted.edits,
          overrides: { ...adopted.edits.overrides, brv: { trackwidth: 44 } },
        },
      },
      {
        kind: "write",
        carried: [{ unit: "brv", field: "trackwidth", undoable: true }],
        changed: true,
      },
      WRITTEN,
    );
    expect(again.writtenInPlace).toEqual({
      brv: { "customparams.tonnage": 85, trackwidth: 44 },
    });
  });
});

describe("a game that had already moved before the write", () => {
  it("still reports the earlier update rather than hiding it", () => {
    const stale = { ...project, authoredChecksum: "0ld" };
    const written = settleInPlace(
      stale,
      { kind: "write", carried, changed: true },
      BEFORE,
    );
    expect(written.checksumBeforeInPlace).toBeUndefined();
    expect(adoptChecksum(written, WRITTEN).authoredChecksum).toBe("0ld");
  });
});
