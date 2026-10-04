import { describe, expect, it } from "vitest";
import {
  EDGE_SOFTNESS,
  type ProvincePixels,
  pointInRing,
  SPECK_PIXELS,
  traceProvinces,
} from "./trace";

const A = "#ff0000";
const B = "#0000ff";
const C = "#00ff00";

/** Paint an image from rows of letters. `.` is transparent. */
function paint(
  rows: string[],
  palette: Record<string, string>,
): ProvincePixels {
  const width = rows[0].length;
  const data = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) => {
    [...row].forEach((letter, x) => {
      if (letter === ".") return;
      const rgb = Number.parseInt(palette[letter].slice(1), 16);
      data.set(
        [rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255],
        (y * width + x) * 4,
      );
    });
  });
  return { data, width, height: rows.length };
}

/** `count` rows of `row`. */
const rows = (count: number, row: string) => Array<string>(count).fill(row);

describe("traceProvinces", () => {
  it("traces two touching rectangles into outlines, anchors and a border", () => {
    const traced = traceProvinces({
      image: paint(rows(6, "AAAABBBBBB"), { A, B }),
      colors: [A, B],
    });
    expect(traced.unlisted).toEqual([]);
    expect(traced.borders).toEqual([[0, 1]]);
    expect(traced.provinces[0]?.pieces).toEqual([
      [
        [0, 0],
        [4, 0],
        [4, 6],
        [0, 6],
      ],
    ]);
    expect(traced.provinces[0]?.pixels).toBe(24);
    expect(traced.provinces[1]?.pieces[0]).toHaveLength(4);
    // 4 wide, so the two middle columns are deepest and the one nearer the
    // centre of the area wins.
    const [ax, ay] = traced.provinces[0]?.anchor ?? [0, 0];
    expect(ax).toBeGreaterThan(1);
    expect(ax).toBeLessThan(3);
    expect(ay).toBeGreaterThan(2);
    expect(ay).toBeLessThan(4);
  });

  it("does not count provinces that meet only at a corner as neighbours", () => {
    const traced = traceProvinces({
      image: paint([...rows(4, "AAAA...."), ...rows(4, "....BBBB")], { A, B }),
      colors: [A, B],
    });
    expect(traced.borders).toEqual([]);
  });

  it("returns null for a colour that is never painted", () => {
    const traced = traceProvinces({
      image: paint(rows(4, "AAAA"), { A }),
      colors: [A, B],
    });
    expect(traced.provinces[1]).toBeNull();
  });

  it("treats the background colour as unpainted", () => {
    const traced = traceProvinces({
      image: paint(rows(4, "AAAAWWWWBBBB"), { A, B, W: "#ffffff" }),
      colors: [A, B],
      background: "#ffffff",
    });
    expect(traced.unlisted).toEqual([]);
    expect(traced.borders).toEqual([]);
    expect(traced.provinces[0]?.pixels).toBe(16);
  });

  describe("soft edges", () => {
    // A blend between red and blue, nearer red on the left.
    const palette = { A, B, p: "#c00040", q: "#800080", r: "#4000c0" };

    it("gives a one pixel anti-aliased seam to the nearer colour", () => {
      const traced = traceProvinces({
        image: paint(rows(8, "AAAApBBBB"), palette),
        colors: [A, B],
      });
      expect(traced.unlisted).toEqual([]);
      expect(traced.borders).toEqual([[0, 1]]);
      // The seam pixel is mostly red, so it joins the red province.
      expect(traced.provinces[0]?.pixels).toBe(5 * 8);
      expect(traced.provinces[1]?.pixels).toBe(4 * 8);
    });

    it("absorbs a seam twice EDGE_SOFTNESS wide and reports nothing", () => {
      expect(EDGE_SOFTNESS).toBe(2);
      const traced = traceProvinces({
        image: paint(rows(8, "AAAAppqrBBBB"), palette),
        colors: [A, B],
      });
      expect(traced.unlisted).toEqual([]);
      expect(traced.borders).toEqual([[0, 1]]);
      expect(traced.provinces[0]?.pixels).toBe(6 * 8);
      expect(traced.provinces[1]?.pixels).toBe(6 * 8);
    });

    it("reports a band one pixel wider than that as an unlisted colour", () => {
      const traced = traceProvinces({
        image: paint(rows(8, "AAAAppqrrBBBB"), palette),
        colors: [A, B],
      });
      // The middle column is the one no round reached.
      expect(traced.unlisted).toEqual([{ color: "#800080", x: 6, y: 0 }]);
    });

    it("reports a real unlisted region with its colour and a pixel inside it", () => {
      const image = paint(
        [
          ...rows(3, "AAAAAAAAA"),
          ...rows(5, "AACCCCCAA"),
          ...rows(3, "AAAAAAAAA"),
        ],
        { A, C },
      );
      const traced = traceProvinces({ image, colors: [A] });
      expect(traced.unlisted).toEqual([{ color: C, x: 4, y: 5 }]);
    });

    it("counts a half transparent pixel as painted and a fainter one as not", () => {
      const image = paint(rows(4, "AAAA"), { A });
      image.data[3] = 128;
      image.data[7] = 127;
      const traced = traceProvinces({ image, colors: [A] });
      expect(traced.provinces[0]?.pixels).toBe(15);
    });
  });

  describe("specks and pieces", () => {
    /** A field of B with one extra block of A, `speck` pixels in a row. */
    const withSpeck = (speck: number) => {
      const image = paint(
        [...rows(4, "AAAAAAAAAAAAAAAA"), ...rows(8, "BBBBBBBBBBBBBBBB")],
        { A, B },
      );
      for (let i = 0; i < speck; i++) {
        image.data.set([255, 0, 0, 255], (8 * 16 + 3 + i) * 4);
      }
      return traceProvinces({ image, colors: [A, B] });
    };

    it("absorbs a stray piece smaller than SPECK_PIXELS into what surrounds it", () => {
      const traced = withSpeck(SPECK_PIXELS - 1);
      expect(traced.unlisted).toEqual([]);
      expect(traced.provinces[0]?.pieces).toHaveLength(1);
      expect(traced.provinces[0]?.pixels).toBe(4 * 16);
      expect(traced.provinces[1]?.pixels).toBe(8 * 16);
    });

    it("keeps a piece of SPECK_PIXELS as a second polygon of the province", () => {
      const traced = withSpeck(SPECK_PIXELS);
      expect(traced.provinces[0]?.pieces).toHaveLength(2);
      expect(traced.provinces[0]?.pixels).toBe(4 * 16 + SPECK_PIXELS);
    });

    it("keeps a province's only piece however small it is", () => {
      const traced = traceProvinces({
        image: paint(["....", ".A..", "...."], { A }),
        colors: [A],
      });
      expect(traced.provinces[0]?.pieces).toEqual([
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      ]);
    });

    it("keeps a province painted in two pieces as two polygons, largest first", () => {
      const traced = traceProvinces({
        image: paint(rows(5, "AAA...AAAAAA"), { A }),
        colors: [A],
      });
      const pieces = traced.provinces[0]?.pieces ?? [];
      expect(pieces).toHaveLength(2);
      expect(pieces[0][0]).toEqual([6, 0]);
      expect(pieces[1][0]).toEqual([0, 0]);
      // The anchor is in the larger piece.
      expect(traced.provinces[0]?.anchor[0]).toBeGreaterThan(6);
    });

    it("does not trace a hole inside a province", () => {
      const traced = traceProvinces({
        image: paint(
          [
            ...rows(3, "AAAAAAAAA"),
            ...rows(3, "AAA...AAA"),
            ...rows(3, "AAAAAAAAA"),
          ],
          { A },
        ),
        colors: [A],
      });
      expect(traced.provinces[0]?.pieces).toHaveLength(1);
      expect(traced.provinces[0]?.pieces[0]).toHaveLength(4);
    });
  });

  describe("outlines", () => {
    /** A square cut along its diagonal: A below it, B above. */
    const diagonal = () => {
      const size = 20;
      const lines: string[] = [];
      for (let y = 0; y < size; y++) {
        lines.push(
          Array.from({ length: size }, (_, x) => (x < y ? "A" : "B")).join(""),
        );
      }
      return traceProvinces({ image: paint(lines, { A, B }), colors: [A, B] });
    };

    it("simplifies a staircase edge to a straight line", () => {
      const ring = diagonal().provinces[0]?.pieces[0] ?? [];
      // 19 steps of stairs, 40 corners as painted.
      expect(ring).toHaveLength(3);
      expect(ring).toEqual(
        expect.arrayContaining([
          [0, 1],
          [19, 20],
          [0, 20],
        ]),
      );
    });

    it("gives both provinces along a border the same points for it", () => {
      const traced = diagonal();
      const a = traced.provinces[0]?.pieces[0] ?? [];
      const b = traced.provinces[1]?.pieces[0] ?? [];
      for (const end of [
        [0, 1],
        [19, 20],
      ]) {
        expect(a).toContainEqual(end);
        expect(b).toContainEqual(end);
      }
      // Nothing else of either ring lies along the diagonal.
      const onDiagonal = (ring: [number, number][]) =>
        ring.filter(([x, y]) => Math.abs(y - x - 1) < 1.5 && x > 0 && x < 19);
      expect(onDiagonal(a)).toEqual([]);
      expect(onDiagonal(b)).toEqual([]);
    });

    it("anchors a C shaped province inside it, where the centroid is not", () => {
      const lines = [
        ...rows(4, "AAAAAAAAAAAA"),
        ...rows(8, "AAAA........"),
        ...rows(4, "AAAAAAAAAAAA"),
      ];
      const traced = traceProvinces({
        image: paint(lines, { A }),
        colors: [A],
      });
      const province = traced.provinces[0];
      const ring = province?.pieces[0] ?? [];
      const [x, y] = province?.anchor ?? [0, 0];
      expect(pointInRing(x, y, ring)).toBe(true);
      expect(lines[Math.floor(y)][Math.floor(x)]).toBe("A");
      // The centroid of the painted pixels falls in the open middle.
      const painted = lines.flatMap((line, py) =>
        [...line].flatMap((letter, px) => (letter === "A" ? [[px, py]] : [])),
      );
      const cx = painted.reduce((sum, p) => sum + p[0], 0) / painted.length;
      const cy = painted.reduce((sum, p) => sum + p[1], 0) / painted.length;
      expect(lines[Math.floor(cy)][Math.floor(cx)]).toBe(".");
    });
  });
});
