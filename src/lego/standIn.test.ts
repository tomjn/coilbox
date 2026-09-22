import { describe, expect, it } from "vitest";

import type { StandInTrack } from "./scriptPlayback";
import { attachedAt, standInAt, standInRadius } from "./standIn";

/** Two keys, ten frames apart, moving two radii along x and one up. */
function track(overrides: Partial<StandInTrack> = {}): StandInTrack {
  return {
    keys: [
      { frame: 10, pos: [0, 0, 2] },
      { frame: 20, pos: [2, 1, 2] },
    ],
    ...overrides,
  };
}

describe("standInAt", () => {
  it("scales a key's radius multiples into elmos", () => {
    expect(standInAt(track(), 10, 8)?.pos).toEqual([0, 0, 16]);
  });

  it("interpolates between two keys", () => {
    expect(standInAt(track(), 15, 8)?.pos).toEqual([8, 4, 16]);
  });

  /** A frame before the first key holds the first key, rather than
   *  extrapolating backwards to somewhere the scenario never asked for. */
  it("holds the first key before the track starts", () => {
    expect(standInAt(track(), 0, 8)?.pos).toEqual([0, 0, 16]);
  });

  it("holds the last key after the track ends", () => {
    expect(standInAt(track(), 999, 8)?.pos).toEqual([16, 8, 16]);
  });

  it("has no position at all for a track with no keys", () => {
    expect(standInAt({ keys: [] }, 0, 8)).toBeNull();
  });

  /** Heading is optional on a key and interpolates like the position does. */
  it("interpolates heading, and is zero where no key sets one", () => {
    const turning: StandInTrack = {
      keys: [
        { frame: 0, pos: [0, 0, 0], heading: 0 },
        { frame: 10, pos: [0, 0, 0], heading: 1 },
      ],
    };
    expect(standInAt(turning, 5, 8)?.heading).toBeCloseTo(0.5);
    expect(standInAt(track(), 15, 8)?.heading).toBe(0);
  });

  /** A key measured from the attach piece says so, which is what a dropped
   *  passenger needs: it leaves the transport where the transport held it. */
  it("reports which origin a key is measured from", () => {
    const dropped = track({
      keys: [
        { frame: 0, pos: [0, 0, 0], fromAttachPiece: true },
        { frame: 10, pos: [0, -1, -1], fromAttachPiece: true },
      ],
    });
    expect(standInAt(dropped, 5, 8)?.fromAttachPiece).toBe(true);
    expect(standInAt(track(), 15, 8)?.fromAttachPiece).toBe(false);
  });
});

describe("attachedAt", () => {
  const riding: StandInTrack = {
    keys: [{ frame: 0, pos: [0, 0, 0] }],
    attach: {
      from: "QueryTransport",
      frame: 10,
      until: 20,
      follow: true,
    },
  };

  it("is nothing before the attach frame", () => {
    expect(attachedAt(riding, 9)).toBeNull();
  });

  it("is the attach from its own frame on", () => {
    expect(attachedAt(riding, 10)?.from).toBe("QueryTransport");
    expect(attachedAt(riding, 19)?.from).toBe("QueryTransport");
  });

  it("is nothing again once it detaches", () => {
    expect(attachedAt(riding, 20)).toBeNull();
  });

  it("never ends when nothing says it should", () => {
    const held: StandInTrack = {
      keys: [{ frame: 0, pos: [0, 0, 0] }],
      attach: {
        from: "QueryBuildInfo",
        frame: 0,
        until: null,
        follow: false,
      },
    };
    expect(attachedAt(held, 999)?.from).toBe("QueryBuildInfo");
  });

  it("is nothing for a track with no attach", () => {
    expect(attachedAt(track(), 5)).toBeNull();
  });
});

describe("standInRadius", () => {
  /** A third of the unit's larger horizontal extent, so it reads as another
   *  unit rather than a speck or a wall. */
  it("is a third of the wider horizontal extent", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 60, sizeY: 20, sizeZ: 30 }),
    ).toBe(20);
  });

  it("uses z when the unit is longer than it is wide", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 30, sizeY: 20, sizeZ: 60 }),
    ).toBe(20);
  });

  it("never disappears for a unit with almost nothing in it", () => {
    expect(standInRadius({ mid: [0, 0, 0], sizeX: 0, sizeY: 0, sizeZ: 0 })).toBe(
      6,
    );
  });

  it("never grows into a wall beside a very large unit", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 600, sizeY: 100, sizeZ: 600 }),
    ).toBe(40);
  });
});
