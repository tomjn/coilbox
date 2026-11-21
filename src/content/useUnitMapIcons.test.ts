import { describe, expect, it } from "vitest";
import { iconTypesOf } from "./useUnitMapIcons";

const GAME = {
  unitTypes: { armcom: "commander", armpw: "default", armsolar: "building" },
  types: {
    commander: { size: 2 },
    building: { size: 1 },
    default: { size: 1 },
  },
};

describe("iconTypesOf", () => {
  it("answers with the game's type for a unit the analysis says nothing about", () => {
    expect(iconTypesOf(["ArmCom", "armpw", "ghost"], GAME)).toEqual([
      "commander",
      "default",
      null,
    ]);
    expect(iconTypesOf(["armcom"], GAME, new Map())).toEqual(["commander"]);
  });

  it("uses the type the analysis recorded for the match over the game's", () => {
    const match = new Map([["armcom", "building"]]);
    expect(iconTypesOf(["ArmCom", "armpw"], GAME, match)).toEqual([
      "building",
      "default",
    ]);
  });

  it("gives a unit only the analysis knows its recorded type", () => {
    const match = new Map([["ghost", "building"]]);
    expect(iconTypesOf(["ghost"], GAME, match)).toEqual(["building"]);
  });

  it("draws a type the game does not define as the default type", () => {
    const match = new Map([["armcom", "tweaked"]]);
    expect(iconTypesOf(["armcom"], GAME, match)).toEqual(["default"]);
  });
});
