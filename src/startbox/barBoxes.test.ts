import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  type Arrangement,
  type ArrangementSet,
  arrangementAreas,
  asArrangement,
  decodePayload,
  encodeArrangement,
  OVERRIDE_OPTION,
  overrideAfterEdits,
  resolveArrangement,
  SET_OPTION,
  startBoxOptions,
} from "./barBoxes";

const rect = (x1: number, y1: number, x2: number, y2: number): Arrangement => ({
  startboxes: [
    {
      poly: [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ],
    },
  ],
});

/** `n` rectangles stacked down the map, told apart by their `x1`. */
const boxes = (n: number, x1: number): Arrangement => ({
  startboxes: Array.from({ length: n }, (_, i) => ({
    poly: [
      { x: x1, y: i * 10 },
      { x: 200, y: i * 10 + 9 },
    ],
  })),
});

/**
 * Entries from BAR's `map_list.validated.json` (maps-metadata, 2 November
 * 2026), each the map's single arrangement. The list keys them by id and the
 * game option keys them by team count, so the count here is the box count.
 */
const JADE_EMPRESS: Arrangement = {
  maxPlayersPerStartbox: 8,
  startboxes: [
    {
      poly: [
        { x: 57, y: 26 },
        { x: 98, y: 32 },
        { x: 110, y: 78 },
        { strength: 0.75, x: 52, y: 142 },
        { strength: 1, x: 37, y: 149 },
        { strength: 1, x: 28, y: 123 },
        { strength: 0.475, x: 37, y: 70 },
      ],
    },
    {
      poly: [
        { x: 123, y: 90 },
        { x: 168, y: 93 },
        { strength: 0.875, x: 165, y: 134 },
        { strength: 0.65, x: 150, y: 158 },
        { strength: 0.775, x: 86, y: 175 },
        { strength: 1, x: 56, y: 165 },
        { strength: 0.775, x: 63, y: 152 },
      ],
    },
  ],
};
const KOLMOGOROV: Arrangement = {
  maxPlayersPerStartbox: 8,
  startboxes: [
    {
      poly: [
        { x: 101, y: 200 },
        { x: 101, y: 145 },
        { x: 59, y: 103 },
        { x: 0, y: 104 },
        { x: 0, y: 200 },
      ],
    },
    {
      poly: [
        { x: 99, y: 0 },
        { x: 99, y: 55 },
        { x: 141, y: 97 },
        { x: 200, y: 96 },
        { x: 200, y: 0 },
      ],
    },
  ],
};
const SAIL_AWAY: Arrangement = {
  maxPlayersPerStartbox: 8,
  startboxes: [
    {
      poly: [
        { x: 0, y: 0 },
        { x: 200, y: 48 },
      ],
    },
    {
      poly: [
        { x: 0, y: 152 },
        { x: 200, y: 200 },
      ],
    },
  ],
};

const asBase64Url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64url");

describe("decodePayload", () => {
  it("reads what encodeArrangement writes", () => {
    expect(decodePayload(encodeArrangement(JADE_EMPRESS))).toEqual(
      JADE_EMPRESS,
    );
  });

  it("reads zlib made by another implementation, with and without padding", () => {
    const zlib = deflateSync(Buffer.from(JSON.stringify(KOLMOGOROV)));
    expect(decodePayload(asBase64Url(zlib))).toEqual(KOLMOGOROV);
    expect(decodePayload(zlib.toString("base64"))).toEqual(KOLMOGOROV);
  });

  it("reads base64url JSON that was never compressed, as BAR does", () => {
    const plain = Buffer.from(JSON.stringify(SAIL_AWAY)).toString("base64url");
    expect(decodePayload(plain)).toEqual(SAIL_AWAY);
  });

  it("throws on text that is not base64", () => {
    expect(() => decodePayload("not base64 !!")).toThrow();
  });

  it("throws on base64 that is not JSON", () => {
    expect(() => decodePayload(asBase64Url(Buffer.from("hello")))).toThrow();
  });

  it("throws on a zlib stream cut short", () => {
    const zlib = deflateSync(Buffer.from(JSON.stringify(JADE_EMPRESS)));
    expect(() => decodePayload(asBase64Url(zlib.subarray(0, 12)))).toThrow();
  });

  it("does not inflate a value past the ceiling", () => {
    const huge = deflateSync(
      Buffer.from(JSON.stringify({ pad: "a".repeat(9e6) })),
    );
    expect(huge.length).toBeLessThan(100_000);
    expect(() => decodePayload(asBase64Url(huge))).toThrow();
  });
});

describe("asArrangement", () => {
  it("accepts the shapes BAR sends", () => {
    expect(asArrangement(JADE_EMPRESS)).toEqual(JADE_EMPRESS);
  });

  it.each([
    ["null", null],
    ["a list", []],
    ["no boxes", { maxPlayersPerStartbox: 2 }],
    ["a box with no poly", { startboxes: [{}] }],
    ["a poly of one point", { startboxes: [{ poly: [{ x: 1, y: 1 }] }] }],
    [
      "a point with text for a coordinate",
      {
        startboxes: [
          {
            poly: [
              { x: "1", y: 1 },
              { x: 2, y: 2 },
            ],
          },
        ],
      },
    ],
    [
      "a strength that is not a number",
      {
        startboxes: [
          {
            poly: [
              { x: 1, y: 1 },
              { x: 2, y: 2, strength: "high" },
            ],
          },
        ],
      },
    ],
  ])("refuses %s", (_name, value) => {
    expect(asArrangement(value)).toBeNull();
  });
});

describe("startBoxOptions", () => {
  const tag = (name: string, value: string) => ({
    [`game/modoptions/${name}`]: value,
  });

  it("reads both options", () => {
    const read = startBoxOptions({
      ...tag(SET_OPTION, encodeArrangementSet({ "2": KOLMOGOROV })),
      ...tag(OVERRIDE_OPTION, encodeArrangement(SAIL_AWAY)),
    });
    expect(read.override).toEqual(SAIL_AWAY);
    expect(read.set).toEqual({ "2": KOLMOGOROV });
    expect(read.problems).toEqual([]);
  });

  it("finds the options whatever the case of the tag", () => {
    const read = startBoxOptions({
      "GAME/MODOPTIONS/MAPMETADATA_STARTBOX_OVERRIDE":
        encodeArrangement(SAIL_AWAY),
    });
    expect(read.override).toEqual(SAIL_AWAY);
  });

  it("says nothing about an option that is absent or empty", () => {
    expect(startBoxOptions({})).toEqual({
      override: null,
      set: null,
      problems: [],
    });
    expect(startBoxOptions(tag(SET_OPTION, "")).problems).toEqual([]);
    expect(startBoxOptions(tag(OVERRIDE_OPTION, "  ")).problems).toEqual([]);
  });

  it("names a value that does not decode and keeps the other option", () => {
    const read = startBoxOptions({
      ...tag(SET_OPTION, "!!!"),
      ...tag(OVERRIDE_OPTION, encodeArrangement(SAIL_AWAY)),
    });
    expect(read.set).toBeNull();
    expect(read.override).toEqual(SAIL_AWAY);
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]).toContain(SET_OPTION);
  });

  it("names a value that decodes to something else", () => {
    const read = startBoxOptions(
      tag(OVERRIDE_OPTION, Buffer.from('{"a":1}').toString("base64url")),
    );
    expect(read.override).toBeNull();
    expect(read.problems[0]).toContain(OVERRIDE_OPTION);
  });

  it("refuses a set with one entry that is not an arrangement", () => {
    const bad = Buffer.from(
      JSON.stringify({ "2": KOLMOGOROV, "3": { startboxes: "no" } }),
    ).toString("base64url");
    const read = startBoxOptions(tag(SET_OPTION, bad));
    expect(read.set).toBeNull();
    expect(read.problems).toHaveLength(1);
  });
});

function encodeArrangementSet(set: ArrangementSet): string {
  return Buffer.from(deflateSync(Buffer.from(JSON.stringify(set)))).toString(
    "base64url",
  );
}

describe("resolveArrangement", () => {
  const set: ArrangementSet = {
    "2": boxes(2, 0),
    "4": boxes(4, 40),
    "6": boxes(6, 60),
  };

  it("1: takes the override when it has a box for every team", () => {
    const override = boxes(3, 10);
    expect(resolveArrangement(override, set, 3)).toEqual({
      arrangement: override,
      source: "override",
    });
  });

  it("1: takes an override with spare boxes", () => {
    const override = boxes(5, 10);
    expect(resolveArrangement(override, set, 2)?.source).toBe("override");
  });

  it("1: skips an override with fewer boxes than teams", () => {
    expect(resolveArrangement(boxes(1, 10), set, 2)).toEqual({
      arrangement: set["2"],
      source: "set",
    });
  });

  it("2: takes the set's entry for exactly that team count", () => {
    expect(resolveArrangement(null, set, 4)).toEqual({
      arrangement: set["4"],
      source: "set",
    });
  });

  it("3: takes the next larger entry when there is no exact one", () => {
    expect(resolveArrangement(null, set, 3)?.arrangement).toBe(set["4"]);
    expect(resolveArrangement(null, set, 5)?.arrangement).toBe(set["6"]);
    expect(resolveArrangement(null, set, 1)?.arrangement).toBe(set["2"]);
  });

  it("3: takes the nearest larger one, not the first in the list", () => {
    const shuffled: ArrangementSet = {
      "8": boxes(8, 80),
      "3": boxes(3, 30),
      "5": boxes(5, 50),
    };
    expect(resolveArrangement(null, shuffled, 4)?.arrangement).toBe(
      shuffled["5"],
    );
  });

  it("4: takes the next smaller entry when none is as large", () => {
    expect(resolveArrangement(null, set, 7)?.arrangement).toBe(set["6"]);
    const small: ArrangementSet = { "2": boxes(2, 20), "3": boxes(3, 30) };
    expect(resolveArrangement(null, small, 8)?.arrangement).toBe(small["3"]);
  });

  it("5: gives nothing when there is no override and no set", () => {
    expect(resolveArrangement(null, null, 2)).toBeNull();
    expect(resolveArrangement(null, {}, 2)).toBeNull();
  });

  it("5: gives nothing for an override that is too small and no set", () => {
    expect(resolveArrangement(boxes(1, 0), null, 2)).toBeNull();
  });

  it("ignores set keys that are not team counts", () => {
    const odd: ArrangementSet = { all: boxes(9, 0), "": boxes(9, 0) };
    expect(resolveArrangement(null, odd, 2)).toBeNull();
  });

  it("prefers a larger entry to a smaller one", () => {
    const both: ArrangementSet = { "2": boxes(2, 20), "4": boxes(4, 40) };
    expect(resolveArrangement(null, both, 3)?.arrangement).toBe(both["4"]);
  });
});

describe("arrangementAreas", () => {
  const map = { x: 8192, z: 4096 };

  it("draws a rectangle from its two corners in world units", () => {
    const [north, south] = arrangementAreas(SAIL_AWAY, map);
    expect(north.polygons).toEqual([
      [
        [0, 0],
        [8192, 0],
        [8192, 983.04],
        [0, 983.04],
      ],
    ]);
    // 200 on the grid is the map's far edge, which the game keeps one unit in.
    expect(south.polygons[0][2]).toEqual([8192, 4095]);
  });

  it("draws a curve as many points, every anchor among them", () => {
    const [first] = arrangementAreas(JADE_EMPRESS, map);
    const ring = first.polygons[0];
    expect(ring).toHaveLength(62);
    const has = (gx: number, gy: number) =>
      ring.some(
        ([x, z]) =>
          Math.abs(x - (gx * 8192) / 200) < 1e-6 &&
          Math.abs(z - (gy * 4096) / 200) < 1e-6,
      );
    expect(has(57, 26)).toBe(true);
    expect(has(37, 149)).toBe(true);
  });

  it("draws a polygon with no strengths on its anchors alone", () => {
    const [first] = arrangementAreas(KOLMOGOROV, map);
    expect(first.polygons[0]).toHaveLength(5);
  });

  it("gives each team its own letter and colour", () => {
    const [a, b] = arrangementAreas(JADE_EMPRESS, map);
    expect(a.label).toBe("A");
    expect(b.label).toBe("B");
    expect(a.color).not.toBe(b.color);
  });

  it("scales each axis by its own side of the map", () => {
    const [wide] = arrangementAreas(rect(0, 0, 100, 100), { x: 2000, z: 400 });
    expect(wide.polygons[0][2]).toEqual([1000, 200]);
  });
});

describe("overrideAfterEdits", () => {
  const edited = { left: 10, top: 20, right: 110, bottom: 120 };

  it("replaces one team's box and keeps the others, curves included", () => {
    const next = overrideAfterEdits(
      JADE_EMPRESS,
      [{ ally: 1, rect: edited }],
      2,
      8,
    );
    expect(next.startboxes[0]).toEqual(JADE_EMPRESS.startboxes[0]);
    expect(next.startboxes[1].poly).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 120 },
    ]);
  });

  it("gives a team with no box the whole map", () => {
    const next = overrideAfterEdits(
      rect(0, 0, 50, 50),
      [{ ally: 2, rect: edited }],
      3,
      4,
    );
    expect(next.startboxes).toHaveLength(3);
    expect(next.startboxes[1].poly).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 200 },
    ]);
  });

  it("has a box for every team so the game does not ignore it", () => {
    const next = overrideAfterEdits(
      rect(0, 0, 50, 50),
      [{ ally: 0, rect: edited }],
      4,
      4,
    );
    expect(next.startboxes).toHaveLength(4);
    expect(resolveArrangement(next, null, 4)?.source).toBe("override");
  });

  it("turns a cleared box into the whole map", () => {
    const next = overrideAfterEdits(
      JADE_EMPRESS,
      [{ ally: 0, rect: null }],
      2,
      8,
    );
    expect(next.startboxes[0].poly).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 200 },
    ]);
  });

  it("applies several edits in the order they were made", () => {
    const next = overrideAfterEdits(
      JADE_EMPRESS,
      [
        { ally: 0, rect: null },
        { ally: 0, rect: edited },
      ],
      2,
      8,
    );
    expect(next.startboxes[0].poly[0]).toEqual({ x: 10, y: 20 });
  });

  it("keeps the arrangement's player limit, else uses the room's", () => {
    expect(
      overrideAfterEdits(JADE_EMPRESS, [{ ally: 0, rect: edited }], 2, 3)
        .maxPlayersPerStartbox,
    ).toBe(8);
    expect(
      overrideAfterEdits(
        { startboxes: JADE_EMPRESS.startboxes },
        [{ ally: 0, rect: edited }],
        2,
        3,
      ).maxPlayersPerStartbox,
    ).toBe(3);
  });

  it("round trips through the option value", () => {
    const next = overrideAfterEdits(
      KOLMOGOROV,
      [{ ally: 0, rect: edited }],
      2,
      8,
    );
    expect(asArrangement(decodePayload(encodeArrangement(next)))).toEqual(next);
  });
});
