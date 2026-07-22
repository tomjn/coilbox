import { describe, expect, it } from "vitest";
import { overlayUrlFor } from "./overlayLayer";

describe("overlayUrlFor", () => {
  it("returns nothing while the layer is off", () => {
    expect(overlayUrlFor("off", "height.png", "metal.png")).toBeUndefined();
  });

  it("returns the height render for the height layer", () => {
    expect(overlayUrlFor("height", "height.png", "metal.png")).toBe(
      "height.png",
    );
  });

  it("returns the metal render for the metal layer", () => {
    expect(overlayUrlFor("metal", "height.png", "metal.png")).toBe("metal.png");
  });

  it("stays undefined until the active layer's render resolves", () => {
    expect(overlayUrlFor("height", null, "metal.png")).toBeUndefined();
    expect(overlayUrlFor("metal", "height.png", undefined)).toBeUndefined();
  });
});
