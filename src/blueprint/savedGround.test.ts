/**
 * A blueprint the widget saved from the ground in a real Zero-K match (issue
 * #4798), checked against coilbox's model of Zero-K's terraform.
 *
 * `fixtures/zerok-saved-ground.json` comes from the build match of
 * `scripts/zerok-terraform-headless.sh` on SpeedMetal BAR V2, which is flat
 * across the middle. It holds what Save selection wrote for a wall raised by
 * 112 with two Lotus on it, a pad levelled 40 up with a solar collector on it
 * and a solar collector beside them, and the change in height the match left
 * round them, every 8 elmos from `from`.
 */

import { describe, expect, it } from "vitest";
import saved from "./fixtures/zerok-saved-ground.json";
import { sourceLabel } from "./library";
import { type GroundHeights, terraform } from "./terraform";
import { readSpool, spoolRecords } from "./widget";

const spool = JSON.stringify({
  version: 1,
  blueprints: [{ ...saved.entry, recordedAt: 0 }],
});

describe("ground saved in a real Zero-K match (issue #4798)", () => {
  it("is collected as a blueprint of buildings and raise steps, marked as from the ground", () => {
    const read = readSpool(spool);
    expect(read.skipped).toBe(0);
    const [record] = spoolRecords(read.entries, "2026.07.01");
    expect(record.layout.buildings.map((b) => b.def)).toEqual([
      "energysolar",
      "turretlaser",
      "turretlaser",
      "energysolar",
    ]);
    // the wall is longer than one of the gadget's terraform blocks, so it is
    // two steps
    expect(record.layout.terrain?.map((s) => [s.kind, s.height])).toEqual([
      ["raise", 40],
      ["raise", 112],
      ["raise", 112],
    ]);
    expect(record.source && sourceLabel(record.source)).toBe(
      "Saved from the ground",
    );
  });

  it("raises the ground the match measured, slopes and all, when coilbox's terraform model places it", () => {
    const layout = readSpool(spool).entries[0].layout;
    const rows = saved.change;
    const width = rows[0].length;
    const height = rows.length;
    const flat: GroundHeights = {
      width,
      height,
      heights: new Float32Array(width * height),
    };
    const result = terraform(
      flat,
      layout.terrain ?? [],
      {
        at: {
          x: saved.anchor.x - saved.from.x,
          z: saved.anchor.z - saved.from.z,
        },
        quarters: 0,
      },
      [],
    );
    expect(result.steps.map((s) => s.outcome)).toEqual([
      "built",
      "built",
      "built",
    ]);
    const differ: string[] = [];
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const model = result.ground.heights[r * width + c];
        if (Math.abs(model - rows[r][c]) > 0.01) {
          differ.push(`${c * 8},${r * 8}: ${model} vs ${rows[r][c]}`);
        }
      }
    }
    // The pad's four outer diagonal corners, where the model leaves 40 - 28 *
    // sqrt(2) and Zero-K keeps its 4 elmo foot step (#4805). Empty this when
    // that is fixed.
    expect(differ.map((d) => d.split(":")[0])).toEqual([
      "728,24",
      "872,24",
      "728,136",
      "872,136",
    ]);
  });
});
