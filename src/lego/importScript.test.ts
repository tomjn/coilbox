import { describe, expect, it } from "vitest";

import { importScript, importSummary, readActions } from "./importScript";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";

/**
 * Importing a Lua unit script into a unit (#643): piece names matched to the
 * unit's, and a simple script read back as actions of poses.
 */

function piece(
  id: string,
  name: string,
  over: Partial<LegoPiece> = {},
): LegoPiece {
  return {
    id,
    name,
    parentId: id === "root" ? null : "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...over,
  };
}

function unit(over: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "bot",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  return {
    ...base,
    pieces: [piece("root", "base"), piece("a", "arm")],
    ...over,
  };
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const SPINNER = [
  'local base, arm = piece("base", "arm")',
  "",
  "function script.Create()",
  "  Spin(arm, y_axis, 2)",
  "end",
  "",
].join("\n");

/** A walk written by hand: two keys, round and round while the unit moves,
 *  and back to rest when it stops. */
const WAVE = [
  "-- A hand written wave.",
  'local base, arm = piece("base", "arm")',
  "local SIG_WAVE = 2",
  "",
  "local function wave()",
  "  SetSignalMask(SIG_WAVE)",
  "  while true do",
  "    Turn(arm, x_axis, 1, 4)",
  "    Sleep(500)",
  "    Turn(arm, x_axis, -1, 4)",
  "    Sleep(500)",
  "  end",
  "end",
  "",
  "local function stopWave()",
  "  Signal(SIG_WAVE)",
  "  Turn(arm, x_axis, 0, 4)",
  "end",
  "",
  "function script.StartMoving()",
  "  Signal(SIG_WAVE)",
  "  StartThread(wave)",
  "end",
  "",
  "function script.StopMoving()",
  "  stopWave()",
  "end",
  "",
].join("\n");

describe("importing a script whose piece names the unit has", () => {
  it("keeps a script it cannot read back as the unit's own, byte for byte", () => {
    const result = importScript(unit(), SPINNER, { newId: ids() });

    expect(result.as).toBe("script");
    expect(result.project.script).toBe(SPINNER);
    expect(result.project.actions).toBeUndefined();
    expect(result.unmatched).toEqual([]);
    expect(importSummary(result)).toBe("Kept as this unit's own script.");
  });

  it("brings the library files and definition a game's script came with", () => {
    const result = importScript(unit(), SPINNER, {
      newId: ids(),
      includes: { "lib.lua": "return {}" },
      unitDef: { name: "bot" },
    });

    expect(result.project.gameScriptIncludes).toEqual({
      "lib.lua": "return {}",
    });
    expect(result.project.gameUnitDef).toEqual({ name: "bot" });
  });

  it("accepts the spelling the unit's model file used", () => {
    const project = unit({
      pieces: [
        piece("root", "base"),
        piece("a", "arm", { originalName: "Arm" }),
      ],
    });
    const lua = 'local arm = piece("Arm")\nfunction script.Create()\nend\n';

    const result = importScript(project, lua, { newId: ids() });

    expect(result.project.script).toBe(lua);
    expect(result.renamed).toEqual([]);
  });
});

describe("importing a script whose piece names differ", () => {
  it("reports the names the unit has no piece for, in one line", () => {
    const lua = 'local turret, gun = piece("turret", "gun")\n';

    const result = importScript(unit(), lua, { newId: ids() });

    expect(result.as).toBe("script");
    expect(result.unmatched).toEqual(["turret", "gun"]);
    expect(result.project.script).toBe(lua);
    expect(importSummary(result)).toBe(
      "Kept as this unit's own script. Not on this unit: turret, gun.",
    );
  });

  it("renames a name that differs only in case to the unit's spelling", () => {
    const lua = "local arm = piece 'ARM'\n";

    const result = importScript(unit(), lua, { newId: ids() });

    expect(result.project.script).toBe("local arm = piece 'arm'\n");
    expect(result.renamed).toEqual([{ from: "ARM", to: "arm" }]);
    expect(result.unmatched).toEqual([]);
  });
});

describe("reading a script back as actions", () => {
  it("reads a looping thread started by a call-in as an action of poses", () => {
    const result = importScript(unit(), WAVE, { newId: ids() });

    expect(result.as).toBe("actions");
    expect(result.project.script).toBeUndefined();
    const [action] = result.project.actions ?? [];
    expect(action).toMatchObject({
      name: "wave",
      trigger: "StartMoving",
      loop: true,
    });
    expect(action.keys.map((k) => k.seconds)).toEqual([0.5, 0.5]);
    const poses = action.keys.map((key) =>
      result.project.poses?.find((pose) => pose.id === key.pose),
    );
    expect(poses.map((pose) => pose?.pieces)).toEqual([
      { a: { turn: [1, 0, 0] } },
      { a: { turn: [-1, 0, 0] } },
    ]);
    expect(importSummary(result)).toBe("Read as 1 action.");
  });

  it("reads a thread that plays once, its last key timed by its speeds", () => {
    const lua = [
      'local arm = piece("arm")',
      "local function nod()",
      "  Turn(arm, x_axis, 0.5, 1)",
      "  Move(arm, y_axis, 2, 4)",
      "end",
      "function script.Shot1()",
      "  StartThread(nod)",
      "end",
    ].join("\n");

    const read = readActions(lua, unit(), ids());

    expect(read?.actions).toEqual([
      {
        id: "id-1",
        name: "nod",
        trigger: "Shot1",
        loop: false,
        keys: [{ pose: "id-2", seconds: 0.5 }],
      },
    ]);
    expect(read?.poses[0].pieces).toEqual({
      a: { turn: [0.5, 0, 0], move: [0, 2, 0] },
    });
  });

  it("reads back what the builder wrote for actions, which then writes the same script", () => {
    const made = unit({
      poses: [
        { id: "up", name: "Up", pieces: { a: { turn: [0.5, 0, 0] } } },
        {
          id: "down",
          name: "Down",
          pieces: { a: { turn: [-0.5, 0, 0], move: [0, 2, 0] } },
        },
      ],
      actions: [
        {
          id: "w",
          name: "Wave",
          trigger: "StartMoving",
          loop: true,
          keys: [
            { pose: "up", seconds: 0.5 },
            { pose: "down", seconds: 1 },
          ],
        },
        {
          id: "n",
          name: "Nod",
          trigger: "Shot1",
          loop: false,
          keys: [{ pose: "up", seconds: 0.5 }],
        },
      ],
    });
    const written = buildLuaScript(made);

    const result = importScript(unit(), written, { newId: ids() });

    expect(result.as).toBe("actions");
    expect(
      result.project.actions?.map((a) => [a.name, a.trigger, a.loop]),
    ).toEqual([
      ["Wave", "StartMoving", true],
      ["Nod", "Shot1", false],
    ]);
    expect(buildLuaScript(result.project)).toBe(written);
  });

  it("replaces the unit's own script when it reads one back", () => {
    const result = importScript(unit({ script: SPINNER }), WAVE, {
      newId: ids(),
    });

    expect(result.as).toBe("actions");
    expect(result.project.script).toBeUndefined();
  });

  it("keeps a thread whose speeds do not arrive on time as the unit's own script", () => {
    // Speed 2 reaches 1 from -1 in a second, but the thread waits half that.
    const lua = WAVE.replace(
      "Turn(arm, x_axis, 1, 4)",
      "Turn(arm, x_axis, 1, 2)",
    );

    const result = importScript(unit(), lua, { newId: ids() });

    expect(result.as).toBe("script");
    expect(result.project.script).toBe(lua);
    expect(result.project.actions).toBeUndefined();
    expect(result.project.poses).toBeUndefined();
  });

  it("keeps a looping thread with nothing to stop it as the unit's own script", () => {
    const lua = WAVE.replace("  stopWave()\n", "");

    expect(importScript(unit(), lua, { newId: ids() }).as).toBe("script");
  });

  it("keeps a call-in that does more than start a thread", () => {
    const lua = WAVE.replace(
      "  StartThread(wave)\n",
      "  StartThread(wave)\n  Spin(arm, y_axis, 1)\n",
    );

    expect(importScript(unit(), lua, { newId: ids() }).as).toBe("script");
  });

  it("does not read a script back on a unit with presets, which would still play", () => {
    const project = unit({ animations: [{ presetId: "walk" }] as never });

    const result = importScript(project, WAVE, { newId: ids() });

    expect(result.as).toBe("script");
    expect(result.project.script).toBe(WAVE);
  });

  it("does not read a script back that names a piece the unit lacks", () => {
    const lua = WAVE.replace('piece("base", "arm")', 'piece("base", "claw")');

    const result = importScript(unit(), lua, { newId: ids() });

    expect(result.as).toBe("script");
    expect(result.unmatched).toEqual(["claw"]);
  });
});
