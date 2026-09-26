/**
 * The pure comparison this module adds on top of the Rust packer
 * (`tweak_pack.rs`, tested there). What a pack needed against what the
 * selected game actually declares. The packing arithmetic itself is not
 * re-tested here, issue #1277's own boundary tests live in Rust. This file
 * covers only the fit check a caller uses to say so before the export.
 */
import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import { type TweakSlotPack, tweakSlotFit } from "./tweakPack";

function option(key: string): ConfigOption {
  return {
    key,
    name: key,
    type: "string",
    description: "",
    default: "",
  } as ConfigOption;
}

function pack(overrides: Partial<TweakSlotPack> = {}): TweakSlotPack {
  return {
    tweakdefs: [],
    oversized: [],
    unplaced: [],
    ...overrides,
  };
}

describe("tweakSlotFit", () => {
  it("fits when the game declares at least as many tweakdefs slots as the pack needed", () => {
    const p = pack({ tweakdefs: ["a", "b"] });
    const options = [
      option("tweakdefs"),
      option("tweakdefs1"),
      option("tweakunits"),
    ];
    const result = tweakSlotFit(p, options);
    expect(result.fits).toBe(true);
    expect(result.needed).toBe(2);
    expect(result.available).toBe(2);
  });

  it("does not fit when the pack needed more tweakdefs slots than the game declares", () => {
    const p = pack({ tweakdefs: ["a", "b", "c"] });
    const options = [option("tweakdefs")];
    const result = tweakSlotFit(p, options);
    expect(result.fits).toBe(false);
    expect(result.needed).toBe(3);
    expect(result.available).toBe(1);
  });

  it("does not count tweakunits slots, which a pack never fills", () => {
    const p = pack({ tweakdefs: ["a"] });
    const result = tweakSlotFit(p, [
      option("tweakunits"),
      option("tweakunits1"),
    ]);
    expect(result.fits).toBe(false);
    expect(result.available).toBe(0);
  });

  it("does not fit when the game declares no tweak slots at all", () => {
    const p = pack({ tweakdefs: ["a"] });
    const result = tweakSlotFit(p, []);
    expect(result.fits).toBe(false);
    expect(result.available).toBe(0);
  });
});
