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
      armorDefs: {},
      gameName: p.gameName,
    },
  ).kind;
}

describe("after an in-place write", () => {
  const written = settleInPlace(
    project,
    { kind: "write", carried, copies: [], changed: true },
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
        copies: [],
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
        copies: [],
        changed: true,
      },
      WRITTEN,
    );
    expect(again.writtenInPlace).toEqual({
      brv: { "customparams.tonnage": 85, trackwidth: 44 },
    });
  });
});

/** Issue #2634. A copy the write added as a unit file leaves the project the
 *  way a written field does, and undo brings it back whole. */
describe("after an in-place write of a copy", () => {
  const withCopy: ModProject = {
    ...project,
    edits: {
      ...project.edits,
      clones: {
        brv2: {
          key: "brv2",
          source: "brv",
          replacesGameUnit: false,
          def: { name: "BRV Mk2" },
        },
      },
      overrides: { ...project.edits.overrides, brv2: { trackwidth: 44 } },
      menus: {
        salvageyard: [
          { op: "add", unit: "brv2" },
          { op: "remove", unit: "atlas" },
        ],
        brv2: [{ op: "add", unit: "atlas" }],
      },
      text: { brv2: { en: { description: "A heavier BRV" } } },
    },
  };
  const copies = [
    { unit: "brv2", file: "units/brv2.lua", builders: ["salvageyard"] },
  ];
  const written = settleInPlace(
    withCopy,
    { kind: "write", carried: [], copies, changed: true },
    BEFORE,
  );

  it("takes the copy, its changes and its menu additions out of the project", () => {
    expect(written.edits.clones).toEqual({});
    expect(written.edits.overrides.brv2).toBeUndefined();
    expect(written.edits.menus).toEqual({
      salvageyard: [{ op: "remove", unit: "atlas" }],
    });
    // Words are not written in place, so the project keeps them, now about
    // a unit of the game's.
    expect(written.edits.text).toEqual(withCopy.edits.text);
    expect(written.copiesWrittenInPlace?.brv2).toEqual({
      clone: withCopy.edits.clones.brv2,
      overrides: { trackwidth: 44 },
      menu: [{ op: "add", unit: "atlas" }],
      builders: ["salvageyard"],
    });
  });

  it("puts all of it back on undo", () => {
    const undone = settleInPlace(
      adoptChecksum(written, WRITTEN),
      { kind: "undo", changed: true },
      WRITTEN,
    );
    expect(undone.edits.clones).toEqual(withCopy.edits.clones);
    expect(undone.edits.overrides).toEqual(withCopy.edits.overrides);
    expect(undone.edits.menus).toEqual({
      salvageyard: [
        { op: "remove", unit: "atlas" },
        { op: "add", unit: "brv2" },
      ],
      brv2: [{ op: "add", unit: "atlas" }],
    });
    expect(undone.copiesWrittenInPlace).toBeUndefined();
  });

  it("keeps a copy made again under the same name since, over the old one", () => {
    const again = {
      ...written,
      edits: {
        ...written.edits,
        clones: {
          brv2: {
            key: "brv2",
            source: "brv",
            replacesGameUnit: true,
            def: { name: "Newer" },
          },
        },
      },
    };
    const undone = settleInPlace(
      again,
      { kind: "undo", changed: true },
      BEFORE,
    );
    expect(undone.edits.clones.brv2.def).toEqual({ name: "Newer" });
  });

  it("forgets the copy on accept", () => {
    const accepted = settleInPlace(
      written,
      { kind: "accept", changed: true },
      WRITTEN,
    );
    expect(accepted.copiesWrittenInPlace).toBeUndefined();
    expect(accepted.edits.clones).toEqual({});
  });
});

describe("a game that had already moved before the write", () => {
  it("still reports the earlier update rather than hiding it", () => {
    const stale = { ...project, authoredChecksum: "0ld" };
    const written = settleInPlace(
      stale,
      { kind: "write", carried, copies: [], changed: true },
      BEFORE,
    );
    expect(written.checksumBeforeInPlace).toBeUndefined();
    expect(adoptChecksum(written, WRITTEN).authoredChecksum).toBe("0ld");
  });
});
