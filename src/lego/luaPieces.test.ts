import { describe, expect, it } from "vitest";

import {
  declaredPieces,
  lineNamingPiece,
  missingPieces,
  renameScriptPieces,
} from "./luaPieces";

describe("declaredPieces", () => {
  it("finds the double-quoted, parenthesised form the generator emits", () => {
    expect(declaredPieces('local leftleg = piece("leftleg")')).toEqual([
      "leftleg",
    ]);
  });

  it("finds the unparenthesised single-quoted form bos2lua emits", () => {
    expect(declaredPieces("local leftleg = piece 'leftleg'")).toEqual([
      "leftleg",
    ]);
  });

  it("finds the long-bracket form", () => {
    expect(declaredPieces("local leftleg = piece [[leftleg]]")).toEqual([
      "leftleg",
    ]);
  });

  it("finds every declaration in a script, in order", () => {
    const lua = [
      'local hull = piece("hull")',
      'local turret = piece("turret")',
    ].join("\n");

    expect(declaredPieces(lua)).toEqual(["hull", "turret"]);
  });

  it("finds every name of a call that declares several", () => {
    expect(
      declaredPieces(
        'local base, arm = piece("base", "arm")\nlocal gun = piece(\'gun\')',
      ),
    ).toEqual(["base", "arm", "gun"]);
  });

  it("returns nothing when the script declares no pieces", () => {
    expect(declaredPieces("function script.Create()\nend\n")).toEqual([]);
  });
});

describe("missingPieces", () => {
  it("names the pieces a script uses that the unit does not have", () => {
    const lua = [
      'local hull = piece("hull")',
      'local turret = piece("trret")',
    ].join("\n");

    expect(missingPieces(lua, ["hull", "turret"])).toEqual(["trret"]);
  });

  it("says nothing when every piece it names is on the unit", () => {
    expect(missingPieces('local hull = piece("hull")', ["hull"])).toEqual([]);
  });

  it("names a piece once however many times the script declares it", () => {
    const lua = 'local a = piece("ghost")\nlocal b = piece("ghost")';

    expect(missingPieces(lua, ["hull"])).toEqual(["ghost"]);
  });
});

describe("lineNamingPiece", () => {
  it("finds the line of a name that is not the first of its call", () => {
    expect(lineNamingPiece('-- one\nlocal a, b = piece("a", "b")', "b")).toBe(
      2,
    );
  });
});

describe("renameScriptPieces", () => {
  it("renames only the piece names, wherever a call names them", () => {
    const lua = [
      'local arm, gun = piece("arm", "gun")',
      "local leg = piece 'leg'",
      "-- arm is the left one",
      "Turn(arm, x_axis, 1)",
    ].join("\n");

    expect(renameScriptPieces(lua, { arm: "lArm", leg: "foot" })).toBe(
      [
        'local arm, gun = piece("lArm", "gun")',
        "local leg = piece 'foot'",
        "-- arm is the left one",
        "Turn(arm, x_axis, 1)",
      ].join("\n"),
    );
  });
});
