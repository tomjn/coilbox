/**
 * More buildings for an open town, with the detail the first twenty left
 * out: masts, piers, braces, roof plant, round towers and stepped ones. A
 * part too small to show at the closest the camera comes still breaks up an
 * outline or a roof, which is what it is for.
 */
import type { BuildingModel } from "./buildings";
import { model, type Tools } from "./openTown";
import { beam, chamfered, column, mast, plate, rect, round } from "./parts";

/** One part at each of the four corners, `x` and `z` from the centre. */
const corners = (
  x: number,
  z: number,
  part: (cx: number, cz: number) => void,
): void => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(sx * x, sz * z);
};

export const OPEN_TOWN_DETAIL: readonly BuildingModel[] = [
  /* ------------------------------ one lot ------------------------------ */

  // Three wings round a garden court, open to the street.
  model("court", [1, 1], 0.24, (t, w, d, h) => {
    t.wall(plate(w, 0.3 * d, 0, 0.8 * h, 0, -0.35 * d));
    t.wall(plate(0.3 * w, 0.7 * d, 0, 0.7 * h, -0.35 * w, 0.15 * d));
    t.ribs(plate(0.3 * w, 0.7 * d, 0, h, 0.35 * w, 0.15 * d));
    t.green(plate(0.4 * w, 0.7 * d, 0, 0.14 * h, 0, 0.15 * d));
    t.alt(plate(0.5 * w, 0.16 * d, 0.8 * h, 0.92 * h, -0.1 * w, -0.35 * d));
    t.dark(plate(0.12 * w, 0.12 * d, 0.7 * h, 0.86 * h, -0.35 * w, 0.3 * d));
  }),

  // A block with a glazed slope down one side.
  model("atrium", [1, 1], 0.42, (t, w, d, h) => {
    t.wall(column(chamfered(0.6 * w, d, 0.08 * w, -0.2 * w, 0), 0, 0.8 * h));
    t.ribs(
      column(
        rect(0.42 * w, 0.9 * d, 0.29 * w, 0),
        0,
        0.72 * h,
        rect(0.04 * w, 0.9 * d, 0.1 * w, 0),
      ),
    );
    t.alt(plate(0.4 * w, 0.5 * d, 0.8 * h, h, -0.24 * w, -0.1 * d));
    t.dark(plate(0.14 * w, 0.2 * d, 0.8 * h, 0.9 * h, -0.24 * w, 0.32 * d));
  }),

  // A slab between five fins that stand proud of both its faces.
  model("fins", [1, 1], 0.6, (t, w, d, h) => {
    t.alt(plate(w, d, 0, 0.1 * h));
    t.ribs(column(rect(0.8 * w, 0.66 * d), 0.1 * h, 0.92 * h));
    for (let i = -2; i <= 2; i++)
      t.wall(plate(0.07 * w, 0.9 * d, 0.1 * h, 0.96 * h, i * 0.2 * w, 0));
    t.alt(plate(0.5 * w, 0.4 * d, 0.92 * h, h));
  }),

  // A plain block under a cornice, its roof full of plant and one mast.
  model("plant", [1, 1], 0.78, (t, w, d, h) => {
    t.wall(column(chamfered(0.92 * w, 0.92 * d, 0.06 * w), 0, 0.74 * h));
    t.dark(plate(0.94 * w, 0.94 * d, 0.2 * h, 0.24 * h));
    t.alt(plate(0.98 * w, 0.98 * d, 0.74 * h, 0.78 * h));
    t.alt(plate(0.3 * w, 0.3 * d, 0.78 * h, 0.88 * h, -0.22 * w, -0.22 * d));
    t.dark(plate(0.24 * w, 0.4 * d, 0.78 * h, 0.84 * h, 0.22 * w, 0.1 * d));
    t.wall(plate(0.2 * w, 0.2 * d, 0.78 * h, 0.9 * h, -0.2 * w, 0.24 * d));
    t.dark(mast(0.07 * w, 0.78 * h, h, 0.3 * w, -0.3 * d));
  }),

  // A round tower with three dark rings, a cap and a mast.
  model("round", [1, 1], 1.05, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.2 * w), 0, 0.08 * h));
    t.wall(column(round(0.82 * w, 0.82 * d), 0.08 * h, 0.9 * h));
    for (const y of [0.3, 0.5, 0.7])
      t.dark(column(round(0.88 * w, 0.88 * d), y * h, (y + 0.03) * h));
    t.alt(column(round(0.92 * w, 0.92 * d), 0.9 * h, 0.93 * h));
    t.wall(column(round(0.5 * w, 0.5 * d), 0.93 * h, 0.97 * h));
    t.dark(mast(0.07 * w, 0.97 * h, h));
  }),

  // Three tiers that step in, piers at the corners of two and a spire.
  model("setback", [1, 1], 1.35, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.08 * w), 0, 0.1 * h));
    t.wall(column(rect(0.86 * w, 0.86 * d), 0.1 * h, 0.5 * h));
    t.ribs(column(rect(0.66 * w, 0.66 * d), 0.5 * h, 0.74 * h));
    t.wall(column(rect(0.46 * w, 0.46 * d), 0.74 * h, 0.88 * h));
    t.alt(
      column(
        rect(0.3 * w, 0.3 * d),
        0.88 * h,
        0.93 * h,
        rect(0.1 * w, 0.1 * d),
      ),
    );
    t.dark(mast(0.07 * w, 0.93 * h, h));
    corners(0.4 * w, 0.4 * d, (x, z) =>
      t.alt(plate(0.14 * w, 0.14 * d, 0.1 * h, 0.56 * h, x, z)),
    );
    corners(0.31 * w, 0.31 * d, (x, z) =>
      t.wall(plate(0.1 * w, 0.1 * d, 0.5 * h, 0.78 * h, x, z)),
    );
  }),

  // A shaft with a glazed strip up each face between four piers that stand
  // above its roof, two of them with masts.
  model("pier-tower", [1, 1], 1.65, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.1 * w), 0, 0.06 * h));
    t.wall(column(rect(0.76 * w, 0.76 * d), 0.06 * h, 0.9 * h));
    t.ribs(plate(0.3 * w, 0.82 * d, 0.1 * h, 0.86 * h));
    t.ribs(plate(0.82 * w, 0.3 * d, 0.1 * h, 0.86 * h));
    corners(0.36 * w, 0.36 * d, (x, z) =>
      t.alt(plate(0.16 * w, 0.16 * d, 0.06 * h, 0.95 * h, x, z)),
    );
    t.dark(plate(0.5 * w, 0.5 * d, 0.9 * h, 0.93 * h));
    t.wall(plate(0.3 * w, 0.3 * d, 0.93 * h, 0.97 * h));
    t.dark(mast(0.06 * w, 0.95 * h, h, -0.36 * w, -0.36 * d));
    t.dark(mast(0.06 * w, 0.95 * h, 0.99 * h, 0.36 * w, 0.36 * d));
  }),

  // A shaft held in a frame: a column at each corner, a floor band between
  // each of three bays and crossed braces up two faces.
  model("braced", [1, 1], 1.95, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.1 * w), 0, 0.05 * h));
    t.wall(column(rect(0.7 * w, 0.7 * d), 0.05 * h, 0.94 * h));
    for (const side of [-1, 1])
      for (let bay = 0; bay < 3; bay++) {
        const y0 = (0.08 + bay * 0.28) * h;
        const y1 = y0 + 0.28 * h;
        const z = side * 0.37 * d;
        t.dark(beam([-0.33 * w, y0, z], [0.33 * w, y1, z], 0.05 * w, 0.05 * d));
        t.dark(beam([0.33 * w, y0, z], [-0.33 * w, y1, z], 0.05 * w, 0.05 * d));
      }
    corners(0.35 * w, 0.35 * d, (x, z) =>
      t.alt(plate(0.1 * w, 0.1 * d, 0.05 * h, 0.96 * h, x, z)),
    );
    for (const y of [0.36, 0.64, 0.92])
      t.alt(plate(0.78 * w, 0.78 * d, y * h, (y + 0.015) * h));
    t.dark(plate(0.4 * w, 0.4 * d, 0.94 * h, 0.97 * h));
    t.dark(mast(0.07 * w, 0.97 * h, h, 0.1 * w, 0.1 * d));
  }),

  // A slim tower that narrows twice, a dark slot through its foot and three
  // masts on its crown.
  model("needle", [1, 1], 2.25, (t, w, d, h) => {
    const low = chamfered(0.7 * w, 0.7 * d, 0.1 * w);
    const mid = chamfered(0.54 * w, 0.54 * d, 0.08 * w);
    const top = chamfered(0.38 * w, 0.38 * d, 0.06 * w);
    t.alt(column(chamfered(w, d, 0.14 * w), 0, 0.05 * h));
    t.wall(column(low, 0.05 * h, 0.5 * h));
    t.wall(column(low, 0.5 * h, 0.54 * h, mid));
    t.ribs(column(mid, 0.54 * h, 0.76 * h));
    t.wall(column(mid, 0.76 * h, 0.79 * h, top));
    t.wall(column(top, 0.79 * h, 0.88 * h));
    t.dark(plate(0.12 * w, 0.74 * d, 0.1 * h, 0.46 * h));
    t.dark(plate(0.5 * w, 0.5 * d, 0.88 * h, 0.9 * h));
    t.dark(mast(0.08 * w, 0.9 * h, h));
    t.dark(mast(0.06 * w, 0.9 * h, 0.96 * h, -0.15 * w, 0));
    t.dark(mast(0.06 * w, 0.9 * h, 0.95 * h, 0.15 * w, 0));
  }),

  /* ------------------------------ two lots ----------------------------- */

  // Four steps down the length of a slab, a garden on each but the top.
  model("terraces", [2, 1], 0.7, (t, w, d, h) => {
    t.alt(plate(w, d, 0, 0.1 * h));
    [0.94, 0.72, 0.5, 0.3].forEach((top, i) => {
      const x = (i - 1.5) * 0.24 * w;
      (i % 2 === 0 ? t.wall : t.ribs)(
        plate(0.24 * w, 0.9 * d, 0.1 * h, top * h, x, 0),
      );
      if (i > 0)
        t.green(plate(0.18 * w, 0.7 * d, top * h, (top + 0.03) * h, x, 0));
    });
    t.alt(plate(0.14 * w, 0.5 * d, 0.94 * h, h, -0.36 * w, 0));
  }),

  // Two towers of different heights on one podium, two bridges between them.
  model("twin-link", [2, 1], 1.15, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.1 * d), 0, 0.14 * h));
    t.wall(
      column(
        chamfered(0.36 * w, 0.84 * d, 0.08 * d, -0.3 * w, 0),
        0.14 * h,
        0.94 * h,
      ),
    );
    t.ribs(
      column(
        chamfered(0.36 * w, 0.84 * d, 0.08 * d, 0.3 * w, 0),
        0.14 * h,
        0.8 * h,
      ),
    );
    t.dark(plate(0.26 * w, 0.3 * d, 0.5 * h, 0.56 * h));
    t.dark(plate(0.26 * w, 0.3 * d, 0.7 * h, 0.74 * h));
    t.green(plate(0.2 * w, 0.7 * d, 0.14 * h, 0.17 * h));
    t.alt(plate(0.2 * w, 0.5 * d, 0.94 * h, 0.97 * h, -0.3 * w, 0));
    t.dark(mast(0.05 * w, 0.97 * h, h, -0.3 * w, 0));
    t.alt(plate(0.24 * w, 0.4 * d, 0.8 * h, 0.86 * h, 0.3 * w, 0));
  }),

  // A slab on two legs with daylight under it, a low core in the gap.
  model("arch", [2, 1], 1.7, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.1 * d), 0, 0.06 * h));
    for (const side of [-1, 1])
      t.wall(plate(0.28 * w, 0.8 * d, 0.06 * h, 0.7 * h, side * 0.34 * w, 0));
    t.ribs(plate(0.96 * w, 0.8 * d, 0.7 * h, 0.94 * h));
    t.dark(plate(0.4 * w, 0.5 * d, 0.06 * h, 0.3 * h));
    t.alt(plate(0.98 * w, 0.84 * d, 0.94 * h, 0.96 * h));
    t.wall(plate(0.3 * w, 0.4 * d, 0.96 * h, h, 0.2 * w, 0));
    t.accent(plate(0.2 * w, 0.02 * d, 0.76 * h, 0.9 * h, -0.2 * w, 0.41 * d));
  }),

  /* ------------------------------ four lots ---------------------------- */

  // An arena: a bowl that flares to its rim, dark stands, a pitch and a
  // light mast on each side of its rim.
  model("arena", [2, 2], 0.36, (t, w, d, h) => {
    const m = Math.min(w, d);
    const rim = chamfered(0.96 * w, 0.96 * d, 0.3 * m);
    t.wall(column(chamfered(0.8 * w, 0.8 * d, 0.25 * m), 0, 0.7 * h, rim));
    t.alt(column(rim, 0.7 * h, 0.8 * h));
    t.dark(column(chamfered(0.76 * w, 0.76 * d, 0.22 * m), 0.8 * h, 0.83 * h));
    t.green(plate(0.44 * w, 0.3 * d, 0.83 * h, 0.86 * h));
    for (const side of [-1, 1]) {
      t.dark(mast(0.04 * m, 0.8 * h, h, side * 0.43 * w, 0));
      t.dark(mast(0.04 * m, 0.8 * h, h, 0, side * 0.43 * d));
    }
  }),

  // A hall whose walls slope in to a glazed lantern, a buttress up each side.
  model("pyramid", [2, 2], 0.6, (t, w, d, h) => {
    const m = Math.min(w, d);
    const waist = chamfered(0.5 * w, 0.5 * d, 0.06 * m);
    t.alt(plate(w, d, 0, 0.08 * h));
    t.wall(
      column(chamfered(0.94 * w, 0.94 * d, 0.1 * m), 0.08 * h, 0.6 * h, waist),
    );
    t.ribs(
      column(waist, 0.6 * h, 0.8 * h, chamfered(0.3 * w, 0.3 * d, 0.04 * m)),
    );
    t.alt(
      column(
        rect(0.08 * w, 0.98 * d),
        0.08 * h,
        0.5 * h,
        rect(0.08 * w, 0.4 * d),
      ),
    );
    t.alt(
      column(
        rect(0.98 * w, 0.08 * d),
        0.08 * h,
        0.5 * h,
        rect(0.4 * w, 0.08 * d),
      ),
    );
    t.dark(plate(0.2 * w, 0.2 * d, 0.8 * h, 0.9 * h));
    t.dark(mast(0.05 * m, 0.9 * h, h));
  }),

  // Four shafts of different heights bound into one tower, two masts on the
  // tallest.
  model("cluster", [2, 2], 1.9, (t, w, d, h) => {
    const m = Math.min(w, d);
    t.alt(column(chamfered(w, d, 0.1 * m), 0, 0.05 * h));
    const shafts: [number, number, number, keyof Tools][] = [
      [-1, -1, 0.94, "wall"],
      [1, -1, 0.78, "ribs"],
      [1, 1, 0.62, "wall"],
      [-1, 1, 0.46, "alt"],
    ];
    for (const [sx, sz, top, finish] of shafts) {
      const x = sx * 0.22 * w;
      const z = sz * 0.22 * d;
      t[finish](plate(0.42 * w, 0.42 * d, 0.05 * h, top * h, x, z));
      t.dark(plate(0.3 * w, 0.3 * d, top * h, (top + 0.02) * h, x, z));
    }
    t.dark(plate(0.04 * w, 0.9 * d, 0.05 * h, 0.44 * h));
    t.dark(plate(0.9 * w, 0.04 * d, 0.05 * h, 0.44 * h));
    t.dark(mast(0.05 * m, 0.96 * h, h, -0.28 * w, -0.22 * d));
    t.dark(mast(0.05 * m, 0.96 * h, 0.99 * h, -0.16 * w, -0.22 * d));
  }),

  // A great round tower: three dark rings, four fins up its sides, a
  // glazed shoulder and a landing deck with a mast.
  model("great-round", [2, 2], 2.15, (t, w, d, h) => {
    const m = Math.min(w, d);
    const shaft = round(0.8 * w, 0.8 * d, 16);
    t.alt(column(chamfered(w, d, 0.2 * m), 0, 0.05 * h));
    t.wall(column(shaft, 0.05 * h, 0.86 * h));
    for (const y of [0.25, 0.45, 0.65])
      t.dark(column(round(0.84 * w, 0.84 * d, 16), y * h, (y + 0.02) * h));
    t.alt(plate(0.06 * w, 0.9 * d, 0.05 * h, 0.8 * h));
    t.alt(plate(0.9 * w, 0.06 * d, 0.05 * h, 0.8 * h));
    t.ribs(column(shaft, 0.86 * h, 0.92 * h, round(0.6 * w, 0.6 * d, 16)));
    t.alt(column(round(0.5 * w, 0.5 * d, 16), 0.92 * h, 0.94 * h));
    t.dark(mast(0.05 * m, 0.94 * h, h, 0.2 * w, 0));
  }),

  // A great tower in three tiers, piers at the corners of two, a dark slot
  // up each face, a pointed crown and a spire.
  model("crown-tower", [2, 2], 2.75, (t, w, d, h) => {
    const m = Math.min(w, d);
    t.alt(column(chamfered(w, d, 0.1 * m), 0, 0.05 * h));
    t.wall(column(rect(0.8 * w, 0.8 * d), 0.05 * h, 0.6 * h));
    t.ribs(column(rect(0.64 * w, 0.64 * d), 0.6 * h, 0.8 * h));
    t.wall(column(rect(0.48 * w, 0.48 * d), 0.8 * h, 0.9 * h));
    corners(0.37 * w, 0.37 * d, (x, z) =>
      t.alt(plate(0.14 * w, 0.14 * d, 0.05 * h, 0.66 * h, x, z)),
    );
    corners(0.3 * w, 0.3 * d, (x, z) =>
      t.alt(plate(0.1 * w, 0.1 * d, 0.6 * h, 0.84 * h, x, z)),
    );
    t.dark(plate(0.2 * w, 0.82 * d, 0.1 * h, 0.56 * h));
    t.dark(plate(0.82 * w, 0.2 * d, 0.1 * h, 0.56 * h));
    t.alt(
      column(
        rect(0.36 * w, 0.36 * d),
        0.9 * h,
        0.95 * h,
        rect(0.12 * w, 0.12 * d),
      ),
    );
    t.dark(mast(0.06 * m, 0.95 * h, h));
  }),
];
