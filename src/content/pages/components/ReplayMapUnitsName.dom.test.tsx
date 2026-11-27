// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { placeName } from "./ReplayMapUnits";

/** A canvas of 800 by 800 pixels shown 400 CSS pixels across, so a canvas
 *  pixel is half a CSS pixel, and a label 100 by 20 CSS pixels. */
function setup() {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 800;
  canvas.getBoundingClientRect = () =>
    ({ width: 400, height: 400, left: 0, top: 0 }) as DOMRect;
  const label = document.createElement("p");
  Object.defineProperty(label, "offsetWidth", { value: 100 });
  Object.defineProperty(label, "offsetHeight", { value: 20 });
  return { canvas, label };
}

describe("the unit's name on the map", () => {
  it("sits centred just above the ring", () => {
    const { canvas, label } = setup();
    placeName(label, canvas, { x: 400, y: 400, radius: 20 });
    // The ring's top is at (400 - 20) / 2 = 190, less the gap and the height.
    expect(label.style.left).toBe("150px");
    expect(label.style.top).toBe("166px");
    expect(label.style.visibility).toBe("visible");
  });

  it("goes below a ring near the top, and stays inside the sides", () => {
    const { canvas, label } = setup();
    placeName(label, canvas, { x: 0, y: 20, radius: 20 });
    expect(label.style.top).toBe("24px");
    expect(label.style.left).toBe("4px");
    placeName(label, canvas, { x: 800, y: 400, radius: 20 });
    expect(label.style.left).toBe("296px");
  });

  it("hides when no unit is ringed", () => {
    const { canvas, label } = setup();
    placeName(label, canvas, { x: 400, y: 400, radius: 20 });
    placeName(label, canvas, null);
    expect(label.style.visibility).toBe("hidden");
  });
});
