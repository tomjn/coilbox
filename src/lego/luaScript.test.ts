import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { declaredPieces, missingPieces } from "./luaPieces";
import { buildLuaScript, unitScript } from "./luaScript";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectJson,
} from "./model";

/**
 * Whether luajit can compile `lua` without a syntax error. Uses `loadstring`
 * rather than running the script, since a generated unit script calls engine
 * globals (`piece`, `Spin`, ...) that only exist inside Recoil.
 */
function luaCompiles(lua: string): boolean {
  const result = spawnSync(
    "luajit",
    [
      "-e",
      "local src = io.read('*a'); local f, err = loadstring(src); " +
        "if not f then io.stderr:write(err); os.exit(1) end os.exit(0)",
    ],
    { input: lua },
  );
  return result.status === 0;
}

function project(
  pieces: Partial<LegoPiece>[],
  animations: LegoProject["animations"] = [],
): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "cakebot",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
  return {
    ...base,
    animations,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: "x",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

const LEGS: Partial<LegoPiece>[] = [
  { id: "lt", name: "leftthigh", role: "leg.l1.thigh" },
  { id: "ls", name: "leftshin", role: "leg.l1.shin" },
  { id: "rt", name: "rightthigh", role: "leg.r1.thigh" },
  { id: "rs", name: "rightshin", role: "leg.r1.shin" },
];

const ARM: Partial<LegoPiece>[] = [
  { id: "ab", name: "armbase", role: "buildarm.base" },
  { id: "ar", name: "arm", role: "buildarm.arm" },
];

/** Three emit points, which is what a game builder usually carries and what
 *  makes the cycling in `QueryNanoPiece` worth writing. */
const NANO: Partial<LegoPiece>[] = [
  { id: "n1", name: "nano1", role: "buildarm.nano" },
  { id: "n2", name: "nano2", role: "buildarm.nano" },
  { id: "n3", name: "nano3", role: "buildarm.nano" },
];

/**
 * The body of one generated function, without its `function` and `end` lines.
 *
 * Asserting on position inside a call-in needs the lines in order rather than a
 * substring of the whole file, since build stance is about what runs first and
 * what runs last.
 */
function between(lua: string, signature: string): string[] {
  const lines = lua.split("\n");
  const start = lines.findIndex((line) => line.startsWith(signature));
  if (start === -1) throw new Error(`no ${signature} in the script`);
  const end = lines.indexOf("end", start);
  return lines.slice(start + 1, end);
}

describe("buildLuaScript", () => {
  it("writes every callin even with nothing applied, so it loads as it is", () => {
    const lua = buildLuaScript(project([]));

    for (const hook of [
      "script.Create()",
      "script.StartMoving()",
      "script.StopMoving()",
      "script.Activate()",
      "script.Deactivate()",
      "script.AimWeapon1(heading, pitch)",
      "script.AimFromWeapon1()",
      "script.QueryWeapon1()",
      "script.Shot1()",
      "script.Killed(recentDamage, maxHealth)",
    ]) {
      expect(lua).toContain(`function ${hook}`);
    }
  });

  it("only declares pieces the unit actually has", () => {
    const lua = buildLuaScript(
      project(LEGS, [{ presetId: "walk.biped", params: {} }]),
    );
    const names = project(LEGS).pieces.map((piece) => piece.name);

    expect(declaredPieces(lua).length).toBeGreaterThan(0);
    expect(missingPieces(lua, names)).toEqual([]);
  });

  it("leaves out pieces nothing references", () => {
    const lua = buildLuaScript(
      project([...LEGS, { id: "d", name: "decoration", role: undefined }]),
    );

    expect(declaredPieces(lua)).not.toContain("decoration");
  });

  it("gives the same output for the same project, every time", () => {
    const doc = project(LEGS, [
      { presetId: "walk.biped", params: { period: 1.2 } },
    ]);

    expect(buildLuaScript(doc)).toBe(buildLuaScript(doc));
  });

  it("renames a piece whose name is a Lua keyword, keeping the real name", () => {
    const lua = buildLuaScript(
      project(
        [{ id: "e", name: "end", role: "wheel" }],
        [{ presetId: "wheels.roll", params: {} }],
      ),
    );

    expect(lua).toContain('local p_end = piece("end")');
    expect(lua).toContain("Spin(p_end,");
    expect(lua).not.toMatch(/local end\b/);
  });

  it("escapes a hostile piece name in the piece() lookup argument", () => {
    // Piece names normally come from the editor already identifier-safe, but
    // an imported project can carry anything as a piece name. The lookup
    // argument still has to stay inside its own literal.
    const lua = buildLuaScript(
      project(
        [{ id: "w1", name: 'wheel"); os.execute("rm', role: "wheel" }],
        [{ presetId: "wheels.roll", params: {} }],
      ),
    );

    expect(lua).toContain('piece("wheel\\"); os.execute(\\"rm")');
    expect(lua).not.toContain('piece("wheel"); os.execute("rm")');
  });

  it("parses under luajit once a hostile import has gone through parseLegoProjectJson", () => {
    // Escaping the piece() argument is not enough on its own: the same name
    // also becomes a Lua identifier on the left of `local <name> = ...`, and
    // no string escape can fix that. The fix lives in parseLegoProjectJson
    // (see model.test.ts), so this checks the two together, on the real
    // parser rather than a hand-built project, and against luajit itself
    // rather than asserting only on the generated string.
    const doc = project(
      [
        { id: "w1", name: 'wheel"); os.execute("rm', role: "wheel" },
        // "wheel!" and "wheel?" both normalise to "wheel": a collision that
        // has to be resolved too, or the second declaration silently
        // shadows the first and Spin() ends up spinning the wrong piece.
        { id: "w2", name: "wheel!", role: "wheel" },
        { id: "w3", name: "wheel?", role: "wheel" },
      ],
      [{ presetId: "wheels.roll", params: {} }],
    );

    const parsed = parseLegoProjectJson(JSON.stringify(doc));
    expect(parsed).not.toBeNull();

    const lua = buildLuaScript(parsed as LegoProject);
    const names = declaredPieces(lua);
    expect(new Set(names).size).toBe(names.length);
    expect(luaCompiles(lua)).toBe(true);
  });

  it("spins every wheel and stops every one", () => {
    const lua = buildLuaScript(
      project(
        [
          { id: "w1", name: "wheelleft", role: "wheel" },
          { id: "w2", name: "wheelright", role: "wheel" },
        ],
        [{ presetId: "wheels.roll", params: {} }],
      ),
    );

    expect(lua).toContain("Spin(wheelleft, x_axis,");
    expect(lua).toContain("Spin(wheelright, x_axis,");
    expect(lua).toContain("StopSpin(wheelleft, x_axis)");
    expect(lua).toContain("StopSpin(wheelright, x_axis)");
  });

  it("starts the walk thread on the move callins, with a signal", () => {
    const lua = buildLuaScript(
      project(LEGS, [{ presetId: "walk.biped", params: {} }]),
    );

    expect(lua).toContain("local function walk()");
    expect(lua).toContain("SetSignalMask(SIG_WALK_BIPED)");
    expect(lua).toContain("StartThread(walk)");
    expect(lua).toContain("walkStop()");
  });

  it("gives two presets different signals, so one cannot kill the other", () => {
    const lua = buildLuaScript(
      project(
        [...LEGS, { id: "w", name: "wheelone", role: "wheel" }],
        [
          { presetId: "walk.biped", params: {} },
          { presetId: "open.close", params: {} },
        ],
      ),
    );
    const signals = [...lua.matchAll(/local (SIG_\w+) = (\d+)/g)];

    // open.close has no door here, so only the walk signal is declared.
    expect(signals).toHaveLength(1);
    expect(signals[0][1]).toBe("SIG_WALK_BIPED");
  });

  it("declares one signal per preset that emits, and they differ", () => {
    const lua = buildLuaScript(
      project(
        [...LEGS, { id: "d", name: "hatch", role: "door" }],
        [
          { presetId: "walk.biped", params: {} },
          { presetId: "open.close", params: {} },
        ],
      ),
    );
    const values = [...lua.matchAll(/local SIG_\w+ = (\d+)/g)].map((m) => m[1]);

    expect(values).toHaveLength(2);
    expect(new Set(values).size).toBe(2);
  });

  it("aims the turret from the turret and fires from the flare", () => {
    const lua = buildLuaScript(
      project(
        [
          { id: "t", name: "turret", role: "turret" },
          { id: "b", name: "barrel", role: "barrel" },
          { id: "f", name: "flare", role: "flare" },
        ],
        [{ presetId: "turret.track", params: {} }],
      ),
    );

    expect(lua).toContain("Turn(turret, y_axis, heading,");
    expect(lua).toContain("Turn(barrel, x_axis, -pitch,");
    expect(lua).toMatch(
      /function script\.AimFromWeapon1\(\)\n {2}return turret/,
    );
    expect(lua).toMatch(/function script\.QueryWeapon1\(\)\n {2}return flare/);
  });

  it("still aims when there is no flare to fire from", () => {
    const lua = buildLuaScript(
      project(
        [{ id: "t", name: "turret", role: "turret" }],
        [{ presetId: "turret.track", params: {} }],
      ),
    );

    expect(lua).toMatch(/function script\.QueryWeapon1\(\)\n {2}return turret/);
  });

  it("emits nothing for a preset whose pieces are not there", () => {
    const lua = buildLuaScript(
      project([], [{ presetId: "wheels.roll", params: {} }]),
    );

    expect(lua).not.toContain("Spin(");
    expect(lua).not.toContain("SIG_");
  });

  it("blows up the root piece when killed", () => {
    const lua = buildLuaScript(project([]));

    expect(lua).toContain("Explode(base, SFX.SHATTER)");
  });

  it("starts hovering on Create, since it never stands down", () => {
    const lua = buildLuaScript(
      project(
        [{ id: "h", name: "hull", role: "base" }],
        [{ presetId: "hover.bob", params: {} }],
      ),
    );

    expect(lua).toContain("local function hover()");
    expect(lua).toMatch(
      /function script\.Create\(\)\n {2}Signal\(SIG_HOVER_BOB\)\n {2}StartThread\(hover\)/,
    );
    expect(lua).toContain("Move(hull, y_axis,");
    expect(lua).toContain("Turn(hull, z_axis,");
    expect(lua).toContain("hoverStop()");
  });

  it("aims from and fires from the aim point when there is no turret", () => {
    const lua = buildLuaScript(
      project(
        [{ id: "a", name: "gimbal", role: "aim" }],
        [{ presetId: "aim.track", params: {} }],
      ),
    );

    expect(lua).toContain("Turn(gimbal, y_axis, heading,");
    expect(lua).toContain("Turn(gimbal, x_axis, -pitch,");
    expect(lua).toMatch(
      /function script\.AimFromWeapon1\(\)\n {2}return gimbal/,
    );
    expect(lua).toMatch(/function script\.QueryWeapon1\(\)\n {2}return gimbal/);
  });

  it("starts idle sway on stopping and stands it down on moving", () => {
    const lua = buildLuaScript(
      project(
        [{ id: "h", name: "hull", role: "base" }],
        [{ presetId: "idle.sway", params: {} }],
      ),
    );

    expect(lua).toContain("local function idleSway()");
    expect(lua).toMatch(
      /function script\.StopMoving\(\)\n {2}Signal\(SIG_IDLE_SWAY\)\n {2}StartThread\(idleSway\)/,
    );
    expect(lua).toMatch(
      /function script\.StartMoving\(\)\n {2}Signal\(SIG_IDLE_SWAY\)\n {2}idleSwayStop\(\)/,
    );
  });

  it("kicks the barrel back on Shot1 and eases it home, with no thread", () => {
    const lua = buildLuaScript(
      project(
        [{ id: "b", name: "barrel", role: "barrel" }],
        [{ presetId: "recoil", params: {} }],
      ),
    );

    expect(lua).toMatch(
      /function script\.Shot1\(\)\n {2}Signal\(SIG_RECOIL\)\n {2}SetSignalMask\(SIG_RECOIL\)\n {2}Move\(barrel, z_axis, -0\.2,/,
    );
    expect(lua).toContain("WaitForMove(barrel, z_axis)");
    expect(lua).toContain("Move(barrel, z_axis, 0,");
    // A one-shot hangs directly off the callin, unlike a looping preset.
    expect(lua).not.toContain("local function recoil");
  });

  it("emits nothing for recoil when there is no barrel", () => {
    const lua = buildLuaScript(
      project([], [{ presetId: "recoil", params: {} }]),
    );

    expect(lua).not.toContain("SIG_RECOIL");
  });

  it("poses the body in Killed before the explode, with no thread", () => {
    const lua = buildLuaScript(
      project(
        [{ id: "h", name: "hull", role: "base" }],
        [{ presetId: "wreck.pose", params: { sink: 0.2, tilt: 15 } }],
      ),
    );

    expect(lua).toMatch(
      /function script\.Killed\(recentDamage, maxHealth\)\n {2}Move\(hull, y_axis, -0\.2\)\n {2}Turn\(hull, z_axis, 0\.2618\)\n {2}Explode\(base, SFX\.SHATTER\)\n {2}return 1/,
    );
    // A one-shot pose hangs directly off the callin, unlike a looping preset.
    expect(lua).not.toContain("local function wreck");
  });

  it("still explodes and returns from Killed when there is no wreck pose applied", () => {
    const lua = buildLuaScript(project([]));

    expect(lua).toMatch(
      /function script\.Killed\(recentDamage, maxHealth\)\n {2}Explode\(base, SFX\.SHATTER\)\n {2}return 1/,
    );
  });

  it("says nothing about collision while every piece keeps its derived box", () => {
    expect(buildLuaScript(project(LEGS))).not.toContain("include(");
  });

  it("pulls in the collision file once a piece overrides its box (#1842)", () => {
    const doc = project([
      { id: "dish", name: "dish", collision: { hit: false } },
    ]);

    // Relative to scripts/, because that is what the framework's own include
    // prepends. And at the top of the file, above the piece locals, so an
    // edited script is unlikely to lose it.
    expect(buildLuaScript(doc)).toContain(
      'include("coilbox/cakebot_collision.lua")',
    );
    expect(buildLuaScript(doc).indexOf("include(")).toBeLessThan(
      buildLuaScript(doc).indexOf("function script."),
    );
  });

  it("carries the include line into a script the user takes over", () => {
    // Taking ownership seeds the user's copy from the generated text, so the
    // line survives by construction rather than by anything preserving it.
    const doc = project([
      { id: "dish", name: "dish", collision: { hit: false } },
    ]);

    expect(unitScript({ ...doc, script: buildLuaScript(doc) })).toContain(
      'include("coilbox/cakebot_collision.lua")',
    );
  });

  it("ends with exactly one newline and no triple blank lines", () => {
    const lua = buildLuaScript(project(LEGS));

    expect(lua.endsWith("\n")).toBe(true);
    expect(lua.endsWith("\n\n")).toBe(false);
    expect(lua).not.toMatch(/\n{3}/);
  });

  /**
   * Build stance is what lets a builder build at all. `CBuilder::StartBuild`
   * refuses to start until it is set, and a script is the only thing in the
   * engine that can set it, so a unit whose script omits it queues a build and
   * waits forever with nothing in the infolog to say why.
   */
  describe("build stance", () => {
    it("is set for a unit with no build arm and no presets at all", () => {
      const lua = buildLuaScript(project([{ id: "hull", name: "hull" }]));

      expect(lua).toContain("SetUnitValue(COB.INBUILDSTANCE, 1)");
      expect(lua).toContain("SetUnitValue(COB.INBUILDSTANCE, 0)");
    });

    /** After the aim, so the unit only claims to be in stance once its arm has
     *  actually finished pointing at the target. */
    it("is set last in StartBuilding, after whatever a preset added", () => {
      const lua = buildLuaScript(
        project(ARM, [{ presetId: "build.aim", params: {} }]),
      );
      const body = between(lua, "function script.StartBuilding");

      expect(body.at(-1)).toBe("  SetUnitValue(COB.INBUILDSTANCE, 1)");
      expect(body.indexOf("  end")).toBeLessThan(body.length - 1);
    });

    /** Before the swing home, so the unit stops building at once rather than
     *  after its arm has finished travelling. */
    it("is cleared first in StopBuilding, before whatever a preset added", () => {
      const lua = buildLuaScript(
        project(ARM, [{ presetId: "build.aim", params: {} }]),
      );
      const body = between(lua, "function script.StopBuilding");

      expect(body[0]).toBe("  SetUnitValue(COB.INBUILDSTANCE, 0)");
      expect(body.length).toBeGreaterThan(1);
    });
  });

  describe("aiming while building", () => {
    /**
     * A factory's `StartBuilding` is called with no arguments at all, and both
     * shapes arrive through the one function name, so the body has to check it
     * was handed a heading before it turns anything to it.
     */
    it("guards the aim, since a factory calls the same function with nothing", () => {
      const lua = buildLuaScript(
        project(ARM, [{ presetId: "build.aim", params: {} }]),
      );

      expect(lua).toContain("  if heading then");
      expect(lua).toMatch(/if heading then[\s\S]*Turn\(arm, x_axis, -pitch/);
    });

    it("waits for both turns before the stance line runs", () => {
      const lua = buildLuaScript(
        project(ARM, [{ presetId: "build.aim", params: {} }]),
      );
      const body = between(lua, "function script.StartBuilding").join("\n");

      expect(body).toMatch(
        /WaitForTurn\(armbase, y_axis\)[\s\S]*WaitForTurn\(arm, x_axis\)[\s\S]*INBUILDSTANCE, 1/,
      );
    });

    it("turns both pieces home when the job stops", () => {
      const lua = buildLuaScript(
        project(ARM, [{ presetId: "build.aim", params: {} }]),
      );

      expect(lua).toContain("Turn(armbase, y_axis, 0,");
      expect(lua).toContain("Turn(arm, x_axis, 0,");
    });

    /** The base is optional: a one piece arm still aims, it just cannot swing
     *  round, so nothing should be emitted naming a piece that is not there. */
    it("emits no base turn for an arm with no base under it", () => {
      const lua = buildLuaScript(
        project(
          [{ id: "ar", name: "arm", role: "buildarm.arm" }],
          [{ presetId: "build.aim", params: {} }],
        ),
      );

      expect(lua).toContain("Turn(arm, x_axis, -pitch,");
      expect(lua).not.toContain("y_axis, heading");
    });
  });

  describe("the nano piece", () => {
    it("cycles every piece marked as an emit point", () => {
      const lua = buildLuaScript(
        project(NANO, [{ presetId: "build.nano", params: {} }]),
      );

      expect(lua).toContain("local nanoPieces = { nano1, nano2, nano3 }");
      expect(lua).toContain("nanoIndex = nanoIndex % #nanoPieces + 1");
      expect(lua).toContain("return nanoPieces[nanoIndex]");
    });

    it("still cycles with only one emit point, rather than special-casing it", () => {
      const lua = buildLuaScript(
        project(
          [{ id: "n", name: "nano1", role: "buildarm.nano" }],
          [{ presetId: "build.nano", params: {} }],
        ),
      );

      expect(lua).toContain("local nanoPieces = { nano1 }");
    });

    /**
     * The call-in has to hand back a piece however it is asked, and the honest
     * answer with none marked is the root: that is where the engine puts the
     * spray for a unit with no script at all.
     */
    it("falls back to the root piece when nothing is marked", () => {
      const lua = buildLuaScript(project([{ id: "hull", name: "hull" }]));

      // `base` is the root piece's name here. Its id is `root`, which is not
      // what the script says: a script names pieces, never ids.
      expect(between(lua, "function script.QueryNanoPiece")).toEqual([
        "  return base",
      ]);
    });
  });

  /**
   * The build arm used to sweep on Activate, which is the engine's "switched
   * on" and for a builder is nearly always true, so it never stopped.
   */
  it("sweeps the build arm while building rather than while merely active", () => {
    const lua = buildLuaScript(
      project(ARM, [{ presetId: "buildarm", params: {} }]),
    );

    expect(between(lua, "function script.StartBuilding")).toContain(
      "  StartThread(buildArm)",
    );
    expect(between(lua, "function script.Activate")).toEqual([]);
  });

  it("compiles with every build preset applied at once", () => {
    const lua = buildLuaScript(
      project(
        [...ARM, ...NANO, { id: "d", name: "door1", role: "door" }],
        [
          { presetId: "build.aim", params: {} },
          { presetId: "build.factory", params: {} },
          { presetId: "build.nano", params: {} },
          { presetId: "buildarm", params: {} },
        ],
      ),
    );

    expect(luaCompiles(lua)).toBe(true);
  });
});

describe("unitScript", () => {
  it("generates from the presets while the unit has no script of its own", () => {
    const doc = project(LEGS, [{ presetId: "walk.biped", params: {} }]);

    expect(unitScript(doc)).toBe(buildLuaScript(doc));
  });

  it("gives back the unit's own script, verbatim, once it has one", () => {
    const own = "-- mine\nfunction script.Create()\nend\n";
    const doc = project(LEGS, [{ presetId: "walk.biped", params: {} }]);

    expect(unitScript({ ...doc, script: own })).toBe(own);
  });

  it("keeps the owned script when the presets would say something else", () => {
    const doc = project(LEGS, [{ presetId: "walk.biped", params: {} }]);
    const owned = { ...doc, script: "-- mine\n" };

    expect(unitScript({ ...owned, animations: [] })).toBe("-- mine\n");
  });
});
