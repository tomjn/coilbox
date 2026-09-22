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

describe("a numbered weapon call-in", () => {
  it("is fine when the script defines AimWeapon1, which is what turns the dispatch on", () => {
    const script = [
      "function script.AimWeapon1(heading, pitch)",
      "end",
      "function script.QueryWeapon1()",
      "end",
      "function script.Shot1()",
      "end",
    ].join("\n");
    expect(lintLuaCallins(script)).toEqual([]);
  });

  it("is fine on AimShield1 alone, the framework's other switch", () => {
    const script = [
      "function script.AimShield1()",
      "end",
      "function script.QueryWeapon1()",
      "end",
    ].join("\n");
    expect(lintLuaCallins(script)).toEqual([]);
  });

  it("is dead when nothing turns the dispatch on, and says which name switches it", () => {
    const problems = lintLuaCallins("script.QueryWeapon2 = QueryTurret\n");
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("`AimWeapon1`");
    expect(problems[0].message).toContain("`QueryWeapon2`");
  });

  it("flags every numbered name on such a script, since the dispatch is all or nothing", () => {
    const script = [
      "function script.QueryWeapon1()",
      "end",
      "function script.Shot1()",
      "end",
    ].join("\n");
    expect(lintLuaCallins(script).map((p) => p.line)).toEqual([1, 3]);
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
      "function script.Stopmoving()",
      "end",
    ].join("\n");
    const problems = lintLuaCallins(script);
    expect(problems.map((p) => p.line)).toEqual([3, 5]);
  });
});
