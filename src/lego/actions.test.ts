import { describe, expect, it } from "vitest";
import {
  ARM_X,
  ARM_Z,
  action,
  allowance,
  FPS,
  HATCH_Y,
  POSE_A,
  POSE_B,
  piece,
  run,
  unit,
} from "./actionFixtures";
import {
  actionClashes,
  actionProblems,
  addAction,
  addKey,
  deleteAction,
  moveKey,
  removeKey,
  renameAction,
  setActionLoop,
  setActionTrigger,
  setKeySeconds,
} from "./actions";
import { lintLuaCallins } from "./luaCallinLint";
import { buildLuaScript } from "./luaScript";
import { parseLegoProjectData } from "./model";

describe("a looping action under luajit (#3356)", () => {
  // Poses reached at 1 s, 3 s, 4 s, 6 s, 7 s ... from a start on frame 0.
  const lua = buildLuaScript(unit());
  const rows = run(lua, [{ frame: 0, callin: "StartMoving" }], 12 * FPS, [
    ARM_X,
    ARM_Z,
    HATCH_Y,
  ]);
  /** Where the watched values are once `frame` frames have passed. */
  const valuesAt = (frame: number) => rows[frame - 1];

  it("reaches each pose at its time, within one frame, and loops", () => {
    const reach = [
      { second: 1, pose: [1, 0, 4], speed: 4 },
      { second: 3, pose: [-0.5, 0.8, 0], speed: 2 },
      { second: 4, pose: [1, 0, 4], speed: 4 },
      { second: 6, pose: [-0.5, 0.8, 0], speed: 2 },
      { second: 7, pose: [1, 0, 4], speed: 4 },
      { second: 9, pose: [-0.5, 0.8, 0], speed: 2 },
    ];
    for (const { second, pose, speed } of reach) {
      const got = valuesAt(second * FPS);
      pose.forEach((want, i) => {
        expect(Math.abs(got[i] - want)).toBeLessThanOrEqual(allowance(speed));
      });
    }
  });

  it("is still on its way one second before it arrives", () => {
    // 2 s in, on the way from A (1 rad at 1 s) to B (-0.5 rad at 3 s).
    expect(valuesAt(2 * FPS)[0]).toBeCloseTo(0.25, 1);
  });

  it("writes the speed of each axis from its own distance", () => {
    // Rest to A in 1 s: 1 rad and 4 elmos. A to B in 2 s: 1.5 rad, 0.8 rad and 4 elmos.
    expect(lua).toContain("Turn(arm, x_axis, 1, 1)");
    expect(lua).toContain("Move(hatch, y_axis, 4, 4)");
    expect(lua).toContain("Turn(arm, x_axis, -0.5, 0.75)");
    expect(lua).toContain("Turn(arm, z_axis, 0.8, 0.4)");
    expect(lua).toContain("Move(hatch, y_axis, 0, 2)");
    // The loop goes back from B to A in the first key's 1 s.
    expect(lua).toContain("Turn(arm, z_axis, 0, 0.8)");
  });

  it("writes nothing for an axis that does not change", () => {
    expect(lua).not.toContain("y_axis, 0, 0)");
    expect(lua).not.toMatch(/Turn\(hatch/);
  });

  it("is ended by the matching stop call-in, and the pieces go home", () => {
    const stopped = run(
      lua,
      [
        { frame: 0, callin: "StartMoving" },
        { frame: 4 * FPS + 5, callin: "StopMoving" },
      ],
      14 * FPS,
      [ARM_X, ARM_Z, HATCH_Y],
    );
    const last = stopped.at(-1) as number[];
    expect(last).toEqual([0, 0, 0]);
    // Nothing moves after it has arrived, so the thread is gone.
    const tail = stopped.slice(10 * FPS);
    expect(new Set(tail.map((row) => row.join(" "))).size).toBe(1);
  });

  it("is written with a string signal and the call-in hooks", () => {
    expect(lua).toContain('local SIG_ACTION_PLANT = "SIG_ACTION_PLANT"');
    expect(lua).toMatch(
      /function script\.StartMoving\(\)\n {2}Signal\(SIG_ACTION_PLANT\)\n {2}StartThread\(action_Plant\)/,
    );
    expect(lua).toMatch(
      /function script\.StopMoving\(\)\n {2}action_PlantStop\(\)/,
    );
  });

  it("passes the call-in lint", () => {
    expect(lintLuaCallins(lua)).toEqual([]);
  });
});

describe("a one shot action", () => {
  const shot = unit({
    actions: [action({ trigger: "Shot1", loop: false })],
  });
  const lua = buildLuaScript(shot);

  it("runs once on its call-in and holds the last pose", () => {
    const rows = run(lua, [{ frame: 10, callin: "Shot1" }], 10 * FPS, [
      ARM_X,
      ARM_Z,
      HATCH_Y,
    ]);
    const end = rows.at(-1) as number[];
    expect(end[0]).toBeCloseTo(-0.5, 3);
    expect(end[1]).toBeCloseTo(0.8, 3);
    expect(end[2]).toBeCloseTo(0, 3);
    // B is reached 3 s after the shot and never left.
    const settled = rows.slice(10 + 3 * FPS + 1);
    expect(new Set(settled.map((row) => row.join(" "))).size).toBe(1);
  });

  it("writes no stop and no loop", () => {
    expect(lua).not.toContain("while true");
    expect(lua).not.toContain("action_PlantStop");
  });
});

describe("a function of its own", () => {
  const own = unit({
    actions: [action({ trigger: "OpenHatch", loop: true })],
  });
  const lua = buildLuaScript(own);

  it("defines the function and its stop", () => {
    expect(lua).toContain("function script.OpenHatch()");
    expect(lua).toContain("function script.OpenHatchStop()");
  });

  it("plays when called and ends when its stop is", () => {
    const rows = run(
      lua,
      [
        { frame: 0, callin: "OpenHatch" },
        { frame: 5 * FPS, callin: "OpenHatchStop" },
      ],
      12 * FPS,
      [ARM_X],
    );
    expect(rows.at(-1)).toEqual([0]);
  });

  it("refuses a name the script already defines", () => {
    const clash = unit({ actions: [action({ trigger: "Killed" })] });
    expect(buildLuaScript(clash)).toBe(
      buildLuaScript({ ...clash, actions: undefined }),
    );
    expect(actionProblems(clash).map((p) => p.severity)).toEqual(["error"]);
  });
});

describe("pieces and poses that are gone", () => {
  it("skips a piece the unit no longer has", () => {
    const pose = {
      ...POSE_A,
      pieces: {
        ...POSE_A.pieces,
        vanished: { turn: [2, 0, 0] as [number, number, number] },
      },
    };
    const lua = buildLuaScript(unit({ poses: [pose, POSE_B] }));
    expect(lua).not.toContain("vanished");
    expect(lua).toContain("Turn(arm, x_axis, 1, 1)");
  });

  it("skips a key whose pose was deleted and keeps its time", () => {
    const keys = [
      { pose: "pose-a", seconds: 1 },
      { pose: "deleted", seconds: 1 },
      { pose: "pose-b", seconds: 1 },
    ];
    const lua = buildLuaScript(
      unit({ actions: [action({ keys, loop: false })] }),
    );
    // B is reached two seconds after A, the deleted key's second included.
    expect(lua).toContain("Turn(arm, x_axis, -0.5, 0.75)");
    expect(
      actionProblems(unit({ actions: [action({ keys })] }))[0].message,
    ).toContain("no longer exist");
  });

  it("writes nothing for an action that moves no piece the unit has", () => {
    const lua = buildLuaScript(
      unit({
        poses: [
          { id: "pose-a", name: "A", pieces: { gone: { turn: [1, 0, 0] } } },
          { id: "pose-b", name: "B", pieces: { gone: { turn: [2, 0, 0] } } },
        ],
      }),
    );
    expect(lua).not.toContain("Plant");
  });
});

describe("a unit without actions", () => {
  it("writes the script it always did", () => {
    const plain = unit({ actions: undefined, poses: undefined });
    const withPoses = unit({ actions: undefined });
    const empty = unit({ actions: [] });
    expect(buildLuaScript(withPoses)).toBe(buildLuaScript(plain));
    expect(buildLuaScript(empty)).toBe(buildLuaScript(plain));
    expect(buildLuaScript(plain)).not.toContain("ACTION");
  });

  it("keeps a preset's script byte for byte when an action is added after it", () => {
    const base = unit({ actions: undefined });
    const withPreset = unit({
      actions: undefined,
      pieces: [...base.pieces, { ...piece("body", "body"), role: "base" }],
      animations: [{ presetId: "hover.bob", params: {} }],
    });
    const before = buildLuaScript(withPreset);
    expect(before).toContain("SIG_HOVER_BOB");
    const both = buildLuaScript({ ...withPreset, actions: [action()] });
    expect(both).toContain("SIG_HOVER_BOB = 1");
    expect(both).toContain("SIG_ACTION_PLANT");
  });
});

describe("clashes", () => {
  it("names the piece two actions both move", () => {
    const two = unit({
      actions: [
        action(),
        action({ id: "other", name: "Wave", trigger: "Activate" }),
      ],
    });
    const clashes = actionClashes(two);
    expect(
      clashes.map((c) => `${c.action.name}/${c.piece.name}/${c.with}`),
    ).toContain("Plant/arm/Wave");
    const text = actionProblems(two).map((p) => p.message);
    expect(text.some((m) => m.includes("arm") && m.includes("Wave"))).toBe(
      true,
    );
  });

  it("names a piece an action and a preset both move", () => {
    const base = unit({ actions: undefined });
    const flap = {
      ...base,
      pieces: base.pieces.map((p) =>
        p.id === "arm" ? { ...p, role: "turret" } : p,
      ),
      animations: [{ presetId: "turret.track", params: {} }],
      actions: [action()],
    };
    expect(actionClashes(flap).some((c) => c.piece.name === "arm")).toBe(true);
  });

  it("says nothing for actions on separate pieces", () => {
    const apart = unit({
      actions: [
        action({ keys: [{ pose: "pose-b", seconds: 1 }] }),
        action({
          id: "o",
          name: "Lift",
          keys: [{ pose: "pose-a", seconds: 1 }],
        }),
      ],
      poses: [
        POSE_B,
        { id: "pose-a", name: "Lift", pieces: { hatch: { move: [0, 4, 0] } } },
      ],
    });
    expect(actionClashes(apart)).toEqual([]);
  });
});

describe("editing", () => {
  const start = unit({ actions: undefined });

  it("adds, renames, sets and deletes an action", () => {
    let p = addAction(start, { id: "a1", name: "Plant" });
    p = addAction(p, { id: "a2", name: "Plant" });
    expect(p.actions?.map((a) => a.name)).toEqual(["Plant", "Plant 2"]);
    p = renameAction(p, "a2", "Plant");
    expect(p.actions?.[1].name).toBe("Plant 2");
    p = setActionTrigger(p, "a1", "Activate");
    p = setActionLoop(p, "a1", false);
    expect(p.actions?.[0]).toMatchObject({ trigger: "Activate", loop: false });
    p = deleteAction(deleteAction(p, "a1"), "a2");
    expect("actions" in p).toBe(false);
  });

  it("adds keys for saved poses only, times them, moves and removes them", () => {
    let p = addAction(start, { id: "a1", name: "Plant" });
    p = addKey(p, "a1", "pose-a");
    p = addKey(p, "a1", "nope");
    p = addKey(p, "a1", "pose-b", 2);
    expect(p.actions?.[0].keys).toEqual([
      { pose: "pose-a", seconds: 0.5 },
      { pose: "pose-b", seconds: 2 },
    ]);
    p = setKeySeconds(p, "a1", 0, 1.5);
    p = setKeySeconds(p, "a1", 0, -1);
    p = setKeySeconds(p, "a1", 0, Number.NaN);
    expect(p.actions?.[0].keys[0].seconds).toBe(1.5);
    p = moveKey(p, "a1", 0, 1);
    expect(p.actions?.[0].keys).toEqual([
      { pose: "pose-b", seconds: 2 },
      { pose: "pose-a", seconds: 1.5 },
    ]);
    p = removeKey(p, "a1", 0);
    expect(p.actions?.[0].keys).toEqual([{ pose: "pose-a", seconds: 1.5 }]);
  });

  it("survives a save and a load, and drops what it cannot read", () => {
    const loaded = parseLegoProjectData(
      JSON.parse(
        JSON.stringify({
          ...unit(),
          actions: [
            ...(unit().actions ?? []),
            { id: "", name: "x", trigger: "Create", loop: false, keys: [] },
            {
              id: "b",
              name: "Bad key",
              trigger: "Create",
              loop: false,
              keys: [{ pose: "pose-a", seconds: -1 }, { pose: 4 }],
            },
          ],
        }),
      ),
    );
    expect(loaded?.actions?.map((a) => a.id)).toEqual(["act", "b"]);
    expect(loaded?.actions?.[1].keys).toEqual([]);
  });
});
