import { describe, expect, it } from "vitest";

import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";

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

/** Every piece a `piece("...")` call names. */
function declaredPieces(lua: string): string[] {
  return [...lua.matchAll(/piece\("([^"]+)"\)/g)].map((match) => match[1]);
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
      "script.Killed(recentDamage, maxHealth)",
    ]) {
      expect(lua).toContain(`function ${hook}`);
    }
  });

  it("only declares pieces the unit actually has", () => {
    const lua = buildLuaScript(
      project(LEGS, [{ presetId: "walk.biped", params: {} }]),
    );
    const names = new Set(project(LEGS).pieces.map((piece) => piece.name));

    expect(declaredPieces(lua).length).toBeGreaterThan(0);
    for (const declared of declaredPieces(lua)) {
      expect(names).toContain(declared);
    }
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

  it("ends with exactly one newline and no triple blank lines", () => {
    const lua = buildLuaScript(project(LEGS));

    expect(lua.endsWith("\n")).toBe(true);
    expect(lua.endsWith("\n\n")).toBe(false);
    expect(lua).not.toMatch(/\n{3}/);
  });
});
