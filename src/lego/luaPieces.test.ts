import { describe, expect, it } from "vitest";

import { declaredPieces } from "./luaPieces";

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
