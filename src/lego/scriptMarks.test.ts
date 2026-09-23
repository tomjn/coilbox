import { describe, expect, it } from "vitest";
import {
  describeOutput,
  explodeFlags,
  markLabel,
  markPercent,
  scrubberMarks,
  sfxName,
} from "./scriptMarks";
import type { ScriptOutput } from "./scriptPlayback";

describe("describeOutput", () => {
  it("names each kind the way the spec lists them", () => {
    expect(
      describeOutput({ frame: 0, kind: "sfx", piece: "flare", sfx: 1025 }),
    ).toBe("EmitSfx 1025 from flare (CEG 1)");
    expect(
      describeOutput({ frame: 0, kind: "explode", piece: "arm1", flags: 257 }),
    ).toBe("Explode arm1 (SHATTER | BITMAP1)");
    expect(describeOutput({ frame: 0, kind: "sound", name: "krogtaunt" })).toBe(
      "Sound krogtaunt",
    );
    expect(
      describeOutput({ frame: 0, kind: "attach", unit: 2, piece: "link" }),
    ).toBe("Attach stand-in to link");
    expect(
      describeOutput({ frame: 0, kind: "attach", unit: 2, piece: null }),
    ).toBe("Attach stand-in to the void");
    expect(describeOutput({ frame: 0, kind: "drop", unit: 2 })).toBe(
      "Drop stand-in",
    );
  });

  it("says a unit that is not the stand-in by its id", () => {
    expect(describeOutput({ frame: 0, kind: "drop", unit: 7 })).toBe(
      "Drop unit 7",
    );
  });

  it("says a sound a TA script played has no name", () => {
    expect(describeOutput({ frame: 0, kind: "sound", name: null })).toBe(
      "Sound, which a TA script does not name",
    );
  });
});

/** `rts/Sim/Units/Scripts/UnitScript.cpp:597-790`, in its order. */
describe("sfxName", () => {
  it("names the built-in effects exactly", () => {
    expect(sfxName(0)).toBe("VTOL");
    expect(sfxName(3)).toBe("wake");
    expect(sfxName(257)).toBe("white smoke");
  });

  it("takes the first range bit the engine checks", () => {
    expect(sfxName(16384 + 3)).toBe("global CEG 3");
    expect(sfxName(1024)).toBe("CEG 0");
    expect(sfxName(2048)).toBe("fires weapon 1");
    expect(sfxName(4096 + 1)).toBe("detonates weapon 2");
  });

  it("says when a number is none of them", () => {
    expect(sfxName(7)).toBe("not an effect the engine knows");
  });
});

describe("explodeFlags", () => {
  it("names every bit it knows and gives the rest as a number", () => {
    expect(explodeFlags(1 | 8 | 16384)).toBe("SHATTER | SMOKE | RECURSIVE");
    expect(explodeFlags(1 | 65536)).toBe("SHATTER | 65536");
    expect(explodeFlags(0)).toBe("no flags");
  });
});

describe("scrubberMarks", () => {
  const at = (frame: number): ScriptOutput => ({
    frame,
    kind: "drop",
    unit: 2,
  });

  it("makes one mark per frame when nothing is measured yet", () => {
    const marks = scrubberMarks([at(1), at(1), at(2)], 450, 0);
    expect(marks.map((m) => [m.frame, m.events.length])).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  /** 1000 frames across 50 pixels is 20 frames to a pixel. */
  it("merges frames that fall on the same pixel", () => {
    const marks = scrubberMarks([at(500), at(501), at(900)], 1000, 50);
    expect(marks.map((m) => [m.frame, m.events.length])).toEqual([
      [500, 2],
      [900, 1],
    ]);
  });

  it("places a mark along the scrubber as a percentage", () => {
    expect(markPercent(0, 451)).toBe(0);
    expect(markPercent(450, 451)).toBe(100);
    expect(markPercent(0, 1)).toBe(0);
  });

  it("labels a mark by its frame, counted from one, and what happened first", () => {
    expect(markLabel({ frame: 9, events: [at(9)] })).toBe(
      "Frame 10: Drop stand-in",
    );
    expect(markLabel({ frame: 9, events: [at(9), at(9), at(10)] })).toBe(
      "Frame 10: Drop stand-in, and 2 more",
    );
  });
});
