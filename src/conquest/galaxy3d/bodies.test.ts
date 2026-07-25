import { describe, expect, it } from "vitest";
import { bodyLabel, isVoidNode, voidBodiesFor, voidBodyFor } from "./bodies";

/** All-asteroid ids under voidBodyFor, so voidBodiesFor must promote one. */
function cometFreeIds(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; ids.length < count; i++) {
    if (voidBodyFor(`dry-${i}`) === "asteroid") ids.push(`dry-${i}`);
  }
  return ids;
}

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

describe("voidBodiesFor", () => {
  it("keeps each node's own roll when a comet already occurs", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `node-${i}`);
    // Sanity: this set contains a natural comet.
    expect(ids.some((id) => voidBodyFor(id) === "comet")).toBe(true);
    const bodies = voidBodiesFor(ids);
    for (const id of ids) expect(bodies.get(id)).toBe(voidBodyFor(id));
  });

  it("promotes one node to comet when the set is comet-free", () => {
    const ids = cometFreeIds(12);
    expect(ids.some((id) => voidBodyFor(id) === "comet")).toBe(false);
    const bodies = voidBodiesFor(ids);
    const comets = ids.filter((id) => bodies.get(id) === "comet");
    expect(comets).toHaveLength(1);
  });

  it("promotes the same node regardless of input order", () => {
    const ids = cometFreeIds(12);
    const pick = (order: string[]) =>
      order.find((id) => voidBodiesFor(order).get(id) === "comet");
    expect(pick(ids)).toBe(pick([...ids].reverse()));
  });

  it("handles an empty set", () => {
    expect(voidBodiesFor([]).size).toBe(0);
  });
});

describe("bodyLabel", () => {
  it("labels void bodies", () => {
    expect(bodyLabel("comet")).toBe("comet");
    expect(bodyLabel("asteroid")).toBe("asteroid field");
  });
});

describe("isVoidNode", () => {
  const node = (mapName: string, star?: { spectral: string[] }) => ({
    battle: { mapName },
    star,
  });

  it("treats a space-map node as a void body", () => {
    expect(isVoidNode(node("Void Chasm"), new Set(["Void Chasm"]))).toBe(true);
  });

  it("leaves a real star a star whichever map it drew", () => {
    // 2MA 0415-09 is a real brown dwarf. Drawing a space map should not turn it
    // into an asteroid field.
    expect(
      isVoidNode(
        node("Void Chasm", { spectral: ["T8"] }),
        new Set(["Void Chasm"]),
      ),
    ).toBe(false);
  });

  it("is false with no space maps known", () => {
    expect(isVoidNode(node("Green Valley"), undefined)).toBe(false);
  });
});
