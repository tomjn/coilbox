import { describe, expect, it } from "vitest";
import { allowedFromBans, bansFromAllowed } from "./unitBans";

const KNOWN = ["armcom", "armpw", "armflash"];

describe("allowedFromBans", () => {
  it("ticks everything a mission does not ban", () => {
    expect(allowedFromBans(KNOWN, ["armpw"])).toEqual(["armcom", "armflash"]);
  });

  it("ticks everything when nothing is banned", () => {
    expect(allowedFromBans(KNOWN, [])).toEqual(KNOWN);
  });

  it("matches a ban stored in another case", () => {
    expect(allowedFromBans(KNOWN, ["ArmPw"])).toEqual(["armcom", "armflash"]);
  });
});

describe("bansFromAllowed", () => {
  it("bans what the author unticked", () => {
    expect(bansFromAllowed(KNOWN, ["armcom", "armflash"], [])).toEqual([
      "armpw",
    ]);
  });

  it("bans nothing when everything is ticked", () => {
    expect(bansFromAllowed(KNOWN, KNOWN, [])).toEqual([]);
  });

  it("bans everything when nothing is ticked", () => {
    // The whole point of the inversion: an empty screen has to mean an empty
    // arsenal, not an unrestricted mission.
    expect(bansFromAllowed(KNOWN, [], [])).toEqual(KNOWN);
  });

  it("keeps a ban on a unit this game has never heard of", () => {
    // A mission authored against another game, opened here. Dropping the ban
    // would rewrite it on the first edit.
    const next = bansFromAllowed(
      KNOWN,
      ["armcom", "armflash"],
      ["corcom", "armpw"],
    );
    expect(next).toEqual(["corcom", "armpw"]);
  });
});
