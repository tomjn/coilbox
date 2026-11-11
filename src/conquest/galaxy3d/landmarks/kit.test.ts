import { describe, expect, it } from "vitest";
import { at, Builder, box, seeded } from "./kit";

describe("landmark kit", () => {
  it("merges parts and keeps their colour, kind and tag", () => {
    const b = new Builder();
    b.add(box(1, 1, 1), [128, 128, 128], at(0, 0, 0), { kind: 8 }, "tower");
    b.add(box(1, 1, 1), [128, 128, 128], at(3, 0, 0), { kind: 2 }, "crag");
    const built = b.build();
    expect(built.solid.getAttribute("kind")).toBeDefined();
    expect(built.solid.getAttribute("part")).toBeDefined();
    expect(built.bounds("tower")?.max.x).toBeCloseTo(0.5);
    expect(built.bounds("crag")?.min.x).toBeCloseTo(2.5);
    expect(built.bounds("mast")).toBeNull();
    expect(built.vertices("tower").length).toBeGreaterThan(0);
    expect(built.triangles).toBeGreaterThan(0);
  });

  it("pulls a vertex to the blend colour by its weight", () => {
    const b = new Builder();
    b.add(box(1, 1, 1), [0, 0, 0], at(0, 0, 0), {
      clean: true,
      blend: () => [255, 255, 255],
      blendWeight: () => 1,
    });
    const c = b.build().solid.getAttribute("color");
    expect(c.getX(0)).toBeCloseTo(1, 2);
  });

  it("leaves the colour alone when the blend gives none", () => {
    const b = new Builder();
    b.add(box(1, 1, 1), [0, 0, 0], at(0, 0, 0), {
      clean: true,
      blend: () => undefined,
      blendWeight: () => 1,
    });
    const c = b.build().solid.getAttribute("color");
    expect(c.getX(0)).toBeCloseTo(0, 2);
  });

  it("keeps parts with a fade apart, with an alpha channel", () => {
    const b = new Builder();
    b.add(box(1, 1, 1), [90, 90, 90], at(0, 0, 0));
    b.add(box(1, 1, 1), [90, 90, 90], at(2, 0, 0), { fade: () => 0.5 });
    const built = b.build();
    expect(built.soft?.getAttribute("color").itemSize).toBe(4);
    expect(built.solid.getAttribute("color").itemSize).toBe(3);
  });

  it("draws the same parts from the same seed", () => {
    const a = seeded(7);
    const b = seeded(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
