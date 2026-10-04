import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "../handmade/png.testhelper";
import { readHandmadeMap } from "../handmade/read";
import {
  BORDER_TOLERANCE_FRACTION,
  type BorderPiece,
  createProvinceIndex,
  drapeFill,
  drapeLine,
  isProvince,
  isStrongBorder,
  type MapPoint,
  pickProvince,
  pointInRing,
  provinceBorders,
  provinceIndexFor,
  provinceStyle,
  type Ring,
  rayToMap,
  ribbonPositions,
} from "./provinces";
import { createTerrainSurface, type HeightGrid } from "./terrain";

const square = (x: number, y: number, size: number): Ring => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

/** A 5 by 5 grid with a single peak in the middle. */
const peak: HeightGrid = {
  data: new Float32Array(25).map((_, i) => (i === 12 ? 1 : 0)),
  width: 5,
  height: 5,
};

const spec = { width: 100, height: 100, heightScale: 20 };
const flat = createTerrainSurface(spec, 200);
const hilly = createTerrainSurface(spec, 200, peak);

/** Area in the ground plane of a fill's triangles, in world units. */
function fillArea(fill: Float32Array): number {
  let area = 0;
  for (let o = 0; o < fill.length; o += 9) {
    const [ax, , az, bx, , bz, cx, , cz] = fill.subarray(o, o + 9);
    area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  }
  return area;
}

const pieceLength = (p: BorderPiece): number =>
  Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);

describe("isProvince", () => {
  it("is true only for a node with a usable outline", () => {
    expect(isProvince({})).toBe(false);
    expect(isProvince({ outline: [] })).toBe(false);
    expect(
      isProvince({
        outline: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      }),
    ).toBe(false);
    expect(isProvince({ outline: [square(0, 0, 1)] })).toBe(true);
  });
});

describe("pointInRing", () => {
  it("tells inside from outside, for a concave ring too", () => {
    // An L shape: the notch at the top right is outside.
    const ell: Ring = [
      [0, 0],
      [5, 0],
      [5, 5],
      [10, 5],
      [10, 10],
      [0, 10],
    ];
    expect(pointInRing(ell, 2, 2)).toBe(true);
    expect(pointInRing(ell, 8, 8)).toBe(true);
    expect(pointInRing(ell, 8, 2)).toBe(false);
    expect(pointInRing(ell, -1, 5)).toBe(false);
  });
});

describe("createProvinceIndex", () => {
  const nodes = [
    { outline: [square(0, 0, 10)] },
    {}, // a point location
    // A mainland and an island, one province.
    { outline: [square(20, 0, 10), square(40, 0, 5)] },
  ];
  const index = createProvinceIndex(nodes);

  it("lists the nodes that are provinces", () => {
    expect(index.nodes).toEqual([0, 2]);
    expect(index.has(1)).toBe(false);
    expect(index.ringsOf(1)).toEqual([]);
  });

  it("finds the province at a point", () => {
    expect(index.at(5, 5)).toBe(0);
    expect(index.at(25, 5)).toBe(2);
  });

  it("finds a province made of two polygons through either one", () => {
    expect(index.at(42, 2)).toBe(2);
    // The gap between the mainland and the island belongs to neither.
    expect(index.at(35, 2)).toBe(-1);
  });

  it("returns -1 for land that belongs to no province", () => {
    expect(index.at(15, 5)).toBe(-1);
    expect(index.at(5, 50)).toBe(-1);
  });

  it("gives an overlap to the smaller province", () => {
    const nested = createProvinceIndex([
      { outline: [square(0, 0, 100)] },
      { outline: [square(40, 40, 10)] },
    ]);
    expect(nested.at(45, 45)).toBe(1);
    expect(nested.at(10, 10)).toBe(0);
    expect(nested.at(45, 45, 1)).toBe(0);
  });
});

describe("provinceIndexFor", () => {
  const terrain = { image: "x", width: 100, height: 100 };
  const withOutline = [{ outline: [square(0, 0, 10)] }];

  it("is undefined on a galaxy or theatre map, even with outlines", () => {
    expect(provinceIndexFor({ nodes: withOutline })).toBeUndefined();
  });

  it("is undefined on a terrain map with no outlines", () => {
    expect(provinceIndexFor({ terrain, nodes: [{}, {}] })).toBeUndefined();
  });

  it("indexes a terrain map that has outlines", () => {
    expect(provinceIndexFor({ terrain, nodes: withOutline })?.nodes).toEqual([
      0,
    ]);
  });
});

describe("rayToMap", () => {
  it("meets a flat sheet where the ray reaches ground level", () => {
    // World (0, 0) is the middle of the map.
    expect(rayToMap(flat, [0, 50, 0], [0, -1, 0])).toEqual([50, 50]);
    const hit = rayToMap(flat, [0, 50, 0], [1, -1, 0]);
    expect(hit?.[0]).toBeCloseTo(75);
    expect(hit?.[1]).toBeCloseTo(50);
  });

  it("misses when the ray points up or lands off the sheet", () => {
    expect(rayToMap(flat, [0, 50, 0], [0, 1, 0])).toBeNull();
    expect(rayToMap(flat, [0, 50, 0], [10, -1, 0])).toBeNull();
  });

  it("stops on a hillside the ray reaches before ground level", () => {
    // Aimed at the far foot of the peak from low on the near side, so the
    // peak is in the way.
    const origin: [number, number, number] = [-80, 30, 0];
    const direction: [number, number, number] = [110, -30, 0];
    const hit = rayToMap(hilly, origin, direction);
    if (!hit) throw new Error("expected a hit");
    const [worldX] = hilly.mapToWorldXZ(hit[0], hit[1]);
    // Short of where a flat sheet would have been met.
    expect(worldX).toBeLessThan(30 - 1);
    // And the ray is at ground height there.
    const t = (worldX - origin[0]) / direction[0];
    expect(origin[1] + direction[1] * t).toBeCloseTo(
      hilly.groundHeightAt(hit[0], hit[1]),
      3,
    );
  });
});

describe("pickProvince", () => {
  // A small province inside a large one, and bare land to the east.
  const index = createProvinceIndex([
    { outline: [square(0, 0, 60)] },
    { outline: [square(20, 20, 10)] },
  ]);
  /** A ray straight down onto a map point. */
  const down = (mapX: number, mapY: number, hidden?: (i: number) => boolean) =>
    pickProvince(
      index,
      flat,
      [(mapX - 50) * 2, 100, (mapY - 50) * 2],
      [0, -1, 0],
      hidden,
    );

  it("picks the province under the ray, the smaller where two overlap", () => {
    expect(down(5, 5)).toBe(0);
    expect(down(25, 25)).toBe(1);
  });

  it("picks nothing on bare land or off the sheet", () => {
    expect(down(80, 80)).toBe(-1);
    expect(down(150, 5)).toBe(-1);
  });

  it("never picks a hidden province", () => {
    expect(down(5, 5, (i) => i === 0)).toBe(-1);
    expect(down(5, 5, (i) => i === 1)).toBe(0);
  });

  it("does not fall through a hidden province to the one around it", () => {
    expect(down(25, 25, (i) => i === 1)).toBe(-1);
  });

  it("finds a province on a hillside the ray reaches first", () => {
    const whole = createProvinceIndex([{ outline: [square(0, 0, 100)] }]);
    expect(pickProvince(whole, hilly, [-80, 30, 0], [110, -30, 0])).toBe(0);
    expect(
      pickProvince(whole, hilly, [-80, 30, 0], [110, -30, 0], () => true),
    ).toBe(-1);
  });
});

describe("drapeFill", () => {
  it("covers the outline's area on a flat sheet, at the lift", () => {
    const fill = drapeFill([square(10, 10, 20)], flat, 0.05);
    expect(fillArea(fill)).toBeCloseTo(20 * 20 * flat.scale ** 2, 3);
    for (let o = 1; o < fill.length; o += 3) expect(fill[o]).toBeCloseTo(0.05);
  });

  it("covers a concave outline without filling its notch", () => {
    const ell: Ring = [
      [0, 0],
      [50, 0],
      [50, 50],
      [100, 50],
      [100, 100],
      [0, 100],
    ];
    expect(fillArea(drapeFill([ell], flat, 0))).toBeCloseTo(
      7500 * flat.scale ** 2,
      2,
    );
  });

  it("follows the relief: every piece lies on the ground", () => {
    // Crosses the peak, with corners that are on no terrain vertex.
    const ring: Ring = [
      [13, 17],
      [88, 22],
      [81, 79],
      [22, 91],
    ];
    const fill = drapeFill([ring], hilly, 0.05);
    expect(fill.length).toBeGreaterThan(9 * 8);
    let highest = 0;
    for (let o = 0; o < fill.length; o += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = fill.subarray(o, o + 9);
      // A point inside the triangle, off its corners and edges.
      const x = ax * 0.5 + bx * 0.3 + cx * 0.2;
      const y = ay * 0.5 + by * 0.3 + cy * 0.2;
      const z = az * 0.5 + bz * 0.3 + cz * 0.2;
      expect(y - hilly.groundHeightAtWorld(x, z)).toBeCloseTo(0.05, 3);
      highest = Math.max(highest, ay, by, cy);
    }
    // The fill does climb the peak. It is not a flat sheet at ground level.
    expect(highest).toBeCloseTo(hilly.maxHeight + 0.05, 3);
    // Cutting it up neither loses nor doubles any area.
    const flatFill = drapeFill([ring], flat, 0);
    expect(fillArea(fill)).toBeCloseTo(fillArea(flatFill), 2);
  });

  it("drops the part of an outline beyond the sheet", () => {
    const fill = drapeFill([square(90, 90, 20)], hilly, 0);
    expect(fillArea(fill)).toBeCloseTo(10 * 10 * hilly.scale ** 2, 3);
  });

  it("fills each polygon of a province made of two", () => {
    const fill = drapeFill([square(0, 0, 10), square(50, 50, 10)], flat, 0);
    expect(fillArea(fill)).toBeCloseTo(200 * flat.scale ** 2, 3);
  });
});

describe("drapeLine", () => {
  it("leaves a line on a flat sheet as it is", () => {
    expect(drapeLine([0, 0], [100, 100], flat)).toEqual([
      [0, 0],
      [100, 100],
    ]);
  });

  it("adds a point at every change of slope", () => {
    const a: MapPoint = [7, 31];
    const b: MapPoint = [93, 64];
    const points = drapeLine(a, b, hilly);
    expect(points[0]).toEqual(a);
    expect(points[points.length - 1]).toEqual(b);
    expect(points.length).toBeGreaterThan(4);
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      // Halfway along each stretch the straight line is on the ground.
      const between =
        (hilly.groundHeightAt(x1, y1) + hilly.groundHeightAt(x2, y2)) / 2;
      expect(between).toBeCloseTo(
        hilly.groundHeightAt((x1 + x2) / 2, (y1 + y2) / 2),
        4,
      );
    }
  });
});

describe("provinceBorders", () => {
  const sharedLength = (pieces: BorderPiece[]): number =>
    pieces
      .filter((p) => p.neighbour >= 0)
      .reduce((s, p) => s + pieceLength(p), 0);
  const totalLength = (pieces: BorderPiece[]): number =>
    pieces.reduce((s, p) => s + pieceLength(p), 0);

  it("draws a border two provinces share once, and knows both sides", () => {
    const index = createProvinceIndex([
      { outline: [square(0, 0, 10)] },
      { outline: [square(10, 0, 10)] },
    ]);
    const pieces = provinceBorders(index, 0.25);
    const shared = pieces.filter((p) => p.neighbour >= 0);
    expect(shared.length).toBeGreaterThan(0);
    for (const p of shared) {
      expect([p.province, p.neighbour]).toEqual([0, 1]);
      expect(p.a[0]).toBe(10);
      expect(p.b[0]).toBe(10);
    }
    expect(sharedLength(pieces)).toBeCloseTo(10);
    // Seven sides of 10 in all: the shared one is not drawn twice.
    expect(totalLength(pieces)).toBeCloseTo(70);
  });

  it("finds a shared border whose points do not match", () => {
    // The right hand province sits 0.1 away, and its near side is split at
    // points the left hand one does not have.
    const right: Ring = [
      [10.1, 0],
      [20, 0],
      [20, 10],
      [10.1, 10],
      [10.1, 6.3],
      [10.1, 2.9],
    ];
    const index = createProvinceIndex([
      { outline: [square(0, 0, 10)] },
      { outline: [right] },
    ]);
    const pieces = provinceBorders(index, 0.25);
    expect(sharedLength(pieces)).toBeCloseTo(10);
    expect(
      pieces.filter((p) => p.neighbour >= 0).every((p) => p.province === 0),
    ).toBe(true);
  });

  it("does not join provinces further apart than the tolerance", () => {
    const index = createProvinceIndex([
      { outline: [square(0, 0, 10)] },
      { outline: [square(11, 0, 10)] },
    ]);
    const pieces = provinceBorders(index, 0.25);
    expect(sharedLength(pieces)).toBe(0);
    expect(totalLength(pieces)).toBeCloseTo(80);
  });

  it("splits one edge between two neighbours", () => {
    const index = createProvinceIndex([
      { outline: [square(0, 0, 10)] },
      // Two provinces stacked along the first one's right hand side.
      {
        outline: [
          [
            [10, 0],
            [20, 0],
            [20, 4],
            [10, 4],
          ],
        ],
      },
      {
        outline: [
          [
            [10, 4],
            [20, 4],
            [20, 10],
            [10, 10],
          ],
        ],
      },
    ]);
    const pieces = provinceBorders(index, 0.25);
    const along = (neighbour: number) =>
      pieces
        .filter((p) => p.province === 0 && p.neighbour === neighbour)
        .reduce((s, p) => s + pieceLength(p), 0);
    // Each stretch is right to within one step of the walk.
    expect(Math.abs(along(1) - 4)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(along(2) - 6)).toBeLessThanOrEqual(0.5);
  });

  it("keeps the border of a province drawn inside another", () => {
    // The inner province has the higher index, and the outer one has no
    // edge along it, so the inner one must draw its own border.
    const index = createProvinceIndex([
      { outline: [square(0, 0, 100)] },
      { outline: [square(40, 40, 10)] },
    ]);
    const pieces = provinceBorders(index, 0.25);
    const inner = pieces.filter((p) => p.province === 1);
    expect(inner.reduce((s, p) => s + pieceLength(p), 0)).toBeCloseTo(40);
    expect(inner.every((p) => p.neighbour === 0)).toBe(true);
  });
});

describe("provinceBorders on the sample hand-made map", () => {
  const SAMPLE = fileURLToPath(
    new URL("../../../docs/examples/handmade-map/", import.meta.url),
  );
  const image = decodePng(readFileSync(`${SAMPLE}provinces.png`));
  const result = readHandmadeMap({
    manifest: readFileSync(`${SAMPLE}map.json`, "utf8"),
    provinces: image,
    picture: { width: image.width, height: image.height },
    urlFor: (name) => `asset://map/${name}`,
  });
  if (!result.ok) throw new Error("the sample map did not read");
  const doc = result.doc;
  const index = createProvinceIndex(doc.nodes);
  const longSide = Math.max(doc.terrain?.width ?? 0, doc.terrain?.height ?? 0);
  const pieces = provinceBorders(index, longSide * BORDER_TOLERANCE_FRACTION);
  const length = (list: BorderPiece[]) =>
    list.reduce((s, p) => s + pieceLength(p), 0);

  it("finds exactly the provinces the tracer says touch", () => {
    const found = new Set(
      pieces
        .filter((p) => p.neighbour >= 0)
        .map((p) =>
          [doc.nodes[p.province].id, doc.nodes[p.neighbour].id]
            .sort()
            .join(" "),
        ),
    );
    // A blocked border is still two provinces touching.
    const touching = [
      ...(doc.linkKinds ?? [])
        .filter(([, , kind]) => kind === "border")
        .map(([a, b]) => [a, b]),
      ...(doc.blockedBorders ?? []),
    ].map((pair) => [...pair].sort().join(" "));
    expect([...found].sort()).toEqual(touching.sort());
  });

  it("draws every shared border once", () => {
    let perimeter = 0;
    for (const i of index.nodes) {
      for (const ring of index.ringsOf(i)) {
        ring.forEach((p, k) => {
          const q = ring[(k + 1) % ring.length];
          perimeter += Math.hypot(q[0] - p[0], q[1] - p[1]);
        });
      }
    }
    const shared = length(pieces.filter((p) => p.neighbour >= 0));
    expect(shared).toBeGreaterThan(0);
    // Both neighbours' outlines run along a shared border, and one draws it.
    // The walk places the end of a shared stretch to within one step, at
    // each end of each of the 13 shared borders.
    const step = longSide * BORDER_TOLERANCE_FRACTION * 2;
    expect(Math.abs(perimeter - shared - length(pieces))).toBeLessThan(
      13 * 2 * step,
    );
  });
});

describe("ribbonPositions", () => {
  it("makes one quad per segment, as wide as asked", () => {
    const out = ribbonPositions(
      [
        [0, 1, 0],
        [10, 2, 0],
        [10, 3, 10],
      ],
      2,
    );
    expect(out.length).toBe(24);
    // The first segment runs along +X, so its width is along Z.
    expect(Array.from(out.subarray(0, 12))).toEqual([
      0, 1, 1, 0, 1, -1, 10, 2, 1, 10, 2, -1,
    ]);
  });
});

describe("provinceStyle", () => {
  const plain = { neutral: false, hovered: false, selected: false };

  it("tints an owned province in its owner's colour, a neutral one neutral", () => {
    expect(provinceStyle(plain).tint).toBe("owner");
    expect(provinceStyle({ ...plain, neutral: true }).tint).toBe("neutral");
  });

  it("always leaves the map picture showing through", () => {
    const loudest = provinceStyle({
      ...plain,
      hovered: true,
      selected: true,
      attackable: true,
      emphasised: true,
    });
    expect(loudest.opacity).toBeLessThan(1);
  });

  it("makes hover, selection and each outside state stand out", () => {
    const base = provinceStyle(plain).opacity;
    for (const key of [
      "hovered",
      "selected",
      "attackable",
      "emphasised",
    ] as const) {
      expect(provinceStyle({ ...plain, [key]: true }).opacity).toBeGreaterThan(
        base,
      );
    }
    expect(provinceStyle({ ...plain, selected: true }).opacity).toBeGreaterThan(
      provinceStyle({ ...plain, hovered: true }).opacity,
    );
  });

  it("gives an attackable province and one under incursion their own accent", () => {
    expect(provinceStyle(plain).accent).toBeUndefined();
    expect(provinceStyle({ ...plain, attackable: true }).accent).toBe("attack");
    const threatened = provinceStyle({ ...plain, threatened: true });
    expect(threatened.accent).toBe("threat");
    expect(threatened.opacity).toBeGreaterThan(provinceStyle(plain).opacity);
    expect(
      provinceStyle({ ...plain, attackable: true, threatened: true }).accent,
    ).toBe("threat");
    expect(
      provinceStyle({ ...plain, hidden: true, attackable: true }).accent,
    ).toBeUndefined();
  });

  it("strips a hidden province of colour, markers, hover and selection", () => {
    const hidden = provinceStyle({ ...plain, hidden: true });
    expect(hidden.tint).toBe("neutral");
    expect(hidden.showMarkers).toBe(false);
    expect(
      provinceStyle({ ...plain, hidden: true, hovered: true, selected: true }),
    ).toEqual(hidden);
  });
});

describe("isStrongBorder", () => {
  it("is strong only between two shown provinces with different owners", () => {
    expect(isStrongBorder("red", "blue", false, false)).toBe(true);
    expect(isStrongBorder("red", "neutral", false, false)).toBe(true);
    expect(isStrongBorder("red", "red", false, false)).toBe(false);
    expect(isStrongBorder("red", "blue", true, false)).toBe(false);
    expect(isStrongBorder("red", "blue", false, true)).toBe(false);
  });
});
