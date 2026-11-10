import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boneEnd, type Vec3 } from "./boneEnd";

/** The cases of `lua/skeleton-widget/tests/skeleton_test.lua`, one for one. */
const CASES: [string, Vec3, Vec3, Vec3 | null][] = [
  ["along +x", [0, -1, -1], [10, 1, 1], [10, 0, 0]],
  ["along -x", [-10, -1, -1], [0, 1, 1], [-10, 0, 0]],
  ["along +y", [-1, 0, -1], [1, 10, 1], [0, 10, 0]],
  [
    "along -y, a shin hanging from the knee",
    [-2, -20, -2],
    [2, 0, 2],
    [0, -20, 0],
  ],
  ["along +z, a barrel from its pivot", [-1, -1, 0], [1, 1, 30], [0, 0, 30]],
  ["along -z", [-1, -1, -30], [1, 1, 0], [0, 0, -30]],
  [
    "the farther face when the box straddles the origin",
    [-4, -1, -1],
    [10, 1, 1],
    [10, 0, 0],
  ],
  [
    "the farther face on the negative side",
    [-10, -1, -1],
    [4, 1, 1],
    [-10, 0, 0],
  ],
  [
    "the box's offset on the other axes is kept",
    [-1, 5, 0],
    [1, 7, 30],
    [0, 6, 30],
  ],
  [
    "a box offset on two axes points at its face",
    [4, 6, -1],
    [24, 10, 1],
    [24, 8, 0],
  ],
  [
    "equal lengths: the axis reaching farther wins",
    [0, -5, -5],
    [10, 5, 5],
    [10, 0, 0],
  ],
  [
    "equal lengths and reach: z before y before x",
    [-5, -5, -5],
    [5, 5, 5],
    [0, 0, 5],
  ],
  ["equal lengths and reach on x and y: y", [-5, -5, -1], [5, 5, 1], [0, 5, 0]],
  [
    "faces as far as each other: the positive one",
    [-1, -1, -8],
    [1, 1, 8],
    [0, 0, 8],
  ],
  [
    "a box that is a point at the origin has no end",
    [0, 0, 0],
    [0, 0, 0],
    null,
  ],
];

describe("boneEnd", () => {
  it.each(CASES)("%s", (_name, min, max, want) => {
    expect(boneEnd(min, max)).toEqual(want);
  });

  it("never returns a negative zero", () => {
    expect(boneEnd([-1, -0, -1], [1, 0, 30])).toEqual([0, 0, 30]);
  });
});

/** The Lua file is the other half of the rule. Reading its cases here means a
 *  case added or changed there fails until this list follows. */
describe("boneEnd against the widget's Lua cases", () => {
  const lua = readFileSync(
    new URL(
      "../../lua/skeleton-widget/tests/skeleton_test.lua",
      import.meta.url,
    ),
    "utf8",
  );
  const triple = (text: string) => text.split(",").map(Number) as Vec3;
  const luaCases = [
    ...lua.matchAll(
      /^ends\("([^"]*)", \{ ([^}]*) \}, \{ ([^}]*) \}, (?:nil|\{ ([^}]*) \})\)$/gm,
    ),
  ].map(([, name, min, max, end]) => [
    name,
    triple(min as string),
    triple(max as string),
    end === undefined ? null : triple(end),
  ]);

  it("finds every case in the Lua file", () => {
    expect(lua.match(/^ends\(/gm)).toHaveLength(luaCases.length);
  });

  it("has the same cases as the list above, in the same order", () => {
    expect(luaCases).toEqual(CASES);
  });

  it.each(luaCases)("gives the Lua answer for: %s", (_name, min, max, want) => {
    expect(boneEnd(min as Vec3, max as Vec3)).toEqual(want);
  });
});
