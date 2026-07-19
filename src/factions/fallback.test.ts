import { describe, expect, it } from "vitest";
import { fallbackFactionLogo } from "./fallback";

describe("fallbackFactionLogo", () => {
  it("returns bundled inline SVG for arm/core, case-insensitively", () => {
    for (const name of ["arm", "ARM", "Arm", " core ", "CORE"]) {
      const logo = fallbackFactionLogo(name);
      expect(logo?.kind).toBe("inline");
      // Rendered inline so it inherits the theme colour.
      if (logo?.kind === "inline") {
        expect(logo.svg).toContain('fill="currentColor"');
      }
    }
  });

  it("returns undefined for sides with no bundled emblem", () => {
    expect(fallbackFactionLogo("armada")).toBeUndefined();
    expect(fallbackFactionLogo("cortex")).toBeUndefined();
    expect(fallbackFactionLogo("")).toBeUndefined();
  });
});
