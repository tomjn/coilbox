import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import {
  deliveryRoutes,
  tweakSlotCounts,
  tweakSlotOptions,
} from "./deliveryRoutes";

/** A `ConfigOption` with only the fields these tests care about. */
function opt(key: string): ConfigOption {
  return { key, name: key };
}

describe("tweakSlotCounts", () => {
  it("counts nothing for a game with no mod options at all", () => {
    expect(tweakSlotCounts([])).toEqual({ defs: 0, units: 0 });
  });

  it("counts nothing for a game whose options are not tweak slots", () => {
    const options = [opt("maxunits"), opt("startmetal"), opt("fixedallies")];
    expect(tweakSlotCounts(options)).toEqual({ defs: 0, units: 0 });
  });

  it("counts the bare and numbered slots BAR's own modoptions.lua declares", () => {
    const options = [
      opt("tweakunits"),
      opt("tweakdefs"),
      opt("tweakunits1"),
      opt("tweakunits2"),
      opt("tweakdefs1"),
    ];
    expect(tweakSlotCounts(options)).toEqual({ defs: 2, units: 3 });
  });

  it("does not match a key that merely contains the word", () => {
    const options = [opt("tweakdefslink"), opt("mytweakdefs"), opt("tweak")];
    expect(tweakSlotCounts(options)).toEqual({ defs: 0, units: 0 });
  });

  it("is not fooled by an option whose name mentions tweaks but whose key does not", () => {
    const options: ConfigOption[] = [
      { key: "naval_balance_tweaks", name: "Proposed Naval Balance Tweaks" },
    ];
    expect(tweakSlotCounts(options)).toEqual({ defs: 0, units: 0 });
  });
});

describe("tweakSlotOptions", () => {
  it("keeps only the options that are tweak slots, in declared order", () => {
    const options = [
      opt("maxunits"),
      opt("tweakdefs"),
      opt("startmetal"),
      opt("tweakunits3"),
    ];
    expect(tweakSlotOptions(options).map((o) => o.key)).toEqual([
      "tweakdefs",
      "tweakunits3",
    ]);
  });

  it("is empty for a game with no tweak slots at all", () => {
    expect(tweakSlotOptions([opt("maxunits")])).toEqual([]);
  });
});

describe("deliveryRoutes", () => {
  it("always offers the mutator route", () => {
    const routes = deliveryRoutes([], "Some Game");
    const mutator = routes.find((r) => r.route === "mutator");
    expect(mutator?.available).toBe(true);
  });

  it("refuses the tweak-slot route for a game that declares no slots", () => {
    const routes = deliveryRoutes([opt("maxunits")], "Balanced Annihilation");
    const slots = routes.find((r) => r.route === "tweak-slots");
    expect(slots?.available).toBe(false);
    expect(slots?.detail).toContain("Balanced Annihilation");
    expect(slots?.detail).toContain("does not declare");
  });

  it("offers the tweak-slot route for a game that declares slots, and says how many", () => {
    const options = [
      opt("tweakunits"),
      opt("tweakdefs"),
      opt("tweakunits1"),
      opt("tweakdefs1"),
      opt("tweakdefs2"),
    ];
    const routes = deliveryRoutes(options, "Beyond All Reason");
    const slots = routes.find((r) => r.route === "tweak-slots");
    expect(slots?.available).toBe(true);
    expect(slots?.detail).toContain("3 tweakdefs slots");
    expect(slots?.detail).toContain("2 tweakunits slots");
  });

  it("offers the tweak-slot route when a game declares only one kind of slot", () => {
    const routes = deliveryRoutes([opt("tweakunits1")], "One Slot Game");
    const slots = routes.find((r) => r.route === "tweak-slots");
    expect(slots?.available).toBe(true);
  });
});
