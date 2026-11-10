/**
 * What a script's own answers are allowed to become.
 *
 * The runtime is covered in Rust (`unitscript_tests.rs`). This is the layer
 * above it: which call-in means which role, how a stated answer outranks an
 * observed one, and what happens when a script says nothing useful.
 *
 * The bindings are mocked rather than run, because what is being tested is the
 * reading of the answers, not the sandbox that produces them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyRoles } from "./adoptGameScript";
import { BIPED, planProportions, QUADRUPED } from "./bodyPlans";
import { planBones, suggestPicks } from "./fitPlan";
import { inferRoles } from "./inferRoles";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import {
  CREATED,
  type ScriptEvent,
  type ScriptProbes,
  type ScriptTimeline,
} from "./scriptPlayback";

const probeScript = vi.fn();
const runScript = vi.fn();

vi.mock("./bindings", () => ({
  legoProbeScript: (args: unknown) => probeScript(args),
  legoRunScript: (args: unknown) => runScript(args),
}));

const NAMES = ["base", "turret", "barrel", "wheel1", "nano1", "nano2"];

function project(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "commander",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-22T00:00:00Z",
  });
  const pieces: LegoPiece[] = NAMES.map((name, i) => ({
    id: `p${i}`,
    name,
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }));
  return { ...base, pieces };
}

/** A probe result naming pieces for a call-in, and nothing for the rest. */
function probes(named: Record<string, string[]>): ScriptProbes {
  return {
    pieces: NAMES,
    error: null,
    functions: [],
    probes: Object.entries(named).map(([callin, pieces]) => ({
      callin,
      pieces,
      note:
        pieces.length === 0 ? `This script has no ${callin} call-in.` : null,
    })),
  };
}

/**
 * A timeline where the named pieces have turned about the named axis by the
 * last frame. Two frames is enough: the reading is first against last.
 */
function turned(turns: { piece: string; axis: 0 | 1 | 2 }[]): ScriptTimeline {
  const width = NAMES.length * 6;
  const first = new Array(width).fill(0);
  const last = new Array(width).fill(0);
  for (const { piece, axis } of turns) {
    last[NAMES.indexOf(piece) * 6 + 3 + axis] = 0.8;
  }
  return {
    fps: 30,
    pieces: NAMES,
    frames: [first, last],
    hidden: [],
    error: null,
    warnings: [],
    asked: [],
    functions: [],
    linesRun: [],
    offsetsRun: [],
    events: [],
  };
}

/** Nothing moved, which is what most drivers do on most units. */
const STILL = turned([]);

beforeEach(() => {
  probeScript.mockReset();
  runScript.mockReset();
  probeScript.mockResolvedValue(probes({}));
  runScript.mockResolvedValue(STILL);
});

describe("what a script states outright", () => {
  it("takes every nano piece a builder cycles through", async () => {
    probeScript.mockResolvedValue(
      probes({ QueryNanoPiece: ["nano1", "nano2", "nano1", "nano2"] }),
    );

    const found = await inferRoles(project(), "-- script");

    expect(found.proposals).toEqual([
      {
        pieceName: "nano1",
        role: "buildarm.nano",
        evidence: "stated",
        callin: "QueryNanoPiece",
      },
      {
        pieceName: "nano2",
        role: "buildarm.nano",
        evidence: "stated",
        callin: "QueryNanoPiece",
      },
    ]);
  });

  it("reads the aim point and the muzzle flare off their own call-ins", async () => {
    probeScript.mockResolvedValue(
      probes({ AimFromWeapon1: ["turret"], QueryWeapon1: ["barrel"] }),
    );

    const found = await inferRoles(project(), "-- script");

    expect(found.proposals).toContainEqual({
      pieceName: "turret",
      role: "aim",
      evidence: "stated",
      callin: "AimFromWeapon1",
    });
    expect(found.proposals).toContainEqual({
      pieceName: "barrel",
      role: "flare",
      evidence: "stated",
      callin: "QueryWeapon1",
    });
  });
});

describe("what a script only shows by moving", () => {
  it("calls a piece that turns on y when told to aim a turret", async () => {
    runScript.mockImplementation(
      ({ events }: { events: { callin: string }[] }) =>
        events.some((e) => e.callin === "AimWeapon1")
          ? turned([{ piece: "turret", axis: 1 }])
          : STILL,
    );

    const found = await inferRoles(project(), "-- script");

    expect(found.proposals).toEqual([
      {
        pieceName: "turret",
        role: "turret",
        evidence: "observed",
        callin: "AimWeapon1",
      },
    ]);
  });

  it("calls a piece that turns on x when told to aim a barrel", async () => {
    runScript.mockImplementation(
      ({ events }: { events: { callin: string }[] }) =>
        events.some((e) => e.callin === "AimWeapon1")
          ? turned([{ piece: "barrel", axis: 0 }])
          : STILL,
    );

    const found = await inferRoles(project(), "-- script");

    expect(found.proposals[0]?.role).toBe("barrel");
  });

  it("calls a piece that turns on being told to move a wheel", async () => {
    runScript.mockImplementation(
      ({ events }: { events: { callin: string }[] }) =>
        events.some((e) => e.callin === "StartMoving")
          ? turned([{ piece: "wheel1", axis: 0 }])
          : STILL,
    );

    const found = await inferRoles(project(), "-- script");

    expect(found.proposals).toEqual([
      {
        pieceName: "wheel1",
        role: "wheel",
        evidence: "observed",
        callin: "StartMoving",
      },
    ]);
  });

  it("ignores a piece that barely moved, which is arithmetic rather than intent", async () => {
    const barely = turned([]);
    barely.frames[1][NAMES.indexOf("turret") * 6 + 4] = 0.001;
    runScript.mockResolvedValue(barely);

    const found = await inferRoles(project(), "-- script");

    expect(found.proposals).toEqual([]);
  });
});

describe("when the two kinds disagree", () => {
  /** The script naming a piece's job beats us watching it move. */
  it("keeps the stated answer over the observed one for the same piece", async () => {
    probeScript.mockResolvedValue(probes({ AimFromWeapon1: ["turret"] }));
    runScript.mockResolvedValue(turned([{ piece: "turret", axis: 1 }]));

    const found = await inferRoles(project(), "-- script");

    const turretProposals = found.proposals.filter(
      (p) => p.pieceName === "turret",
    );
    expect(turretProposals).toHaveLength(1);
    expect(turretProposals[0]).toMatchObject({
      role: "aim",
      evidence: "stated",
    });
  });
});

describe("when a script says nothing useful", () => {
  it("proposes nothing rather than failing", async () => {
    const found = await inferRoles(project(), "-- script");

    expect(found.proposals).toEqual([]);
    expect(found.error).toBeNull();
  });

  /** A script that will not load is a different thing from one that loads and
   *  answers nothing, and there is nothing to weigh in the first case. */
  it("reports a script that could not be loaded at all", async () => {
    probeScript.mockResolvedValue({
      pieces: NAMES,
      probes: [],
      error: "test.lua:1: unexpected symbol",
    });

    const found = await inferRoles(project(), "not lua");

    expect(found.error).toBe("test.lua:1: unexpected symbol");
    expect(found.proposals).toEqual([]);
  });

  /**
   * The sandbox reports calls it does not model rather than faking them, so a
   * script leaning on engine state coilbox has no answer for infers less. That
   * is the intended failure direction and the notes are how it says so.
   */
  it("passes on what the runs wanted to say, without repeating itself", async () => {
    runScript.mockResolvedValue({
      ...STILL,
      warnings: ["GetUnitValue is not modelled here."],
    });

    const found = await inferRoles(project(), "-- script");

    expect(found.notes).toEqual(["GetUnitValue is not modelled here."]);
  });

  /** A run that broke still moved pieces before it broke, and that motion is
   *  worth reading rather than discarding. */
  it("reads the motion of a run that failed part way, and says it failed", async () => {
    runScript.mockResolvedValue({
      ...turned([{ piece: "turret", axis: 1 }]),
      error: "test.lua:9: attempt to index a nil value",
    });

    const found = await inferRoles(project(), "-- script");

    expect(found.proposals[0]?.role).toBe("turret");
    expect(found.notes.join(" ")).toContain("nil value");
  });
});

/**
 * Real strides, recorded by running each script through the sandbox in
 * `crates/coilbox-springlua/tests/strides.rs`, which checks the recording
 * against the runtime. Splinter Faction's scripts stay in the game: what is
 * here is each model's piece tree and the numbers the run produced.
 *
 * Splinter Faction ships no four legged walker, so the four legged case is the
 * builder's own quadruped walk, `fixtures/walkQuadUnfitted.lua`, on the
 * quadruped plan's pieces.
 */
interface StrideCase {
  name: string;
  pieces: { name: string; parent: string | null; offset: number[] }[];
  events: ScriptEvent[];
  frames: number;
  timeline: { frames: number[][]; error: string | null; warnings: string[] };
}

const STRIDES: StrideCase[] = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "../../crates/coilbox-springlua/tests/fixtures/strides.json",
    ),
    "utf8",
  ),
).cases;

function stride(name: string): StrideCase {
  const found = STRIDES.find((entry) => entry.name === name);
  if (!found) throw new Error(`no recorded stride for ${name}`);
  return found;
}

/** A project shaped like a model's piece tree, by piece name. */
function tree(
  pieces: { name: string; parent: string | null; offset: number[] }[],
): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: pieces[0]?.name ?? "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-11-09T00:00:00Z",
  });
  return {
    ...base,
    pieces: pieces.map(({ name, parent, offset }) => ({
      id: name,
      name,
      parentId: parent,
      partId: null,
      position: offset as [number, number, number],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })),
  };
}

/** Answer the stride with the recording and every other run with stillness,
 *  checking the stride is asked for exactly as it was recorded. */
function answerWith(recorded: StrideCase) {
  const names = recorded.pieces.map((piece) => piece.name);
  const still = new Array(names.length * 6).fill(0);
  runScript.mockImplementation(
    ({
      events,
      frames,
      pieces,
    }: {
      events: ScriptEvent[];
      frames: number;
      pieces: string[];
    }) => {
      expect(pieces).toEqual(names);
      const base = { ...STILL, pieces: names, frames: [still, still] };
      if (!events.some((event) => event.callin === "StartMoving")) return base;
      expect(events).toEqual(recorded.events);
      expect(frames).toBe(recorded.frames);
      return { ...base, ...recorded.timeline };
    },
  );
  return tree(recorded.pieces);
}

const roleOf = (
  found: Awaited<ReturnType<typeof inferRoles>>,
  pieceName: string,
) => found.proposals.find((p) => p.pieceName === pieceName)?.role;

describe("a walker's legs, read off its stride", () => {
  it("records each stride with the events every observation sends", () => {
    for (const recorded of STRIDES) {
      expect(recorded.events).toEqual([
        ...CREATED,
        { frame: 1, callin: "StartMoving", args: [] },
      ]);
      expect(recorded.timeline.error).toBeNull();
    }
  });

  /** fedbear: pelvis, then a still `legs` piece with a thigh, shin and foot on
   *  each side. The pelvis rocks and the turret bobs as it walks. */
  it("finds Splinter Faction's Bear's two legs, left on +x", async () => {
    const found = await inferRoles(answerWith(stride("fedbear")), "-- bear");

    expect(found.legs).toEqual([
      {
        side: "l",
        pair: 1,
        chain: { thigh: "lthigh", shin: "lleg", foot: "lfoot" },
        hangsFrom: "legs",
        position: [
          expect.closeTo(15.2402),
          expect.closeTo(22.845),
          expect.closeTo(-0.008),
        ],
      },
      {
        side: "r",
        pair: 1,
        chain: { thigh: "rthigh", shin: "rleg", foot: "rfoot" },
        hangsFrom: "legs",
        position: [
          expect.closeTo(-15.2402),
          expect.closeTo(22.845),
          expect.closeTo(-0.008),
        ],
      },
    ]);
    expect(found.proposals.filter((p) => p.role.startsWith("leg."))).toEqual(
      [
        ["lthigh", "leg.l1.thigh"],
        ["lleg", "leg.l1.shin"],
        ["lfoot", "leg.l1.foot"],
        ["rthigh", "leg.r1.thigh"],
        ["rleg", "leg.r1.shin"],
        ["rfoot", "leg.r1.foot"],
      ].map(([pieceName, role]) => ({
        pieceName,
        role,
        evidence: "observed",
        callin: "StartMoving",
      })),
    );
  });

  it("calls nothing on a walker a wheel, however its body rocks", async () => {
    const found = await inferRoles(answerWith(stride("fedbear")), "-- bear");

    expect(found.proposals.map((p) => p.role)).not.toContain("wheel");
    expect(roleOf(found, "pelvis")).toBeUndefined();
    expect(roleOf(found, "turret")).toBeUndefined();
    expect(found.notes).toEqual([]);
  });

  it("orders a four legged walker's legs front to back on each side", async () => {
    const found = await inferRoles(answerWith(stride("quad")), "-- quad");

    expect(
      found.legs.map((leg) => [leg.side, leg.pair, leg.chain.thigh]),
    ).toEqual([
      ["l", 1, "lthighf"],
      ["l", 2, "lthighb"],
      ["r", 1, "rthighf"],
      ["r", 2, "rthighb"],
    ]);
    expect(roleOf(found, "lfootb")).toBe("leg.l2.foot");
    expect(roleOf(found, "rshinf")).toBe("leg.r1.shin");
    expect(found.legs.every((leg) => leg.hangsFrom === "body")).toBe(true);
  });

  /** The quad recording is the plan's own pieces, so a change to the plan
   *  shows up here rather than as a quietly stale fixture. */
  it("records the quadruped on the plan's own pieces", () => {
    const bones = QUADRUPED.bones(planProportions(QUADRUPED, {}));
    expect(stride("quad").pieces).toEqual(
      bones.map((bone) => ({
        name: bone.name,
        parent: bones.find((b) => b.id === bone.parent)?.name ?? null,
        // The Rust side reads and writes the file, and its float parsing
        // is not exact in the last bit.
        offset: bone.position.map((value) => expect.closeTo(value, 6)),
      })),
    );
  });

  it("proposes no legs for Splinter Faction's wheeled Flashpoint, only wheels", async () => {
    const found = await inferRoles(
      answerWith(stride("lozflashpoint")),
      "-- flashpoint",
    );

    expect(found.legs).toEqual([]);
    expect(found.proposals).toEqual([
      {
        pieceName: "frontwheels",
        role: "wheel",
        evidence: "observed",
        callin: "StartMoving",
      },
      {
        pieceName: "rearwheels",
        role: "wheel",
        evidence: "observed",
        callin: "StartMoving",
      },
    ]);
  });

  it("hands the fit drawer each leg bone once the proposals are taken", async () => {
    for (const [name, plan] of [
      ["fedbear", BIPED],
      ["quad", QUADRUPED],
    ] as const) {
      const project = answerWith(stride(name));
      const found = await inferRoles(project, "-- walker");
      const taken = applyRoles(project, found.proposals);
      const picks = suggestPicks(taken, planBones(plan, {}));

      for (const leg of found.legs) {
        const id = `${leg.side}${leg.pair}`;
        expect(picks[`thigh.${id}`]).toBe(leg.chain.thigh);
        expect(picks[`shin.${id}`]).toBe(leg.chain.shin);
        expect(picks[`foot.${id}`]).toBe(leg.chain.foot);
      }
    }
  });
});

describe("a stride that does not say which leg is which", () => {
  /** A still body with whatever hangs off it, every piece turning about x on
   *  the stride's last frame unless listed as sliding or swinging about z
   *  instead. */
  function walker(
    pieces: { name: string; parent: string; offset: number[] }[],
    slides: string[] = [],
    swings: string[] = [],
  ) {
    const all = [{ name: "body", parent: null, offset: [0, 20, 0] }, ...pieces];
    const names = all.map((piece) => piece.name);
    const last = new Array(names.length * 6).fill(0);
    for (const piece of pieces) {
      const at = names.indexOf(piece.name) * 6;
      if (slides.includes(piece.name)) last[at + 1] = 2;
      else if (swings.includes(piece.name)) last[at + 5] = 0.5;
      else last[at + 3] = 0.5;
    }
    runScript.mockImplementation(({ events }: { events: ScriptEvent[] }) => ({
      ...STILL,
      pieces: names,
      frames: [
        new Array(names.length * 6).fill(0),
        events.some((event) => event.callin === "StartMoving")
          ? last
          : new Array(names.length * 6).fill(0),
      ],
    }));
    return tree(all);
  }

  it("says a chain of two could be either thigh and foot or shin and foot", async () => {
    const found = await inferRoles(
      walker([
        { name: "lthigh", parent: "body", offset: [5, 0, 0] },
        { name: "lfoot", parent: "lthigh", offset: [0, -10, 0] },
      ]),
      "-- two",
    );

    expect(found.legs).toEqual([]);
    expect(found.proposals).toEqual([]);
    expect(found.notes.join(" ")).toContain(
      "lthigh, lfoot turn as a chain of two",
    );
  });

  it("calls nothing under a turning fork a wheel", async () => {
    const found = await inferRoles(
      walker([
        { name: "hip", parent: "body", offset: [5, 0, 0] },
        { name: "toe1", parent: "hip", offset: [1, -5, 0] },
        { name: "toe2", parent: "hip", offset: [-1, -5, 0] },
      ]),
      "-- fork",
    );

    expect(found.proposals).toEqual([]);
  });

  it("says a chain longer than thigh, shin and foot is not proposed", async () => {
    const found = await inferRoles(
      walker([
        { name: "a", parent: "body", offset: [5, 0, 0] },
        { name: "b", parent: "a", offset: [0, -5, 0] },
        { name: "c", parent: "b", offset: [0, -5, 0] },
        { name: "d", parent: "c", offset: [0, -5, 0] },
      ]),
      "-- four",
    );

    expect(found.proposals).toEqual([]);
    expect(found.notes.join(" ")).toContain("chain of 4");
  });

  it("says a leg that slides rather than turns is not a leg", async () => {
    const found = await inferRoles(
      walker(
        [{ name: "lpiston", parent: "body", offset: [5, 0, 0] }],
        ["lpiston"],
      ),
      "-- slides",
    );

    expect(found.proposals).toEqual([]);
    expect(found.notes.join(" ")).toContain("lpiston slides rather than turns");
  });

  it("says legs splayed out sideways turn about y or z, not as legs", async () => {
    const found = await inferRoles(
      walker(
        [
          { name: "rf1", parent: "body", offset: [-5, 0, 5] },
          { name: "rf2", parent: "rf1", offset: [-5, 0, 0] },
          { name: "spinner", parent: "body", offset: [3, 5, 0] },
        ],
        [],
        ["rf1", "rf2", "spinner"],
      ),
      "-- spider",
    );

    expect(found.proposals).toEqual([]);
    expect(found.stride).toEqual({
      notes: [
        "rf1, rf2 turn about y or z when the unit moves, and a leg swings about x, so they are not proposed as legs.",
      ],
      still: false,
    });
  });

  it("says when the script moves no piece as the unit moves", async () => {
    const found = await inferRoles(
      walker([{ name: "hull", parent: "body", offset: [0, 0, 0] }], [], []),
      "-- still",
    );
    expect(found.stride).toMatchObject({ still: false });

    runScript.mockImplementation(({ pieces }: { pieces: string[] }) => ({
      ...STILL,
      pieces,
      frames: [
        new Array(pieces.length * 6).fill(0),
        new Array(pieces.length * 6).fill(0),
      ],
    }));
    const still = await inferRoles(
      tree([
        { name: "body", parent: null, offset: [0, 20, 0] },
        { name: "hull", parent: "body", offset: [0, 0, 0] },
      ]),
      "-- still",
    );
    expect(still.stride).toEqual({ notes: [], still: true });
  });

  it("says a leg on the centre line has no side", async () => {
    const found = await inferRoles(
      walker([
        { name: "thigh", parent: "body", offset: [0, 0, 0] },
        { name: "shin", parent: "thigh", offset: [0, -5, 0] },
        { name: "foot", parent: "shin", offset: [0, -5, 0] },
      ]),
      "-- centre",
    );

    expect(found.proposals).toEqual([]);
    expect(found.notes.join(" ")).toContain("centre line");
  });

  it("says two legs on one side level front to back have no order", async () => {
    const leg = (prefix: string, y: number) => [
      { name: `${prefix}thigh`, parent: "body", offset: [5, y, 0] },
      { name: `${prefix}shin`, parent: `${prefix}thigh`, offset: [0, -5, 0] },
      { name: `${prefix}foot`, parent: `${prefix}shin`, offset: [0, -5, 0] },
    ];
    const found = await inferRoles(
      walker([...leg("a", 0), ...leg("b", 2)]),
      "-- level",
    );

    expect(found.proposals).toEqual([]);
    expect(found.notes.join(" ")).toContain("same distance front to back");
  });
});
