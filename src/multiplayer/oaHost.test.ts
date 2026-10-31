import { describe, expect, it } from "vitest";
import {
  isOaBattle,
  OA_UNPICKED_MAP,
  oaBattleTitle,
  oaHostArguments,
  oaJoinArguments,
  oaMapArgument,
  oaPasswordTooLong,
  oaPlayerName,
} from "./oaHost";

describe("oaBattleTitle", () => {
  it("marks the host's title", () => {
    expect(oaBattleTitle("  Friday night ", "fallback")).toBe(
      "[OA] Friday night",
    );
  });

  it("marks the fallback when the title is blank", () => {
    expect(oaBattleTitle("   ", "Open Annihilation battle")).toBe(
      "[OA] Open Annihilation battle",
    );
  });
});

describe("oaPlayerName", () => {
  it("cuts a 20 character name to 16 rather than refusing it", () => {
    expect(oaPlayerName("abcdefghijklmnopqrst")).toBe("abcdefghijklmnop");
  });

  it("leaves a short name alone", () => {
    expect(oaPlayerName("Tom")).toBe("Tom");
  });

  it("counts characters, not bytes", () => {
    expect(oaPlayerName("é".repeat(20))).toBe("é".repeat(16));
  });
});

describe("oaMapArgument", () => {
  const maps = [{ shownName: "Shew Drop", key: "Comet Catcher" }];

  it("is none while the host leaves the choice to OA", () => {
    expect(oaMapArgument(OA_UNPICKED_MAP, maps)).toBeNull();
  });

  it("is the key OA lists for the shown name", () => {
    expect(oaMapArgument("Shew Drop", maps)).toBe("Comet Catcher");
  });

  it("passes a name OA does not list as it stands", () => {
    expect(oaMapArgument("Somewhere", maps)).toBe("Somewhere");
  });
});

describe("oaHostArguments", () => {
  const base = {
    battleId: 4021,
    username: "abcdefghijklmnopqrst",
    map: null,
    maxPlayers: 8,
    password: null,
  };

  it("hosts a room named after the battle, with the name cut", () => {
    expect(oaHostArguments(base)).toEqual([
      "--host",
      "--game-name",
      "CB4021",
      "--player-name",
      "abcdefghijklmnop",
      "--player-limit",
      "8",
    ]);
  });

  it("gives the room the battle's password", () => {
    expect(oaHostArguments({ ...base, password: "s3cret" }).slice(-2)).toEqual([
      "--game-password",
      "s3cret",
    ]);
  });

  it("has no password option for an open battle", () => {
    expect(oaHostArguments(base)).not.toContain("--game-password");
  });

  it("adds the map when one was picked", () => {
    expect(
      oaHostArguments({ ...base, map: "Comet Catcher" }).slice(-2),
    ).toEqual(["--map", "Comet Catcher"]);
  });

  it("never asks for a limit above OA's", () => {
    expect(oaHostArguments({ ...base, maxPlayers: 32 })).toContain("10");
  });

  it("leaves out the local network options", () => {
    const args = oaHostArguments({ ...base, map: "Comet Catcher" });
    expect(args).not.toContain("--dplay-guid");
    expect(args).not.toContain("--dplay-port");
  });
});

describe("oaJoinArguments", () => {
  const base = {
    battleId: 4021,
    username: "abcdefghijklmnopqrst",
    hostIp: "203.0.113.9",
    password: null,
  };
  const noPassword = [
    "--join",
    "203.0.113.9",
    "--player-name",
    "abcdefghijklmnop",
    "--game-name",
    "CB4021",
  ];

  it("joins the lobby's address under the battle's room name", () => {
    expect(oaJoinArguments(base)).toEqual(noPassword);
  });

  it("passes the key the player typed", () => {
    expect(oaJoinArguments({ ...base, password: "s3cret" })).toEqual([
      ...noPassword,
      "--game-password",
      "s3cret",
    ]);
  });

  it("leaves out a key OA would refuse, which no OA room can have", () => {
    expect(oaJoinArguments({ ...base, password: "12345678901" })).toEqual(
      noPassword,
    );
  });
});

describe("oaPasswordTooLong", () => {
  it("allows 10 characters and refuses 11", () => {
    expect(oaPasswordTooLong("1234567890")).toBe(false);
    expect(oaPasswordTooLong("12345678901")).toBe(true);
  });

  it("counts what the form sends, without the outer spaces", () => {
    expect(oaPasswordTooLong("  1234567890  ")).toBe(false);
  });
});

describe("isOaBattle", () => {
  it("is true for the engine name an OA host sends", () => {
    expect(isOaBattle({ engine: "Open Annihilation" })).toBe(true);
  });

  it.each([
    "spring",
    "recoil",
    "",
    "Another Engine",
  ])("is false for %j", (engine) => {
    expect(isOaBattle({ engine })).toBe(false);
  });
});
