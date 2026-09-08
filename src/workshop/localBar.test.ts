import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import type { CompiledMod } from "./compile";
import {
  barRouteAvailable,
  barTweakModOptions,
  encodeTweakSlot,
} from "./localBar";

/** A `ConfigOption` with only the fields these tests care about. */
function opt(key: string): ConfigOption {
  return { key, name: key };
}

/** A `CompiledMod` with only the field this module reads. */
function compiled(barTweakdefs: string | null): CompiledMod {
  return { chunks: [], files: [], notes: [], barTweakdefs };
}

describe("encodeTweakSlot", () => {
  it("round trips plain Lua", () => {
    const lua = 'do\n  UnitDefs["armcom"] = { maxDamage = 9000 }\nend';
    const decoded = atob(
      encodeTweakSlot(lua).replace(/-/g, "+").replace(/_/g, "/"),
    );
    expect(decoded).toBe(lua);
  });

  it("uses the URL-safe alphabet with no padding", () => {
    // Long enough, and chosen so standard base64 would need padding, to
    // exercise both differences from the ordinary alphabet.
    const encoded = encodeTweakSlot("a".repeat(50));
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("carries non-ASCII project names through as UTF-8", () => {
    const lua = "-- Проект\ndo\nend";
    const encoded = encodeTweakSlot(lua);
    const bytes = Uint8Array.from(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    expect(new TextDecoder().decode(bytes)).toBe(lua);
  });
});

describe("barRouteAvailable", () => {
  it("is available when the game declares a bare tweakdefs slot and there is something to tweak", () => {
    expect(barRouteAvailable([opt("tweakdefs")], compiled("do end"))).toBe(
      true,
    );
  });

  it("is not available when the game declares no tweakdefs slot at all", () => {
    expect(barRouteAvailable([opt("tweakunits")], compiled("do end"))).toBe(
      false,
    );
    expect(barRouteAvailable([], compiled("do end"))).toBe(false);
  });

  it("is not available when the project compiles to nothing", () => {
    expect(barRouteAvailable([opt("tweakdefs")], compiled(null))).toBe(false);
    expect(barRouteAvailable([opt("tweakdefs")], null)).toBe(false);
  });

  it("a numbered slot alone is not enough: only the bare slot is used", () => {
    expect(barRouteAvailable([opt("tweakdefs1")], compiled("do end"))).toBe(
      false,
    );
  });
});

describe("barTweakModOptions", () => {
  it("is empty when there is nothing to tweak", () => {
    expect(barTweakModOptions(compiled(null))).toEqual({});
    expect(barTweakModOptions(null)).toEqual({});
  });

  it("carries the compiled Lua as tweakdefs, encoded", () => {
    const options = barTweakModOptions(compiled("do end"));
    expect(Object.keys(options)).toEqual(["tweakdefs"]);
    expect(options.tweakdefs).toBe(encodeTweakSlot("do end"));
  });
});
