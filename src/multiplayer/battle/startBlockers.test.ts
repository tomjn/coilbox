import { describe, expect, it } from "vitest";
import type { MemberRow } from "./config";
import { startAnywayWarning, unsyncedPlayers } from "./startBlockers";

const row = (p: Partial<MemberRow> & { name: string }): MemberRow => ({
  kind: "human",
  self: false,
  host: false,
  boss: false,
  ready: true,
  sync: 1,
  spectator: false,
  teamId: 0,
  ally: 0,
  side: 0,
  colorHex: "#000000",
  handicap: 0,
  ...p,
});

describe("unsyncedPlayers", () => {
  it("names a playing human who says they cannot play", () => {
    expect(
      unsyncedPlayers([
        row({ name: "alice", self: true, host: true }),
        row({ name: "bob", sync: 2 }),
        row({ name: "carol" }),
      ]),
    ).toEqual(["bob"]);
  });

  it("says nothing about a room where everybody is synced", () => {
    expect(
      unsyncedPlayers([row({ name: "alice" }), row({ name: "bob" })]),
    ).toEqual([]);
  });

  // Sync 0 is a client that has not answered yet, not a client that cannot
  // play. Warning off it would be the same false verdict mid-scan that
  // `launchBlock` refuses to give.
  it("does not treat a scan that has not finished as a refusal", () => {
    expect(unsyncedPlayers([row({ name: "bob", sync: 0 })])).toEqual([]);
  });

  it("ignores a spectator, a bot and the host's own row", () => {
    expect(
      unsyncedPlayers([
        row({ name: "alice", self: true, sync: 2 }),
        row({ name: "bob", sync: 2, spectator: true }),
        row({ name: "Barb", kind: "bot", sync: 2 }),
      ]),
    ).toEqual([]);
  });
});

describe("startAnywayWarning", () => {
  it("says nothing when nobody is blocking", () => {
    expect(startAnywayWarning([])).toBeNull();
  });

  it("names one person and what starting does", () => {
    expect(startAnywayWarning(["bob"])).toBe(
      "bob does not have this battle's map or game. Start now and the match runs without them.",
    );
  });

  it("reads as a sentence with two and with three", () => {
    expect(startAnywayWarning(["bob", "carol"])).toBe(
      "bob and carol do not have this battle's map or game. Start now and the match runs without them.",
    );
    expect(startAnywayWarning(["bob", "carol", "dave"])).toBe(
      "bob, carol and dave do not have this battle's map or game. Start now and the match runs without them.",
    );
  });
});
