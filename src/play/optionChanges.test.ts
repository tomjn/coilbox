import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import type { DecodedSlot } from "@/workshop/decodeTweakSet";
import {
  optionChanges,
  plainOptionValues,
  tweakSlotUnits,
  tweakSlotValues,
} from "./optionChanges";

const opt = (key: string, extra: Partial<ConfigOption> = {}): ConfigOption => ({
  key,
  name: key,
  type: "number",
  default: "1",
  ...extra,
});

const read = (result: ReturnType<typeof optionChanges>) => {
  if (result.status !== "read") throw new Error("expected a read schema");
  return result;
};

describe("optionChanges", () => {
  it("lists one row for one option off its default, however many it stores", () => {
    const schema = [opt("a"), opt("b"), opt("c"), opt("d")];
    const { changes } = read(
      optionChanges(schema, { a: "1", b: "1", c: "5", d: "1" }),
    );
    expect(changes.map((c) => c.key)).toEqual(["c"]);
    expect(changes[0]).toMatchObject({
      name: "c",
      value: "5",
      defaultValue: "1",
    });
  });

  it("says a preset equal to the defaults changes nothing", () => {
    const result = read(
      optionChanges([opt("a"), opt("b")], { a: "1", b: "1" }),
    );
    expect(result.changes).toEqual([]);
    expect(result.undeclared).toEqual([]);
  });

  it("does not count a bool written as 1 when the default is true", () => {
    const schema = [opt("flag", { type: "bool", default: "true" })];
    expect(read(optionChanges(schema, { flag: "1" })).changes).toEqual([]);
    expect(read(optionChanges(schema, { flag: "TRUE" })).changes).toEqual([]);
  });

  it("counts a bool that means the opposite, in words a reader uses", () => {
    const schema = [opt("flag", { type: "bool", default: "true" })];
    const { changes } = read(optionChanges(schema, { flag: "0" }));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ value: "Off", defaultValue: "On" });
  });

  it("does not count a number written with a decimal point", () => {
    const schema = [opt("speed", { default: "1" })];
    expect(read(optionChanges(schema, { speed: "1.0" })).changes).toEqual([]);
    expect(read(optionChanges(schema, { speed: "1.5" })).changes).toHaveLength(
      1,
    );
  });

  it("names a list item rather than its key", () => {
    const schema = [
      opt("mode", {
        type: "list",
        default: "a",
        listItems: [
          { key: "a", name: "Alpha" },
          { key: "b", name: "Beta" },
        ],
      }),
    ];
    const { changes } = read(optionChanges(schema, { mode: "b" }));
    expect(changes[0]).toMatchObject({ value: "Beta", defaultValue: "Alpha" });
  });

  it("matches keys without regard to case", () => {
    const { changes, undeclared } = read(
      optionChanges([opt("MaxUnits", { default: "100" })], { maxunits: "200" }),
    );
    expect(changes.map((c) => c.key)).toEqual(["MaxUnits"]);
    expect(undeclared).toEqual([]);
  });

  it("lists the options the game does not declare apart from the changes", () => {
    const { changes, undeclared } = read(
      optionChanges([opt("a")], { a: "2", gone: "7" }),
    );
    expect(changes.map((c) => c.key)).toEqual(["a"]);
    expect(undeclared).toEqual([{ key: "gone", value: "7" }]);
  });

  it("never treats a section as an option", () => {
    const schema: ConfigOption[] = [
      { key: "grp", name: "Group", type: "section" },
      opt("a"),
    ];
    const result = read(optionChanges(schema, { grp: "x" }));
    expect(result.changes).toEqual([]);
    expect(result.undeclared).toEqual([{ key: "grp", value: "x" }]);
  });

  it("is unavailable, not all changed, when the schema was not read", () => {
    expect(optionChanges(undefined, { a: "5" })).toEqual({
      status: "unavailable",
    });
  });

  it("calls everything undeclared for a game that declares nothing", () => {
    const result = read(optionChanges([], { a: "5" }));
    expect(result.changes).toEqual([]);
    expect(result.undeclared).toEqual([{ key: "a", value: "5" }]);
  });

  describe("against the current setup", () => {
    const schema = [
      opt("a", { default: "1" }),
      opt("flag", { type: "bool", default: "false" }),
    ];

    it("reports a value the setup already has as the same", () => {
      const { changes } = read(
        optionChanges(
          schema,
          { a: "5", flag: "true" },
          { a: "5.0", flag: "1" },
        ),
      );
      expect(changes.map((c) => c.current)).toEqual([
        { value: "5.0", same: true },
        { value: "On", same: true },
      ]);
    });

    it("reports the setup's value when it differs", () => {
      const { changes } = read(optionChanges(schema, { a: "5" }, { a: "3" }));
      expect(changes[0].current).toEqual({ value: "3", same: false });
    });

    it("takes an option the setup left unset to be at its default", () => {
      const { changes } = read(optionChanges(schema, { a: "5" }, {}));
      expect(changes[0].current).toEqual({ value: "1", same: false });
    });

    it("gives no comparison when there is no setup to compare with", () => {
      const { changes } = read(optionChanges(schema, { a: "5" }));
      expect(changes[0].current).toBeUndefined();
    });
  });
});

describe("a tweak slot in another case", () => {
  const stored = { maxunits: "100", TweakDefs: "x", TWEAKUNITS1: "" };

  it("is not listed as a plain option", () => {
    expect(plainOptionValues(stored)).toEqual({ maxunits: "100" });
  });

  it("is listed as a tweak slot", () => {
    expect(tweakSlotValues(stored)).toEqual({ TweakDefs: "x" });
  });
});

describe("splitting a preset's stored options", () => {
  const stored = {
    maxunits: "100",
    tweakdefs: "AAA",
    tweakunits2: "BBB",
    tweakunits3: "",
  };

  it("keeps tweak slots out of the plain options", () => {
    expect(plainOptionValues(stored)).toEqual({ maxunits: "100" });
  });

  it("keeps only the tweak slots that carry text", () => {
    expect(tweakSlotValues(stored)).toEqual({
      tweakdefs: "AAA",
      tweakunits2: "BBB",
    });
  });
});

describe("tweakSlotUnits", () => {
  const slot = (over: Partial<DecodedSlot>): DecodedSlot => ({
    key: "tweakunits",
    kind: "tweakunits",
    slot: 0,
    lua: "-- lua",
    manifest: null,
    form: "table",
    table: null,
    error: null,
    ...over,
  });

  it("lists each unit with the fields it sets, nested tables as paths", () => {
    const units = tweakSlotUnits(
      slot({
        table: {
          armcom: { health: 5000, weapondefs: { laser: { damage: 40 } } },
          corcom: { name: "Boss" },
        },
      }),
    );
    expect(units).toEqual([
      {
        unit: "armcom",
        fields: [
          { path: "health", value: "5000" },
          { path: "weapondefs.laser.damage", value: "40" },
        ],
      },
      { unit: "corcom", fields: [{ path: "name", value: "Boss" }] },
    ]);
  });

  it("walks a sequence too, numbering its entries from one", () => {
    const units = tweakSlotUnits(
      slot({
        table: {
          armcom: {
            weapons: [{ name: "laser", damage: 40 }, { name: "gun" }],
          },
        },
      }),
    );
    expect(units?.[0].fields).toEqual([
      { path: "weapons.1.name", value: "laser" },
      { path: "weapons.1.damage", value: "40" },
      { path: "weapons.2.name", value: "gun" },
    ]);
  });

  it("is null for a program, which is not a list of changes", () => {
    expect(tweakSlotUnits(slot({ form: "block" }))).toBeNull();
  });

  it("is null for a slot that did not decode", () => {
    expect(
      tweakSlotUnits(slot({ form: null, lua: null, error: "bad base64" })),
    ).toBeNull();
    expect(tweakSlotUnits(slot({ form: "unrecognised" }))).toBeNull();
  });
});
