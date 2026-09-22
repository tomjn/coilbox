import { describe, expect, it } from "vitest";

import { lintLuaCallins } from "./luaCallinLint";

describe("a definition matching the engine exactly", () => {
  it("is not flagged, as a function", () => {
    expect(lintLuaCallins("function script.StartMoving()\nend\n")).toEqual([]);
  });

  it("is not flagged, as an assignment", () => {
    expect(lintLuaCallins("script.StartMoving = DoTheThing\n")).toEqual([]);
  });

  it("does not mistake a comparison for a definition", () => {
    expect(
      lintLuaCallins(
        "function script.Create()\n  if script.StartMoving == nil then end\nend\n",
      ),
    ).toEqual([]);
  });
});

describe("a name matching nothing the engine calls", () => {
  it("says nothing, since it may be the script's own helper", () => {
    expect(lintLuaCallins("function script.DoTheThing()\nend\n")).toEqual([]);
  });
});

describe("a name differing from the engine's only in case", () => {
  it("names the engine's own spelling and the line", () => {
    const problems = lintLuaCallins("function script.Startmoving()\nend\n");
    expect(problems).toHaveLength(1);
    expect(problems[0].line).toBe(1);
    expect(problems[0].message).toBe(
      "The engine calls `script.StartMoving`, not `script.Startmoving`, so this never runs.",
    );
  });
});

describe("a COB-style numbered weapon name", () => {
  it("says a Lua script gets one call-in with the weapon number as an argument", () => {
    const problems = lintLuaCallins(
      "function script.AimWeapon1(heading, pitch)\nend\n",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toBe(
      "A Lua unit script gets one `script.AimWeapon` with the weapon number as its first argument. `AimWeapon1` is never called.",
    );
  });

  it("catches it as an assignment too", () => {
    const problems = lintLuaCallins("script.QueryWeapon2 = QueryTurret\n");
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("`script.QueryWeapon`");
    expect(problems[0].message).toContain("`QueryWeapon2`");
  });

  it("leaves a call-in nobody numbers alone even with a digit on the end", () => {
    // AimShield is not numbered in real content, so a script naming
    // "AimShield1" is naming something nobody calls, not a near miss.
    expect(lintLuaCallins("function script.AimShield1()\nend\n")).toEqual([]);
  });
});

describe("Create", () => {
  it("is not flagged, since real games and this app's own preview both call it", () => {
    expect(lintLuaCallins("function script.Create()\nend\n")).toEqual([]);
  });
});

describe("several definitions", () => {
  it("reports each on its own line", () => {
    const script = [
      "function script.Create()",
      "end",
      "function script.Startmoving()",
      "end",
      "function script.AimWeapon1()",
      "end",
    ].join("\n");
    const problems = lintLuaCallins(script);
    expect(problems.map((p) => p.line)).toEqual([3, 5]);
  });
});
