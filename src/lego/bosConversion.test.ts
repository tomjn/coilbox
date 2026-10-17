import { describe, expect, it } from "vitest";
import { hasOldPieceNumbering, isBosConversion } from "./bosConversion";

const HEADER = "-- scripts/corack.bos converted from BOS by coilbox.";

const OLD = `${HEADER}
local rnanospray = piece("rnanospray")

function QueryNanoPiece(piecenum)
  piecenum = 0
  return piecenum + 1
end
`;

const NEW = `${HEADER}
local rnanospray = piece("rnanospray")
PIECES = {
  rnanospray,
}

function QueryNanoPiece(piecenum)
  piecenum = 0
  return PIECES[piecenum + 1]
end
`;

describe("isBosConversion", () => {
  it("recognises the header coilbox writes", () => {
    expect(isBosConversion(OLD)).toBe(true);
  });

  it("rejects a hand written script, a missing script and a header further down", () => {
    expect(isBosConversion("local x = 1")).toBe(false);
    expect(isBosConversion(undefined)).toBe(false);
    expect(isBosConversion(`local x = 1\n${HEADER}`)).toBe(false);
  });
});

describe("hasOldPieceNumbering", () => {
  it("flags a conversion that returns a number plus one from a piece call-in", () => {
    expect(hasOldPieceNumbering(OLD)).toBe(true);
  });

  it("flags a numbered weapon call-in", () => {
    const script = `${HEADER}\nfunction script.AimFromWeapon2()\n  return piecenum + 1\nend\n`;
    expect(hasOldPieceNumbering(script)).toBe(true);
  });

  it("does not flag a conversion that has a PIECES table", () => {
    expect(hasOldPieceNumbering(NEW)).toBe(false);
  });

  it("does not flag a plus one in a call-in that does not answer a piece", () => {
    const script = `${HEADER}\nfunction Create()\n  return count + 1\nend\n`;
    expect(hasOldPieceNumbering(script)).toBe(false);
  });

  it("does not flag a script that is not a conversion", () => {
    expect(hasOldPieceNumbering(OLD.replace(HEADER, "-- mine"))).toBe(false);
  });
});
