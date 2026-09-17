import { describe, expect, it, vi } from "vitest";

// matchmaking.ts pulls in protocol.ts for `matchFoundKeys`, which reads the
// server catalog from lobby-servers/config. Same leaf-stubbing as
// protocol.test.ts: nothing here calls either mock, it just has to load.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { BUILTIN_SERVERS, type LobbyServer } from "../lobby-servers/config";
import type { LobbyState, Matchmaking, MatchQueue } from "./bindings";
import { type Connections, newConnection } from "./connections";
import {
  countdown,
  describeQueue,
  matchFoundKeys,
  matchLaunchBlockReason,
  searchingIn,
  secondsLeft,
} from "./matchmaking";

function queue(id: string, name: string, ranked = true): MatchQueue {
  return {
    id,
    name,
    teams: 2,
    teamSize: 1,
    ranked,
    maps: ["Theta Crystals 1.3"],
    games: ["Beyond All Reason test-27414"],
    engines: ["2025.01.6"],
  };
}

function state(partial: Partial<Matchmaking> = {}): Matchmaking {
  return {
    supported: true,
    queues: [],
    searching: [],
    found: null,
    ...partial,
  };
}

describe("secondsLeft", () => {
  it("rounds up so the last part second still reads as a second", () => {
    expect(secondsLeft(10_500, 0)).toBe(11);
  });

  it("never goes below zero once the deadline has passed", () => {
    expect(secondsLeft(1_000, 9_000)).toBe(0);
  });
});

describe("countdown", () => {
  it("pads the seconds", () => {
    expect(countdown(65)).toBe("1:05");
    expect(countdown(9)).toBe("0:09");
  });
});

describe("describeQueue", () => {
  it("says the shape and whether it counts", () => {
    expect(describeQueue(queue("1v1", "Duel"))).toBe("2 teams of 1, ranked");
    expect(describeQueue(queue("1v1", "Duel", false))).toBe("2 teams of 1");
  });
});

describe("searchingIn", () => {
  it("names each queue we are searching in", () => {
    const mm = state({ queues: [queue("1v1", "Duel")], searching: ["1v1"] });
    expect(searchingIn(mm)).toEqual(["Duel"]);
  });

  // A party member can put us into a queue the list never described.
  it("falls back to the id for a queue we have no description of", () => {
    const mm = state({ searching: ["2v2"] });
    expect(searchingIn(mm)).toEqual(["2v2"]);
  });
});

describe("matchFoundKeys", () => {
  const tachyon = BUILTIN_SERVERS.find((s) => s.id === "bar-tachyon");
  if (!tachyon) throw new Error("no bar-tachyon built-in server");
  const bar = BUILTIN_SERVERS.find((s) => s.id === "bar-ssl");
  if (!bar) throw new Error("no bar-ssl built-in server");
  const custom: LobbyServer = {
    id: "mine",
    name: "Mine",
    host: "lobby.example",
    port: 443,
    tls: true,
    allowSelfSigned: false,
    protocol: "tachyon",
  };
  const servers = [...BUILTIN_SERVERS, custom];

  const t1 = `p@${tachyon.host}:${tachyon.port}`;
  const t2 = "q@lobby.example:443";
  const bar1 = `p@${bar.host}:${bar.port}`;

  function withFound(key: string, found: boolean, live = true) {
    const c = newConnection(key);
    return {
      ...c,
      live,
      mirror: {
        ...c.mirror,
        state: {
          matchmaking: state({
            found: found
              ? { queueId: "1v1", readyBy: 0, readyCount: 0, readied: false }
              : null,
          }),
        } as unknown as LobbyState,
      },
    };
  }

  function conns(...entries: ReturnType<typeof withFound>[]): Connections {
    return Object.fromEntries(entries.map((e) => [e.serverKey, e]));
  }

  it("finds the Tachyon connection with a match waiting", () => {
    expect(
      matchFoundKeys(
        conns(withFound(t1, true), withFound(t2, false)),
        servers,
        null,
      ),
    ).toEqual([t1]);
  });

  it("finds a match on every Tachyon connection that has one", () => {
    expect(
      matchFoundKeys(
        conns(withFound(t1, true), withFound(t2, true)),
        servers,
        null,
      ),
    ).toEqual([t1, t2]);
  });

  it("ignores a non-Tachyon connection even with a match-shaped state", () => {
    expect(matchFoundKeys(conns(withFound(bar1, true)), servers, null)).toEqual(
      [],
    );
  });

  it("is empty when nothing has matched", () => {
    expect(matchFoundKeys(conns(withFound(t1, false)), servers, null)).toEqual(
      [],
    );
  });
});

describe("matchLaunchBlockReason", () => {
  const name = (key: string) => (key === "A" ? "Server A" : "Server B");

  it("blocks on a game already running, before anything else", () => {
    expect(matchLaunchBlockReason(true, "A", "A", name)).toContain(
      "already running",
    );
  });

  it("names the other connection whose battle room owns the launch", () => {
    expect(matchLaunchBlockReason(false, "A", "B", name)).toBe(
      "Server A owns the current battle room, so accepting this match would start a second game.",
    );
  });

  it("says so when it is this connection's own battle room", () => {
    expect(matchLaunchBlockReason(false, "A", "A", name)).toBe(
      "You are already in a battle here, so accepting this match would start a second game.",
    );
  });

  it("is null to go ahead when nothing is running and no lobby is joined", () => {
    expect(matchLaunchBlockReason(false, null, "A", name)).toBeNull();
  });
});
