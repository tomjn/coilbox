import { describe, expect, it } from "vitest";
import { previewLabel } from "./GalaxyPreview2D";

describe("previewLabel", () => {
  it("names a galaxy only for the Galaxy style", () => {
    expect(previewLabel("galaxy")).toBe("Galaxy layout preview");
    expect(previewLabel(undefined)).toBe("Galaxy layout preview");
  });

  it("calls every other style a map", () => {
    for (const skin of ["theatre", "cities", "territories"] as const) {
      expect(previewLabel(skin)).toBe("Map preview");
    }
  });
});
