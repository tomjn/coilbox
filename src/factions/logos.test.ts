import { describe, expect, it } from "vitest";
import { selectFactionLogo } from "./select";

const ARCH_TINY = { src: "data:tiny", maxDim: 16 };
const ARCH_BIG = { src: "data:big", maxDim: 64 };
const FB = { kind: "inline" as const, svg: "<svg/>" };

describe("selectFactionLogo (size-aware precedence)", () => {
  it("profile overrides everything", () => {
    const r = selectFactionLogo(
      {
        profile: "data:profile",
        archive: ARCH_BIG,
        catalog: "data:catalog",
        fallback: FB,
      },
      16,
    );
    expect(r).toEqual({ kind: "img", src: "data:profile" });
  });

  it("uses a 16px sidepic at a 16px display (pixel-perfect)", () => {
    const r = selectFactionLogo({ archive: ARCH_TINY, fallback: FB }, 16);
    expect(r).toEqual({ kind: "img", src: "data:tiny", maxDim: 16 });
  });

  it("yields a 16px sidepic to the vector emblem at a 32px display", () => {
    const r = selectFactionLogo({ archive: ARCH_TINY, fallback: FB }, 32);
    expect(r).toBe(FB);
  });

  it("keeps a large sidepic that still fits the display", () => {
    const r = selectFactionLogo(
      { archive: ARCH_BIG, catalog: "data:catalog" },
      32,
    );
    expect(r).toEqual({ kind: "img", src: "data:big", maxDim: 64 });
  });

  it("prefers the catalog over an upscaled sidepic", () => {
    const r = selectFactionLogo(
      { archive: ARCH_TINY, catalog: "data:catalog" },
      32,
    );
    expect(r).toEqual({ kind: "img", src: "data:catalog" });
  });

  it("uses an upscaled sidepic only as a last resort (no vector/catalog)", () => {
    const r = selectFactionLogo({ archive: ARCH_TINY }, 32);
    expect(r).toEqual({ kind: "img", src: "data:tiny", maxDim: 16 });
  });

  it("returns undefined when no layer resolved", () => {
    expect(selectFactionLogo({}, 32)).toBeUndefined();
  });
});
