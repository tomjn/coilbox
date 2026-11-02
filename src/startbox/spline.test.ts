import { describe, expect, it } from "vitest";
import { tessellateRing } from "./spline";

/**
 * Reference points: BAR's own `lib_spline.lua` (Beyond-All-Reason, 2 November
 * 2026) run under luajit on the rings below, printed to six decimals. The test
 * only compares numbers, so none of that Lua is in this repo.
 */

/** Jade Empress 1.41, first box, on a 8192 by 4096 map. */
const JADE_GRID = [
  [57, 26],
  [98, 32],
  [110, 78],
  [52, 142, 0.75],
  [37, 149, 1],
  [28, 123, 1],
  [37, 70, 0.475],
] as const;
const JADE = [
  [2334.72, 532.48],
  [4014.08, 655.36],
  [4505.6, 1597.44],
  [4356.908257, 1711.443069],
  [4187.59168, 1827.025542],
  [4001.149631, 1943.453066],
  [3801.081476, 2059.99129],
  [3590.886577, 2175.905861],
  [3374.064297, 2290.462427],
  [3154.114001, 2402.926636],
  [2934.535053, 2512.564136],
  [2718.826815, 2618.640575],
  [2510.488651, 2720.4216],
  [2313.019925, 2817.172859],
  [2129.92, 2908.16],
  [2067.438835, 2931.698343],
  [2007.49845, 2954.884042],
  [1949.951949, 2977.190618],
  [1894.652434, 2998.091589],
  [1841.453005, 3017.060476],
  [1790.206765, 3033.570798],
  [1740.766816, 3047.096076],
  [1692.98626, 3057.10983],
  [1646.718198, 3063.08558],
  [1601.815733, 3064.496844],
  [1558.131966, 3060.817144],
  [1515.52, 3051.52],
  [1474.090194, 3031.804341],
  [1432.879299, 3005.065177],
  [1392.405813, 2972.064594],
  [1353.188233, 2933.564682],
  [1315.745058, 2890.327526],
  [1280.594785, 2843.115216],
  [1248.255913, 2792.689838],
  [1219.246941, 2739.81348],
  [1194.086365, 2685.24823],
  [1173.292684, 2629.756174],
  [1157.384397, 2574.099402],
  [1146.88, 2519.04],
  [1151.287074, 2439.213693],
  [1162.873446, 2354.730334],
  [1180.920578, 2266.407383],
  [1204.70993, 2175.0623],
  [1233.522963, 2081.512543],
  [1266.641139, 1986.575573],
  [1303.345918, 1891.068849],
  [1342.918761, 1795.80983],
  [1384.64113, 1701.615976],
  [1427.794486, 1609.304747],
  [1471.660289, 1519.693602],
  [1515.52, 1433.6],
  [1579.655911, 1355.970677],
  [1644.386344, 1277.835688],
  [1709.758256, 1199.485059],
  [1775.818605, 1121.208817],
  [1842.614348, 1043.296988],
  [1910.192442, 966.0396],
  [1978.599845, 889.726678],
  [2047.883514, 814.648249],
  [2118.090407, 741.09434],
  [2189.267481, 669.354978],
  [2261.461693, 599.720189],
] as const;

/** Trefoil Remake 2.20, first box, on an 8192 by 8192 map. */
const TREFOIL_GRID = [
  [55, 35],
  [76, 65],
  [62, 89],
  [24, 89],
  [27, 75, 0.45],
  [44, 43, 0.45],
] as const;
const TREFOIL = [
  [2252.8, 1433.6],
  [3112.96, 2662.4],
  [2539.52, 3645.44],
  [983.04, 3645.44],
  [986.644215, 3601.228186],
  [992.20655, 3556.050164],
  [999.501519, 3510.000804],
  [1008.30364, 3463.174978],
  [1018.387429, 3415.667555],
  [1029.527402, 3367.573405],
  [1041.498074, 3318.9874],
  [1054.073963, 3270.00441],
  [1067.029583, 3220.719304],
  [1080.139452, 3171.226953],
  [1093.178086, 3121.622229],
  [1105.92, 3072.0],
  [1154.186948, 2969.10474],
  [1205.703865, 2861.278189],
  [1260.02811, 2749.654387],
  [1316.717038, 2635.36737],
  [1375.328009, 2519.551175],
  [1435.418378, 2403.339841],
  [1496.545505, 2287.867404],
  [1558.266746, 2174.267903],
  [1620.139458, 2063.675374],
  [1681.721, 1957.223856],
  [1742.568728, 1856.047385],
  [1802.24, 1761.28],
  [1839.603388, 1730.544148],
  [1876.951151, 1699.84046],
  [1914.297973, 1669.346333],
  [1951.658539, 1639.239165],
  [1989.047534, 1609.696352],
  [2026.479642, 1580.895293],
  [2063.969548, 1553.013384],
  [2101.531936, 1526.228023],
  [2139.18149, 1500.716606],
  [2176.932896, 1476.656532],
  [2214.800838, 1454.225198],
] as const;

const toAnchors = (
  grid: readonly (readonly number[])[],
  sizeX: number,
  sizeZ: number,
) =>
  grid.map(([x, y, strength]) => ({
    x: (x * sizeX) / 200,
    z: (y * sizeZ) / 200,
    ...(strength === undefined ? {} : { strength }),
  }));

function expectRing(
  actual: readonly (readonly number[])[],
  expected: readonly (readonly number[])[],
) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach(([x, z], i) => {
    expect(x).toBeCloseTo(expected[i][0], 3);
    expect(z).toBeCloseTo(expected[i][1], 3);
  });
}

describe("tessellateRing", () => {
  it("cuts a ring with mixed strengths into the points BAR cuts it into", () => {
    expectRing(tessellateRing(toAnchors(JADE_GRID, 8192, 4096)), JADE);
  });

  it("does the same on a square map where only some anchors curve", () => {
    expectRing(tessellateRing(toAnchors(TREFOIL_GRID, 8192, 8192)), TREFOIL);
  });

  it("returns a ring with no strengths as it came", () => {
    const ring = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 100 },
    ];
    expect(tessellateRing(ring)).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
  });

  it("keeps every anchor on the curve", () => {
    const anchors = toAnchors(JADE_GRID, 8192, 4096);
    const ring = tessellateRing(anchors);
    for (const a of anchors) {
      expect(ring.some(([x, z]) => x === a.x && z === a.z)).toBe(true);
    }
  });

  it("clamps a strength above 1 and below 0", () => {
    const base = toAnchors(TREFOIL_GRID, 8192, 8192);
    const loud = base.map((a) =>
      a.strength === undefined ? a : { ...a, strength: 9 },
    );
    const full = base.map((a) =>
      a.strength === undefined ? a : { ...a, strength: 1 },
    );
    expect(tessellateRing(loud)).toEqual(tessellateRing(full));
    const negative = base.map((a) => ({ ...a, strength: -3 }));
    expect(tessellateRing(negative)).toHaveLength(base.length);
  });

  it("does not curve a ring of two", () => {
    expect(
      tessellateRing([
        { x: 0, z: 0, strength: 1 },
        { x: 10, z: 10, strength: 1 },
      ]),
    ).toEqual([
      [0, 0],
      [10, 10],
    ]);
  });
});
