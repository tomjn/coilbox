import { describe, expect, it } from "vitest";
import {
  allSlots,
  type DecodedSlot,
  type DecodedTweakSet,
  multiLineEntries,
  pastedEntry,
  planProjectFromDecoded,
  slotTitle,
} from "./decodeTweakSet";

function slot(partial: Partial<DecodedSlot>): DecodedSlot {
  return {
    key: "tweakdefs",
    kind: "tweakdefs",
    slot: 0,
    lua: null,
    manifest: null,
    form: null,
    table: null,
    error: null,
    ...partial,
  };
}

function emptySet(): DecodedTweakSet {
  return { tweakdefs: [], tweakunits: [], unrecognised: [] };
}

describe("pastedEntry", () => {
  it("wraps a single paste under the sentinel key", () => {
    expect(pastedEntry("abc123")).toEqual({ pasted: "abc123" });
  });
});

describe("multiLineEntries", () => {
  it("keeps a whole !bset line under a bare key of its own", () => {
    const entries = multiLineEntries(
      "!bset tweakdefs3 abc\n!bset tweakunits xyz",
    );
    expect(Object.values(entries)).toEqual([
      "!bset tweakdefs3 abc",
      "!bset tweakunits xyz",
    ]);
  });

  it("reads a key=value pair copied out of an options list", () => {
    const entries = multiLineEntries("tweakdefs=abc\ntweakunits3=xyz");
    expect(entries).toEqual({ tweakdefs: "abc", tweakunits3: "xyz" });
  });

  it("gives two bare payloads with no key their own entries", () => {
    const entries = multiLineEntries("abc\nxyz");
    expect(Object.keys(entries)).toHaveLength(2);
    expect(Object.values(entries)).toEqual(["abc", "xyz"]);
  });

  it("skips blank lines", () => {
    expect(multiLineEntries("\n  \nabc\n")).toEqual({ "pasted-0": "abc" });
  });
});

describe("slotTitle", () => {
  it("prefers the manifest fingerprint over the raw key", () => {
    expect(slotTitle(slot({ key: "tweakdefs3", manifest: "NuttyB v5" }))).toBe(
      "NuttyB v5",
    );
    expect(slotTitle(slot({ key: "tweakdefs3", manifest: null }))).toBe(
      "tweakdefs3",
    );
  });
});

describe("allSlots", () => {
  it("concatenates all three buckets", () => {
    const set: DecodedTweakSet = {
      tweakdefs: [slot({ key: "a" })],
      tweakunits: [slot({ key: "b" })],
      unrecognised: [slot({ key: "c" })],
    };
    expect(allSlots(set).map((s) => s.key)).toEqual(["a", "b", "c"]);
  });
});

describe("planProjectFromDecoded", () => {
  it("turns a table slot's entries into new units", () => {
    const set: DecodedTweakSet = {
      ...emptySet(),
      tweakunits: [
        slot({
          key: "tweakunits",
          form: "table",
          table: { armcom: { maxDamage: 9000 } },
        }),
      ],
    };
    const plan = planProjectFromDecoded(set);
    expect(plan.clones).toEqual([
      { key: "armcom", replacesGameUnit: false, def: { maxDamage: 9000 } },
    ]);
    expect(plan.readOnlyLua).toEqual([]);
    expect(plan.skippedKeys).toEqual([]);
  });

  it("skips a table entry whose key is not a valid unit name", () => {
    const set: DecodedTweakSet = {
      ...emptySet(),
      tweakunits: [
        slot({
          key: "tweakunits",
          form: "table",
          table: { "../evil": { maxDamage: 1 } },
        }),
      ],
    };
    const plan = planProjectFromDecoded(set);
    expect(plan.clones).toEqual([]);
    expect(plan.skippedKeys).toEqual(["../evil"]);
  });

  it("does not add the same unit twice across two table slots", () => {
    const set: DecodedTweakSet = {
      ...emptySet(),
      tweakunits: [
        slot({
          key: "tweakunits",
          form: "table",
          table: { armcom: { maxDamage: 1 } },
        }),
        slot({
          key: "tweakunits1",
          slot: 1,
          form: "table",
          table: { armcom: { maxDamage: 2 } },
        }),
      ],
    };
    const plan = planProjectFromDecoded(set);
    expect(plan.clones).toHaveLength(1);
    expect(plan.clones[0].def).toEqual({ maxDamage: 1 });
  });

  it("carries a block slot as read-only Lua, never as a clone", () => {
    const set: DecodedTweakSet = {
      ...emptySet(),
      tweakdefs: [
        slot({
          key: "tweakdefs",
          form: "block",
          lua: "do while true do end end",
        }),
      ],
    };
    const plan = planProjectFromDecoded(set);
    expect(plan.clones).toEqual([]);
    expect(plan.readOnlyLua).toHaveLength(1);
    expect(plan.readOnlyLua[0].lua).toBe("do while true do end end");
    expect(plan.readOnlyLua[0].note).toContain("program");
  });

  it("carries an unrecognised slot as read-only Lua too, when it decoded", () => {
    const set: DecodedTweakSet = {
      ...emptySet(),
      unrecognised: [
        slot({
          key: "pasted",
          kind: "unknown",
          slot: null,
          form: "unrecognised",
          lua: "not lua at all {{{",
        }),
      ],
    };
    const plan = planProjectFromDecoded(set);
    expect(plan.readOnlyLua).toHaveLength(1);
    expect(plan.readOnlyLua[0].title).toBe("pasted");
  });

  it("carries nothing for a slot that never got as far as text", () => {
    const set: DecodedTweakSet = {
      ...emptySet(),
      unrecognised: [
        slot({ key: "pasted", kind: "unknown", error: "Not valid base64" }),
      ],
    };
    const plan = planProjectFromDecoded(set);
    expect(plan.clones).toEqual([]);
    expect(plan.readOnlyLua).toEqual([]);
  });
});
