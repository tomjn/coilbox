import { describe, expect, it } from "vitest";
import {
  ARM_X,
  ARM_Z,
  action,
  FPS,
  HATCH_Y,
  piece,
  poseUnits,
  run,
  unit,
} from "./actionFixtures";
import goldens from "./actionGoldens.json";
import {
  actionPieces,
  actionProblems,
  actionTracks,
  bakeAction,
  emitActions,
  normaliseTracks,
  planAction,
  shortestTurn,
  unitBlends,
  withTracks,
} from "./actions";
import { buildLuaScript } from "./luaScript";
import {
  type LegoAction,
  type LegoActionTrack,
  type LegoProject,
  parseLegoProjectData,
} from "./model";

/** Everything `emitActions` writes for a unit, as one string. */
function written(project: LegoProject): string {
  const e = emitActions(project, (p) => p.name);
  return [
    ...e.signals,
    ...e.functions,
    ...Object.entries(e.hooks).flatMap(([hook, lines]) => [
      `[${hook}]`,
      ...(lines ?? []),
    ]),
    ...e.own,
  ].join("\n");
}

/** The unit with every action lowered to tracks. */
function lowered(project: LegoProject): LegoProject {
  return {
    ...project,
    actions: project.actions?.map((a) => withTracks(a, project)),
  };
}

function track(
  pieceId: string,
  kind: "turn" | "move",
  axis: 0 | 1 | 2,
  keys: [number, number][],
): LegoActionTrack {
  return {
    piece: pieceId,
    kind,
    axis,
    keys: keys.map(([frame, value]) => ({ frame, value })),
  };
}

/** An action of tracks. Poses are not needed, so the unit has none. */
function tracked(
  tracks: LegoActionTrack[],
  extra: Partial<LegoAction> = {},
): LegoProject {
  return unit({
    poses: undefined,
    actions: [action({ keys: [], tracks, ...extra })],
  });
}

describe("a pose key action written through tracks (#5394)", () => {
  for (const [name, project] of Object.entries(poseUnits())) {
    it(`${name} writes what main wrote, from poses and from tracks`, () => {
      const want = (goldens as Record<string, string>)[name];
      expect(written(project)).toBe(want);
      expect(written(lowered(project))).toBe(want);
    });
  }

  it("goes through the script builder the same way", () => {
    const project = poseUnits().blended;
    expect(buildLuaScript(lowered(project))).toBe(buildLuaScript(project));
  });
});

describe("actionTracks", () => {
  it("lowers each channel a pose moves to a key on every key's frame", () => {
    const tracks = actionTracks(action(), unit());
    expect(tracks).toEqual([
      track("arm", "turn", 0, [
        [30, 1],
        [90, -0.5],
      ]),
      track("arm", "turn", 2, [
        [30, 0],
        [90, 0.8],
      ]),
      track("hatch", "move", 1, [
        [30, 4],
        [90, 0],
      ]),
    ]);
  });

  it("counts the time of a key whose pose was deleted", () => {
    const keys = [
      { pose: "pose-a", seconds: 1 },
      { pose: "deleted", seconds: 1 },
      { pose: "pose-b", seconds: 1 },
    ];
    const tracks = actionTracks(action({ keys }), unit());
    expect(tracks[0].keys).toEqual([
      { frame: 30, value: 1 },
      { frame: 90, value: -0.5 },
    ]);
  });

  it("puts a key with no time of its own one frame after the key before it", () => {
    const keys = [
      { pose: "pose-a", seconds: 1 },
      { pose: "pose-b", seconds: 0 },
      { pose: "pose-a", seconds: 1 },
    ];
    const [armX] = actionTracks(action({ keys }), unit());
    expect(armX.keys.map((k) => k.frame)).toEqual([30, 31, 60]);
  });

  it("makes one pose of keys with no time on frame 0", () => {
    const keys = [
      { pose: "pose-a", seconds: 0 },
      { pose: "pose-b", seconds: 0 },
    ];
    const [armX] = actionTracks(action({ keys }), unit());
    expect(armX.keys).toEqual([{ frame: 0, value: -0.5 }]);
  });

  it("keeps a track of a piece the unit has since lost", () => {
    const pose = {
      id: "pose-a",
      name: "A",
      pieces: { gone: { turn: [1, 0, 0] as [number, number, number] } },
    };
    const project = unit({ poses: [pose] });
    const a = action({ keys: [{ pose: "pose-a", seconds: 1 }] });
    expect(actionTracks(a, project).map((t) => t.piece)).toEqual(["gone"]);
  });

  it("is what withTracks puts on the action, and leaves tracks as they are", () => {
    const a = withTracks(action(), unit());
    expect(a.keys).toEqual([]);
    expect(a.tracks).toEqual(actionTracks(action(), unit()));
    expect(withTracks(a, unit())).toBe(a);
  });
});

describe("planAction", () => {
  // Arm turns on x to -0.5 at frame 10 and back at frame 20. The hatch moves
  // on y to 3 at frame 15 and back at frame 30.
  const wave = tracked(
    [
      track("arm", "turn", 0, [
        [10, -0.5],
        [20, 0],
      ]),
      track("hatch", "move", 1, [
        [15, 3],
        [30, 0],
      ]),
    ],
    { loop: false, trigger: "Shot1" },
  );

  it("starts each channel's first key from rest on frame 0 and sleeps between calls", () => {
    const lines = emitActions(wave, (p) => p.name).functions;
    expect(lines.slice(0, 11)).toEqual([
      "-- Action: Plant",
      "local function action_Plant()",
      "  SetSignalMask(SIG_ACTION_PLANT)",
      "  Turn(arm, x_axis, -0.5, 1.5)",
      "  Move(hatch, y_axis, 3, 6)",
      "  Sleep(330)",
      "  Turn(arm, x_axis, 0, 1.5)",
      "  Sleep(165)",
      "  Move(hatch, y_axis, 0, 6)",
      "end",
      "",
    ]);
  });

  it("writes nothing for an action that moves no piece the unit has", () => {
    const project = tracked([track("gone", "turn", 0, [[10, 1]])]);
    expect(planAction(project.actions?.[0] as LegoAction, project)).toBeNull();
    expect(written(project)).toBe("");
  });

  it("skips the tracks of a deleted piece and counts them", () => {
    const project = tracked(
      [
        track("arm", "turn", 0, [[10, 1]]),
        track("gone", "turn", 0, [[10, 1]]),
        track("gone", "move", 0, [[10, 1]]),
      ],
      { loop: false },
    );
    expect(written(project)).not.toContain("gone");
    const messages = actionProblems(project).map((p) => p.message);
    expect(messages).toEqual([
      "Plant: 2 tracks name pieces that no longer exist, so they are skipped.",
    ]);
    expect(project.actions?.[0].tracks).toHaveLength(3);
  });

  it("calls a key on frame 0 with no speed, then sets off for the next", () => {
    const project = tracked(
      [
        track("arm", "turn", 0, [
          [0, 1],
          [30, -0.5],
        ]),
      ],
      { loop: false },
    );
    const lines = emitActions(project, (p) => p.name).functions;
    expect(lines).toContain("  Turn(arm, x_axis, 1)");
    expect(lines).toContain("  Turn(arm, x_axis, -0.5, 1.5)");
    expect(lines).not.toContain("  Sleep(0)");
  });

  it("wraps a looping channel from its last key to its first", () => {
    const project = tracked([
      track("arm", "turn", 0, [
        [10, 1],
        [40, -1],
      ]),
      track("hatch", "move", 1, [
        [20, 4],
        [30, 0],
      ]),
    ]);
    const plan = planAction(project.actions?.[0] as LegoAction, project);
    expect(plan).not.toBeNull();
    expect(plan?.looping).toBe(true);
    // The lap is as long as the last key of any channel.
    expect(plan?.lapFrames).toBe(40);
    expect(plan?.leadFrames).toBe(40);
    // Arm: wrap from -1 at 40 to 1 at 50, which is 10 frames after the first key.
    const wrap = plan?.lap.find((c) => c.piece === "arm" && c.frame === 0);
    expect(wrap).toMatchObject({ dest: 1 });
    expect(wrap?.speed).toBeCloseTo(2 / (10 / FPS), 4);
    // Hatch: wrap from 0 at 30 to 4 at 60, which is 30 frames.
    const hatch = plan?.lap.find((c) => c.piece === "hatch" && c.frame === 30);
    expect(hatch?.speed).toBeCloseTo(4 / (30 / FPS), 4);
  });

  it("has a one key action go to its key from rest and stop", () => {
    const project = tracked([track("arm", "turn", 0, [[30, 1]])], {
      loop: false,
    });
    const lines = emitActions(project, (p) => p.name).functions;
    expect(lines).toContain("  Turn(arm, x_axis, 1, 1)");
    expect(lines.some((l) => l.includes("Sleep"))).toBe(false);
  });

  it("blends every channel to its value on the first key frame, then goes on", () => {
    const project = tracked(
      [
        track("arm", "turn", 0, [
          [10, -0.5],
          [20, 0],
        ]),
        track("hatch", "move", 1, [
          [15, 3],
          [30, 0],
        ]),
      ],
      { loop: false, trigger: "Shot1", blendIn: 0.5 },
    );
    const lines = emitActions(project, (p) => p.name).functions;
    const body = lines.slice(lines.indexOf("local function action_Plant()"));
    expect(body.slice(0, 11)).toEqual([
      "local function action_Plant()",
      "  SetSignalMask(SIG_ACTION_PLANT)",
      "  BlendTurn(arm, x_axis, -0.5, 0.5)",
      // The hatch is two thirds of the way from rest to 3 on frame 10.
      "  BlendMove(hatch, y_axis, 2, 0.5)",
      "  Sleep(495)",
      "  ActTurn(arm, x_axis, 0, 1.5)",
      "  ActMove(hatch, y_axis, 3, 6)",
      "  Sleep(165)",
      "  ActMove(hatch, y_axis, 0, 6)",
      "end",
      "",
    ]);
  });
});

describe("a plan against the framework under luajit", () => {
  const WATCH = [ARM_X, ARM_Z, HATCH_Y];

  /** Each fixture's piece values on every frame, from the script and from the
   *  bake, to four places. */
  function matches(project: LegoProject, callin: string) {
    const a = project.actions?.[0] as LegoAction;
    const timeline = bakeAction(a, project);
    expect(timeline.frames.length).toBeGreaterThan(0);
    const lua = buildLuaScript(project);
    const rows = run(
      lua,
      [{ frame: 0, callin }],
      timeline.frames.length + 2 * FPS,
      WATCH,
    );
    const index = (id: string) => project.pieces.findIndex((p) => p.id === id);
    const at = (frame: number) => [
      timeline.frames[frame][index("arm") * 6 + 3],
      timeline.frames[frame][index("arm") * 6 + 5],
      timeline.frames[frame][index("hatch") * 6 + 1],
    ];
    timeline.frames.forEach((_, frame) => {
      at(frame).forEach((got, i) => {
        expect(got, `frame ${frame} of ${WATCH[i].piece}`).toBeCloseTo(
          rows[frame][i],
          4,
        );
      });
    });
    // A one shot action stays where it ended.
    if (!a.loop) {
      const last = rows[timeline.frames.length - 1];
      for (const row of rows.slice(timeline.frames.length)) {
        row.forEach((value, i) => {
          expect(value).toBeCloseTo(last[i], 4);
        });
      }
    }
    return { timeline, rows };
  }

  const staggered = tracked(
    [
      track("arm", "turn", 0, [
        [10, -0.5],
        [20, 0],
      ]),
      track("hatch", "move", 1, [
        [15, 3],
        [30, 0],
      ]),
    ],
    { loop: false, trigger: "Shot1" },
  );
  const loopOffsets = tracked([
    track("arm", "turn", 0, [
      [10, 1],
      [40, -1],
    ]),
    track("arm", "turn", 2, [
      [20, 0.5],
      [50, 0],
    ]),
    track("hatch", "move", 1, [
      [5, 4],
      [30, 0],
    ]),
  ]);
  const frameZero = tracked([
    track("arm", "turn", 0, [
      [0, 1],
      [30, -0.5],
      [45, 0.25],
    ]),
    track("hatch", "move", 1, [
      [0, 2],
      [45, 0],
    ]),
  ]);

  it("writes the same script from the normalised tracks", () => {
    for (const project of [staggered, loopOffsets, frameZero]) {
      const a = project.actions?.[0] as LegoAction;
      const norm = {
        ...project,
        actions: [{ ...a, tracks: normaliseTracks(a.tracks ?? [], a.loop) }],
      };
      expect(written(norm)).toBe(written(project));
    }
  });

  it("matches for staggered channels", () => {
    const { rows } = matches(staggered, "Shot1");
    // The arm has had ten frames of movement, and so is at -0.5, after frame 9.
    expect(rows[9][0]).toBeCloseTo(-0.5, 3);
  });

  it("matches for a loop whose channels start and end on different frames", () => {
    const { timeline } = matches(loopOffsets, "StartMoving");
    // The lead and one lap of 50 frames.
    expect(timeline.frames).toHaveLength(100);
  });

  it("matches for a key on frame 0", () => {
    const { rows } = matches(frameZero, "StartMoving");
    expect(rows[0][0]).toBeGreaterThan(0.9);
  });

  it("matches for a one key action", () => {
    const one = tracked([track("arm", "turn", 0, [[30, 1]])], {
      loop: false,
      trigger: "Shot1",
    });
    const { timeline } = matches(one, "Shot1");
    expect(timeline.frames).toHaveLength(30);
  });

  it("matches for a blended action and a blended loop", () => {
    const oneShot = {
      ...staggered,
      actions: [{ ...(staggered.actions?.[0] as LegoAction), blendIn: 0.5 }],
    };
    matches(oneShot, "Shot1");
    const looped = {
      ...loopOffsets,
      actions: [{ ...(loopOffsets.actions?.[0] as LegoAction), blendIn: 0.4 }],
    };
    matches(looped, "StartMoving");
    expect(unitBlends(looped)).toBe(true);
  });

  it("matches for pose key actions lowered to tracks", () => {
    matches(unit(), "StartMoving");
    matches(lowered(unit()), "StartMoving");
    matches(poseUnits().blendedIn, "StartMoving");
  });
});

describe("a turn of half a circle or more", () => {
  const over = tracked(
    [
      track("arm", "turn", 0, [
        [0, 0],
        [30, 4],
      ]),
    ],
    { loop: false },
  );

  it("takes the shorter way round as the engine does", () => {
    // Over half a circle goes the negative way, so the arm heads below zero.
    const timeline = bakeAction(over.actions?.[0] as LegoAction, over);
    const arm = over.pieces.findIndex((p) => p.id === "arm") * 6 + 3;
    expect(timeline.frames[5][arm]).toBeLessThan(0);
    // And it arrives where it was told to, a turn round.
    expect(timeline.frames.at(-1)?.[arm]).toBeCloseTo(4, 6);
  });

  it("goes the negative way for exactly half a circle, from either side", () => {
    expect(shortestTurn(Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(shortestTurn(-Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(shortestTurn(Math.PI - 0.01)).toBeGreaterThan(0);
  });

  it("is raised in the problems, with the action, piece, axis and frames", () => {
    expect(actionProblems(over).map((p) => p.message)).toEqual([
      "Plant: arm turns on x by half a circle or more between frames 0 and 30, so the engine takes the shorter way round. Add a key between them.",
    ]);
  });

  it("is raised at half a circle, and not just under it", () => {
    const half = tracked([track("arm", "turn", 2, [[30, 3.1416]])], {
      loop: false,
    });
    expect(actionProblems(half)).toHaveLength(1);
    const under = tracked([track("arm", "turn", 2, [[30, 3.1415]])], {
      loop: false,
    });
    expect(actionProblems(under)).toEqual([]);
  });

  it("is raised for the wrap of a loop and for a move of any size", () => {
    const wrap = tracked([
      track("arm", "turn", 0, [
        [10, 0],
        [20, 2],
        [40, 0.1],
      ]),
    ]);
    // 0 to 2 and 2 to 0.1 are under half a circle. 0.1 back to 0 is too.
    expect(actionProblems(wrap)).toEqual([]);
    const big = tracked([track("hatch", "move", 1, [[30, 40]])], {
      loop: false,
    });
    expect(actionProblems(big)).toEqual([]);
    const lap = tracked([
      track("arm", "turn", 0, [
        [10, -2],
        [20, 2],
      ]),
    ]);
    // 4 radians between the keys, and again from the last key round to the first.
    expect(actionProblems(lap)).toHaveLength(2);
  });

  it("still writes the script, as the engine will play it", () => {
    const lines = emitActions(over, (p) => p.name).functions;
    expect(lines).toContain("  Turn(arm, x_axis, 4, 4)");
  });
});

describe("normaliseTracks", () => {
  it("drops a repeat of the previous value at the end of a one shot action", () => {
    const tracks = [
      track("arm", "turn", 0, [
        [10, 1],
        [20, 0],
        [30, 0],
      ]),
    ];
    expect(normaliseTracks(tracks)).toEqual([
      track("arm", "turn", 0, [
        [10, 1],
        [20, 0],
      ]),
    ]);
  });

  it("keeps the key where a change starts and the key where it ends", () => {
    const tracks = [
      track("arm", "turn", 0, [
        [0, 0],
        [10, 5],
        [20, 5],
        [30, 5],
        [40, 0],
      ]),
    ];
    expect(normaliseTracks(tracks)[0].keys.map((k) => k.frame)).toEqual([
      0, 10, 30, 40,
    ]);
    // Without the key on the action's first frame, which stays, 20 goes too.
    const later = [
      track("arm", "turn", 0, [
        [10, 5],
        [20, 5],
        [30, 5],
        [40, 0],
      ]),
    ];
    expect(normaliseTracks(later)[0].keys.map((k) => k.frame)).toEqual([
      10, 30, 40,
    ]);
  });

  it("drops a first key that keeps the rest position, and tracks left empty", () => {
    expect(
      normaliseTracks([
        track("arm", "turn", 0, [[20, 0]]),
        track("arm", "turn", 1, [
          [10, 0],
          [20, 1],
        ]),
      ]),
    ).toEqual([
      track("arm", "turn", 1, [
        [10, 0],
        [20, 1],
      ]),
    ]);
  });

  it("keeps a key on the last frame of a loop, which is the lap's length", () => {
    const tracks = [
      track("arm", "turn", 0, [
        [10, 1],
        [20, 1],
        [40, 1],
      ]),
      track("hatch", "move", 1, [[40, 0]]),
    ];
    const frames = normaliseTracks(tracks, true).flatMap((t) =>
      t.keys.map((k) => k.frame),
    );
    expect(frames).toContain(40);
    expect(
      normaliseTracks(tracks).flatMap((t) => t.keys.map((k) => k.frame)),
    ).not.toContain(40);
  });

  it("does not change the script it comes from", () => {
    const project = tracked(
      [
        track("arm", "turn", 0, [
          [10, 1],
          [20, 0],
          [30, 0],
        ]),
        track("hatch", "move", 1, [[15, 0]]),
      ],
      { loop: false },
    );
    const a = project.actions?.[0] as LegoAction;
    const norm = {
      ...project,
      actions: [{ ...a, tracks: normaliseTracks(a.tracks ?? []) }],
    };
    expect(written(norm)).toBe(written(project));
  });
});

describe("tracks in the rest of the action code", () => {
  const project = tracked([track("arm", "turn", 0, [[10, 1]])], {
    loop: false,
  });

  it("names the pieces a track moves", () => {
    const a = project.actions?.[0] as LegoAction;
    expect(actionPieces(a, project).map((p) => p.id)).toEqual(["arm"]);
  });

  it("clashes with another action on the same piece", () => {
    const other = action({ id: "o", name: "Wave", trigger: "Activate" });
    const both = {
      ...project,
      poses: unit().poses,
      actions: [...(project.actions ?? []), other],
    };
    expect(
      actionProblems(both).some((p) => p.message.includes("both move")),
    ).toBe(true);
  });

  it("asks a looping action for two key frames", () => {
    const one = tracked([track("arm", "turn", 0, [[10, 1]])]);
    expect(actionProblems(one).map((p) => p.message)).toEqual([
      "Plant: a looping action needs two keys to loop.",
    ]);
  });

  it("makes a unit blend when a track action does", () => {
    const blends = tracked([track("arm", "turn", 0, [[10, 1]])], {
      blendOut: 0.5,
    });
    expect(unitBlends(blends)).toBe(true);
    expect(unitBlends(project)).toBe(false);
  });
});

describe("tracks in a saved unit", () => {
  const load = (tracks: unknown, extra: Record<string, unknown> = {}) =>
    parseLegoProjectData(
      JSON.parse(
        JSON.stringify({
          ...unit(),
          actions: [
            {
              id: "t",
              name: "Tracked",
              trigger: "StartMoving",
              loop: true,
              keys: [],
              tracks,
              ...extra,
            },
          ],
        }),
      ),
    );

  it("keeps valid tracks and writes them back as they were", () => {
    const tracks = [
      track("arm", "turn", 0, [
        [0, 1],
        [30, -0.5],
      ]),
      track("hatch", "move", 1, [[15, 4]]),
    ];
    const loaded = load(tracks);
    expect(loaded?.actions?.[0].tracks).toEqual(tracks);
    expect(loaded?.actions?.[0].keys).toEqual([]);
  });

  it("drops a bad key, and a bad track, but not the action", () => {
    const loaded = load([
      {
        piece: "arm",
        kind: "turn",
        axis: 0,
        keys: [
          { frame: 10, value: 1 },
          { frame: 10, value: 2 },
          { frame: 1.5, value: 1 },
          { frame: -1, value: 1 },
          { frame: 5, value: Number.NaN },
          { frame: "7", value: 1 },
          { frame: 2, value: 0.5 },
        ],
      },
      { piece: "arm", kind: "turn", axis: 3, keys: [{ frame: 1, value: 1 }] },
      { piece: "arm", kind: "spin", axis: 0, keys: [{ frame: 1, value: 1 }] },
      { piece: "", kind: "turn", axis: 0, keys: [{ frame: 1, value: 1 }] },
      { piece: "arm", kind: "move", axis: 0, keys: [] },
      { piece: "arm", kind: "move", axis: 1 },
      track("arm", "turn", 0, [[4, 4]]),
      null,
    ]);
    expect(loaded?.actions?.map((a) => a.id)).toEqual(["t"]);
    expect(loaded?.actions?.[0].tracks).toEqual([
      track("arm", "turn", 0, [
        [2, 0.5],
        [10, 1],
      ]),
    ]);
  });

  it("reads an action whose tracks are all bad as one with none", () => {
    const loaded = load([{ piece: "arm", kind: "turn", axis: 9, keys: [] }], {
      keys: [{ pose: "pose-a", seconds: 1 }],
    });
    expect(loaded?.actions?.[0]).not.toHaveProperty("tracks");
    expect(loaded?.actions?.[0].keys).toHaveLength(1);
  });

  it("does not change a unit saved before tracks", () => {
    const before = unit();
    const loaded = parseLegoProjectData(JSON.parse(JSON.stringify(before)));
    expect(loaded?.actions).toEqual(before.actions);
    expect(loaded?.actions?.[0]).not.toHaveProperty("tracks");
    expect(loaded && written(loaded)).toBe(written(before));
  });
});

describe("pieces", () => {
  it("are in the unit's order whatever order the tracks are in", () => {
    const project = tracked([
      track("hatch", "move", 1, [[10, 1]]),
      track("arm", "turn", 0, [[10, 1]]),
    ]);
    const a = project.actions?.[0] as LegoAction;
    expect(planAction(a, project)?.pieces.map((p) => p.id)).toEqual([
      "arm",
      "hatch",
    ]);
    const lines = emitActions(project, (p) => p.name).functions;
    expect(lines.indexOf("  Turn(arm, x_axis, 1, 3)")).toBeLessThan(
      lines.indexOf("  Move(hatch, y_axis, 1, 3)"),
    );
    expect(piece("x", "x").id).toBe("x");
  });
});
