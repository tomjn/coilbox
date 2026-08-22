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

import { beforeEach, describe, expect, it, vi } from "vitest";

import { inferRoles } from "./inferRoles";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { ScriptProbes, ScriptTimeline } from "./scriptPlayback";

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

  /**
   * Which of six moving pieces is the front left shin is not something motion
   * reveals, and the walk presets animate a unit inside out if it is guessed
   * wrong. So a walker's legs come back as nothing rather than as a guess.
   */
  it("never proposes a leg, however much the legs move", async () => {
    runScript.mockResolvedValue(
      turned([
        { piece: "base", axis: 0 },
        { piece: "turret", axis: 2 },
        { piece: "barrel", axis: 2 },
      ]),
    );

    const found = await inferRoles(project(), "-- script");

    expect(found.proposals.map((p) => p.role)).not.toContain("leg.l1.thigh");
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
