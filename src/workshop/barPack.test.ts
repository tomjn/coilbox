/**
 * The pure comparison this module adds on top of the Rust packer
 * (`bar_pack.rs`, tested there). What a pack needed against what the
 * selected game actually declares. The packing arithmetic itself is not
 * re-tested here, issue #1277's own boundary tests live in Rust. This file
 * covers only the fit check a caller uses to say so before the export.
 */
import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import { type BarSlotPack, barSlotFit, barSlotsUsed } from "./barPack";

function option(key: string): ConfigOption {
  return {
    key,
    name: key,
    type: "string",
    description: "",
    default: "",
  } as ConfigOption;
}

function pack(overrides: Partial<BarSlotPack> = {}): BarSlotPack {
  return {
    tweakdefs: [],
    tweakunits: [],
    oversized: [],
    unplaced: [],
    ...overrides,
  };
}

describe("barSlotsUsed", () => {
  it("counts each kind by how many lines the pack produced", () => {
    const p = pack({
      tweakdefs: ["!bset tweakdefs x", "!bset tweakdefs1 y"],
      tweakunits: ["!bset tweakunits z"],
    });
    expect(barSlotsUsed(p)).toEqual({ defs: 2, units: 1 });
  });
});

describe("barSlotFit", () => {
  it("fits when the game declares at least as many slots as the pack needed", () => {
    const p = pack({ tweakdefs: ["a", "b"], tweakunits: ["c"] });
    const options = [
      option("tweakdefs"),
      option("tweakdefs1"),
      option("tweakunits"),
    ];
    const result = barSlotFit(p, options);
    expect(result.fits).toBe(true);
    expect(result.needed).toEqual({ defs: 2, units: 1 });
    expect(result.available).toEqual({ defs: 2, units: 1 });
  });

  it("does not fit when the pack needed more of one kind than the game declares", () => {
    const p = pack({ tweakdefs: ["a", "b", "c"], tweakunits: [] });
    const options = [option("tweakdefs")];
    const result = barSlotFit(p, options);
    expect(result.fits).toBe(false);
    expect(result.needed.defs).toBe(3);
    expect(result.available.defs).toBe(1);
  });

  it("does not fit when the game declares no tweak slots at all", () => {
    const p = pack({ tweakdefs: ["a"] });
    const result = barSlotFit(p, []);
    expect(result.fits).toBe(false);
    expect(result.available).toEqual({ defs: 0, units: 0 });
  });
});
