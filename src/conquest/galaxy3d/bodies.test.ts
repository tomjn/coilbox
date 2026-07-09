import { describe, expect, it } from "vitest";
import { bodyLabel, voidBodyFor } from "./bodies";

describe("voidBodyFor", () => {
  it("is deterministic per node id", () => {
    expect(voidBodyFor("node-3")).toBe(voidBodyFor("node-3"));
  });

  it("yields mostly asteroids with a rare comet minority", () => {
    const kinds = Array.from({ length: 200 }, (_, i) =>
      voidBodyFor(`node-${i}`),
    );
    const comets = kinds.filter((k) => k === "comet").length;
    const asteroids = kinds.filter((k) => k === "asteroid").length;
    expect(comets).toBeGreaterThan(0);
    expect(asteroids).toBeGreaterThan(comets);
    expect(comets + asteroids).toBe(200);
  });
});

describe("bodyLabel", () => {
  it("labels void bodies", () => {
    expect(bodyLabel("comet")).toBe("comet");
    expect(bodyLabel("asteroid")).toBe("asteroid field");
  });
});
