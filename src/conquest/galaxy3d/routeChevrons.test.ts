import { describe, expect, it } from "vitest";
import {
  CHEVRON_FRACTIONS,
  type GroundXZ,
  orientFrom,
  spotsAlong,
} from "./routeChevrons";

describe("spotsAlong", () => {
  it("places the chevrons at shares of a straight route", () => {
    const spots = spotsAlong([
      [
        [0, 0],
        [10, 0],
      ],
    ]);
    expect(spots.map((s) => s.t)).toEqual([...CHEVRON_FRACTIONS]);
    expect(spots[0].x).toBeCloseTo(2.8);
    expect(spots[1].x).toBeCloseTo(5);
    expect(spots[2].x).toBeCloseTo(7.2);
    for (const s of spots) expect(s.z).toBeCloseTo(0);
  });

  it("aims each chevron along the stretch it is on", () => {
    // Along +x for 10, then along +z for 10: the 0.28 and 0.72 shares fall on
    // either leg.
    const spots = spotsAlong([
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    ]);
    expect(spots[0].heading).toBeCloseTo(0);
    expect(spots[2].heading).toBeCloseTo(-Math.PI / 2);
    expect(spots[2].x).toBeCloseTo(10);
    expect(spots[2].z).toBeCloseTo(4.4);
  });

  it("follows the route backwards when it runs toward -x", () => {
    const [spot] = spotsAlong(
      [
        [
          [10, 0],
          [0, 0],
        ],
      ],
      [0.5],
    );
    expect(Math.abs(spot.heading)).toBeCloseTo(Math.PI);
  });

  it("skips the gap between pieces", () => {
    // Two pieces of length 4 with a gap of 92 between them.
    const spots = spotsAlong(
      [
        [
          [0, 0],
          [4, 0],
        ],
        [
          [96, 0],
          [100, 0],
        ],
      ],
      [0.5, 0.75],
    );
    expect(spots[0].x).toBeCloseTo(4);
    expect(spots[1].x).toBeCloseTo(98);
  });

  it("ignores repeated points and a route with no length", () => {
    expect(
      spotsAlong([
        [
          [1, 1],
          [1, 1],
        ],
      ]),
    ).toEqual([]);
    expect(spotsAlong([])).toEqual([]);
    const spots = spotsAlong(
      [
        [
          [0, 0],
          [0, 0],
          [8, 0],
        ],
      ],
      [0.5],
    );
    expect(spots[0].x).toBeCloseTo(4);
  });
});

describe("orientFrom", () => {
  const pieces: GroundXZ[][] = [
    [
      [0, 0],
      [1, 0],
    ],
    [
      [5, 0],
      [9, 0],
    ],
  ];

  it("keeps a route that already starts at the origin end", () => {
    expect(orientFrom(pieces, [-1, 0])).toEqual(pieces);
  });

  it("turns a route that ends at the origin round, pieces and points", () => {
    expect(orientFrom(pieces, [10, 0])).toEqual([
      [
        [9, 0],
        [5, 0],
      ],
      [
        [1, 0],
        [0, 0],
      ],
    ]);
  });

  it("returns nothing for no pieces", () => {
    expect(orientFrom([], [0, 0])).toEqual([]);
  });
});
