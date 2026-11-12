/**
 * The tallest towers of an open town: slender ones that taper, lean to a
 * point or split in two, so the middle of a town is not one model in several
 * liveries. The last two are landmarks, taller than anything else, which the
 * layout gives only to a city or a capital.
 */
import type { BuildingModel } from "./buildings";
import { model } from "./openTown";
import {
  chamfered,
  column,
  mast,
  plate,
  rect,
  round,
  shouldered,
} from "./parts";

export const OPEN_TOWN_TALL: readonly BuildingModel[] = [
  /* ------------------------------ one lot ------------------------------ */

  // A shaft that splits into two prongs of different heights, a mast on each.
  model("prongs", [1, 1], 2.35, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.12 * w), 0, 0.05 * h));
    t.wall(column(chamfered(0.72 * w, 0.72 * d, 0.1 * w), 0.05 * h, 0.62 * h));
    t.dark(plate(0.76 * w, 0.76 * d, 0.62 * h, 0.64 * h));
    t.ribs(
      column(
        rect(0.28 * w, 0.6 * d, -0.2 * w, 0),
        0.64 * h,
        0.9 * h,
        rect(0.16 * w, 0.4 * d, -0.2 * w, 0),
      ),
    );
    t.ribs(
      column(
        rect(0.28 * w, 0.6 * d, 0.2 * w, 0),
        0.64 * h,
        0.82 * h,
        rect(0.16 * w, 0.4 * d, 0.2 * w, 0),
      ),
    );
    t.dark(plate(0.1 * w, 0.3 * d, 0.64 * h, 0.76 * h));
    t.dark(mast(0.07 * w, 0.9 * h, h, -0.2 * w, 0));
    t.dark(mast(0.07 * w, 0.82 * h, 0.93 * h, 0.2 * w, 0));
  }),

  // A shard: it leans in to a point that stands off its centre, a low fin
  // against one side.
  model("shard", [1, 1], 2.5, (t, w, d, h) => {
    const mid = chamfered(0.6 * w, 0.6 * d, 0.06 * w, -0.06 * w, 0.04 * d);
    t.alt(column(chamfered(w, d, 0.12 * w), 0, 0.04 * h));
    t.wall(
      column(chamfered(0.8 * w, 0.8 * d, 0.08 * w), 0.04 * h, 0.45 * h, mid),
    );
    t.ribs(
      column(
        mid,
        0.45 * h,
        0.9 * h,
        chamfered(0.2 * w, 0.2 * d, 0.03 * w, -0.2 * w, 0.12 * d),
      ),
    );
    t.alt(plate(0.1 * w, 0.9 * d, 0.04 * h, 0.3 * h, 0.36 * w, 0));
    t.dark(mast(0.07 * w, 0.9 * h, h, -0.2 * w, 0.12 * d));
  }),

  // Four round drums, each narrower than the one below, under a tall mast.
  model("telescope", [1, 1], 2.65, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.2 * w), 0, 0.04 * h));
    const drums: [number, number, number][] = [
      [0.8, 0.04, 0.4],
      [0.64, 0.4, 0.62],
      [0.48, 0.62, 0.78],
      [0.32, 0.78, 0.88],
    ];
    drums.forEach(([s, y0, y1], i) => {
      (i % 2 === 0 ? t.wall : t.ribs)(
        column(round(s * w, s * d), y0 * h, y1 * h),
      );
      t.dark(
        column(round((s + 0.06) * w, (s + 0.06) * d), (y1 - 0.012) * h, y1 * h),
      );
    });
    t.dark(mast(0.1 * w, 0.88 * h, h));
  }),

  // A thin blade whose head slopes up to a ridge at one end, two dark bands
  // round it and a low block across its foot.
  model("blade", [1, 1], 2.8, (t, w, d, h) => {
    const body = rect(0.84 * w, 0.4 * d);
    t.alt(column(chamfered(w, d, 0.1 * w), 0, 0.04 * h));
    t.wall(column(body, 0.04 * h, 0.68 * h));
    t.ribs(
      column(body, 0.68 * h, 0.94 * h, rect(0.08 * w, 0.4 * d, 0.3 * w, 0)),
    );
    for (const y of [0.3, 0.5])
      t.dark(plate(0.88 * w, 0.44 * d, y * h, (y + 0.015) * h));
    t.alt(plate(0.3 * w, 0.9 * d, 0.04 * h, 0.22 * h, -0.2 * w, 0));
    t.dark(mast(0.07 * w, 0.94 * h, h, 0.3 * w, 0));
  }),

  // An obelisk: three lengths that each lean in, a dark band between them
  // and a long mast.
  model("obelisk", [1, 1], 3.1, (t, w, d, h) => {
    const plan = (s: number) => chamfered(s * w, s * d, 0.2 * s * w);
    t.alt(column(chamfered(w, d, 0.14 * w), 0, 0.04 * h));
    t.wall(column(plan(0.62), 0.04 * h, 0.4 * h, plan(0.5)));
    t.dark(column(plan(0.54), 0.4 * h, 0.415 * h));
    t.wall(column(plan(0.5), 0.415 * h, 0.68 * h, plan(0.36)));
    t.dark(column(plan(0.4), 0.68 * h, 0.695 * h));
    t.ribs(column(plan(0.36), 0.695 * h, 0.86 * h, plan(0.2)));
    t.dark(mast(0.12 * w, 0.86 * h, h));
  }),

  /* ------------------------------ four lots ---------------------------- */

  // A great shard that leans to an edge off its centre, a low slab against
  // its foot.
  model("great-shard", [2, 2], 3.3, (t, w, d, h) => {
    const m = Math.min(w, d);
    const mid = chamfered(0.62 * w, 0.7 * d, 0.1 * m, 0.06 * w, -0.04 * d);
    t.alt(column(chamfered(w, d, 0.14 * m), 0, 0.04 * h));
    t.wall(
      column(chamfered(0.86 * w, 0.86 * d, 0.14 * m), 0.04 * h, 0.4 * h, mid),
    );
    t.ribs(
      column(
        mid,
        0.4 * h,
        0.93 * h,
        chamfered(0.14 * w, 0.3 * d, 0.03 * m, 0.2 * w, -0.1 * d),
      ),
    );
    t.alt(
      shouldered(
        0.3 * w,
        0.04 * h,
        0.3 * h,
        0.06 * w,
        0.3 * d,
        0.47 * d,
        -0.2 * w,
      ),
    );
    t.dark(mast(0.05 * m, 0.93 * h, h, 0.2 * w, -0.1 * d));
  }),

  // Two slim towers of different heights that each narrow to a mast, joined
  // by two bridges over a low block.
  model("fork", [2, 2], 3.9, (t, w, d, h) => {
    const m = Math.min(w, d);
    t.alt(column(chamfered(w, d, 0.12 * m), 0, 0.04 * h));
    const towers: [number, number, number, number][] = [
      [-1, 0.7, 0.9, 1],
      [1, 0.58, 0.76, 0.85],
    ];
    for (const [side, body, tip, top] of towers) {
      const x = side * 0.26 * w;
      const plan = chamfered(0.36 * w, 0.6 * d, 0.06 * m, x, 0);
      t.wall(column(plan, 0.04 * h, body * h));
      t.ribs(
        column(
          plan,
          body * h,
          tip * h,
          chamfered(0.1 * w, 0.2 * d, 0.02 * m, x, 0),
        ),
      );
      t.dark(mast(0.05 * m, tip * h, top * h, x, 0));
    }
    t.dark(plate(0.2 * w, 0.24 * d, 0.3 * h, 0.33 * h));
    t.dark(plate(0.2 * w, 0.24 * d, 0.48 * h, 0.51 * h));
    t.alt(plate(0.3 * w, 0.8 * d, 0.04 * h, 0.14 * h));
  }),

  /* ------------------------------ landmarks ---------------------------- */

  // A needle that narrows all the way up in six lengths to a mast, two dark
  // bands round it and a low slab at each end of its foot.
  model(
    "pinnacle",
    [2, 2],
    5.4,
    (t, w, d, h) => {
      const m = Math.min(w, d);
      const plan = (s: number) => chamfered(s * w, s * d, 0.22 * s * m);
      const sizes = [0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.12];
      const levels = [0.03, 0.2, 0.36, 0.52, 0.66, 0.78, 0.86];
      t.alt(column(chamfered(w, d, 0.2 * m), 0, 0.03 * h));
      for (let i = 0; i < 6; i++)
        (i % 3 === 2 ? t.ribs : t.wall)(
          column(
            plan(sizes[i]),
            levels[i] * h,
            levels[i + 1] * h,
            plan(sizes[i + 1]),
          ),
        );
      t.dark(column(plan(0.54), 0.355 * h, 0.365 * h));
      t.dark(column(plan(0.34), 0.655 * h, 0.665 * h));
      for (const side of [-1, 1])
        t.alt(
          shouldered(
            0.4 * d,
            0.03 * h,
            (side < 0 ? 0.16 : 0.12) * h,
            0.08 * d,
            side * 0.3 * w,
            side * 0.47 * w,
            0,
            true,
          ),
        );
      t.dark(mast(0.08 * m, 0.86 * h, h));
    },
    true,
  ),

  // A round core between four wings that stop at different heights, a
  // glazed cone over it and a long mast.
  model(
    "beacon",
    [2, 2],
    6.2,
    (t, w, d, h) => {
      const m = Math.min(w, d);
      t.alt(column(chamfered(w, d, 0.18 * m), 0, 0.025 * h));
      t.wall(column(round(0.44 * w, 0.44 * d), 0.025 * h, 0.78 * h));
      const wings: [number, number, number][] = [
        [1, 0, 0.68],
        [0, 1, 0.56],
        [-1, 0, 0.44],
        [0, -1, 0.32],
      ];
      wings.forEach(([sx, sz, top], i) => {
        const size: [number, number] =
          sx !== 0 ? [0.28 * w, 0.24 * d] : [0.24 * w, 0.28 * d];
        (i % 2 === 0 ? t.ribs : t.wall)(
          plate(...size, 0.025 * h, top * h, sx * 0.32 * w, sz * 0.32 * d),
        );
        t.dark(
          plate(
            size[0] * 0.7,
            size[1] * 0.7,
            top * h,
            (top + 0.012) * h,
            sx * 0.32 * w,
            sz * 0.32 * d,
          ),
        );
      });
      t.dark(column(round(0.48 * w, 0.48 * d), 0.78 * h, 0.79 * h));
      t.ribs(
        column(
          round(0.44 * w, 0.44 * d),
          0.79 * h,
          0.88 * h,
          round(0.12 * w, 0.12 * d),
        ),
      );
      t.dark(mast(0.1 * m, 0.88 * h, h));
    },
    true,
  ),
];
