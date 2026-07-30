import { describe, expect, it } from "vitest";

import { declaredPieces, missingPieces } from "./luaPieces";

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
