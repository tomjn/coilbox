import { describe, expect, it } from "vitest";
import { townPalette } from "../landmarks/palettes";
import { BUILDINGS, buildModel } from "./buildings";
import { dress, LIVERIES, liveryFor } from "./liveries";

const livery = (id: string) => {
  const found = LIVERIES.find((l) => l.id === id);
  if (!found) throw new Error(`no livery ${id}`);
  return found;
};

const tower = () => {
  const model = BUILDINGS.find((m) => m.id === "tower");
  if (!model) throw new Error("no tower");
  return buildModel(model, 0.21, 0.21, townPalette());
};

/** How many vertices of each kind a geometry has. */
const kinds = (g: ReturnType<typeof tower>) => {
  const out = new Map<number, number>();
  const kind = g.getAttribute("kind");
  for (let i = 0; i < kind.count; i++)
    out.set(kind.getX(i), (out.get(kind.getX(i)) ?? 0) + 1);
  return out;
};

describe("liveries", () => {
  it("deals out every livery a tower's height allows", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(liveryFor(i / 1000, 1.2).id);
    const allowed = LIVERIES.filter(
      (l) => (l.from ?? 0) <= 1.2 && (l.to ?? 9) >= 1.2,
    );
    expect([...seen].sort()).toEqual(allowed.map((l) => l.id).sort());
  });

  it("keeps glass off low buildings and red brick off towers", () => {
    for (let i = 0; i < 1000; i++) {
      expect(liveryFor(i / 1000, 0.18).wall.kind).not.toBe(3);
      expect(liveryFor(i / 1000, 2.4).wall.kind).not.toBe(1);
      expect(liveryFor(i / 1000, 2.4).alt.kind).not.toBe(1);
    }
    expect(liveryFor(0.999999, 3.6)).toBeDefined();
  });

  it("turns a tower's walls to glass and leaves its roofs and trim", () => {
    const plain = tower();
    const glass = tower();
    dress(glass, 1, livery("blue-glass"));
    const before = kinds(plain);
    const after = kinds(glass);
    expect(after.get(3)).toBeGreaterThan(0);
    // The dark band and the darker cast of the podium and head are not glass.
    expect(after.get(13)).toBe(before.get(13));
    expect(after.get(5)).toBe(before.get(5));
    // Some of the walls' own kind is left: their upward faces.
    expect(after.get(8)).toBeGreaterThan(0);
    const kind = glass.getAttribute("kind");
    const normal = glass.getAttribute("normal");
    for (let i = 0; i < kind.count; i++)
      if (kind.getX(i) === 3) expect(normal.getY(i)).toBeLessThanOrEqual(0.7);
  });

  it("only shades a copy that has no livery", () => {
    const plain = tower();
    const shaded = tower();
    dress(shaded, 0.5);
    expect(kinds(shaded)).toEqual(kinds(plain));
    const a = plain.getAttribute("color");
    const b = shaded.getAttribute("color");
    for (let i = 0; i < a.array.length; i++)
      expect(b.array[i]).toBeCloseTo(a.array[i] * 0.5, 6);
  });

  it("gives a livery's trim its own finish", () => {
    const plain = tower();
    const dressed = tower();
    dress(dressed, 1, livery("black-and-white"));
    expect(kinds(plain).get(13)).toBeGreaterThan(0);
    expect(kinds(dressed).get(13)).toBeUndefined();
  });

  it("gives every livery a unique id", () => {
    expect(new Set(LIVERIES.map((l) => l.id)).size).toBe(LIVERIES.length);
  });
});
