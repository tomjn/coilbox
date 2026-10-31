import { describe, expect, it } from "vitest";
import type { Participant } from "@/play/participants";
import {
  type HostStepsIo,
  runHostSteps,
  settingAnswer,
  teamShape,
} from "./hostSteps";
import {
  AUTOHOST_COMMAND_GAP_MS,
  confirmTimeoutMs,
  VOTE_WAIT_MS,
} from "./tweakDelivery";

const player = (
  id: string,
  allyTeam: number,
  over: Partial<Participant> = {},
): Participant => ({
  id,
  kind: "ai",
  name: id,
  side: "",
  color: [0.5, 0.5, 0.5],
  allyTeam,
  spectator: false,
  ...over,
});

describe("teamShape", () => {
  it("counts ally teams, and the most teams any one of them holds", () => {
    expect(
      teamShape([
        player("a", 0, { kind: "you" }),
        player("b", 0),
        player("c", 0),
        player("d", 1),
        player("e", 1),
      ]),
    ).toEqual({ nbTeams: 2, teamSize: 3 });
  });

  it("counts rows that share a team slot as one team", () => {
    expect(
      teamShape([
        player("a", 0, { team: 0 }),
        player("b", 0, { team: 0 }),
        player("c", 1, { team: 1 }),
      ]),
    ).toEqual({ nbTeams: 2, teamSize: 1 });
  });

  it("leaves out a spectating you", () => {
    expect(
      teamShape([
        player("a", 0, { kind: "you", spectator: true }),
        player("b", 1),
      ]),
    ).toEqual({ nbTeams: 1, teamSize: 1 });
  });

  it("is null when nobody plays", () => {
    expect(
      teamShape([player("a", 0, { kind: "you", spectator: true })]),
    ).toBeNull();
  });
});

describe("settingAnswer", () => {
  it("reads SPADS announcing the change", () => {
    expect(
      settingAnswer(
        ["Global setting changed by Tom (teamSize=4)"],
        "teamSize",
        4,
      ),
    ).toEqual({ took: true });
  });

  it("reads SPADS saying the value was already there", () => {
    expect(
      settingAnswer(
        ['Global setting "nbTeams" is already set to value "2"'],
        "nbTeams",
        2,
      ),
    ).toEqual({ took: true });
  });

  it("reports another value when somebody set one in between", () => {
    expect(
      settingAnswer(
        ["Global setting changed by Sam (teamSize=8)"],
        "teamSize",
        4,
      ),
    ).toEqual({ took: false, holds: "8" });
  });

  it("ignores another setting's answer and unrelated chat", () => {
    expect(
      settingAnswer(
        ["Global setting changed by Tom (nbTeams=2)", "gl hf"],
        "teamSize",
        4,
      ),
    ).toBeNull();
  });
});

/** A room whose clock moves only when a step sleeps, so waits cost nothing. */
function fakeRoom(
  reply: (line: string, at: number) => string | null,
  map = "Old Map",
  leavesAfterSends = Number.POSITIVE_INFINITY,
) {
  let clock = 1000;
  const said: { at: number; text: string }[] = [];
  const sent: { line: string; at: number }[] = [];
  const state = { map };
  // Lines the host says, and maps it moves to, at a fixed time after the start.
  const timeline: { at: number; text: string; map?: string }[] = [];
  const later = (afterMs: number, text: string, toMap?: string) =>
    timeline.push({ at: 1000 + afterMs, text, map: toMap });
  const io: HostStepsIo = {
    async send(line) {
      sent.push({ line, at: clock });
      const text = reply(line, clock);
      if (text) said.push({ at: clock, text });
      const mapMatch = /^!map (.+)$/.exec(line);
      if (mapMatch && text === "map changed") state.map = mapMatch[1];
    },
    hostSaidSince: (at) => [
      ...said
        .filter((m) => m.at >= at && m.text !== "map changed")
        .map((m) => m.text),
      ...timeline.filter((m) => m.at >= at && m.at <= clock).map((m) => m.text),
    ],
    currentMap: () =>
      [...timeline].reverse().find((m) => m.map !== undefined && m.at <= clock)
        ?.map ?? state.map,
    here: () => sent.length < leavesAfterSends,
    async sleep(ms) {
      clock += ms;
    },
    now: () => clock,
  };
  return { io, sent, said, later };
}

describe("runHostSteps", () => {
  it("sends the map, then the size, then the count, and reports nothing when all take", async () => {
    const room = fakeRoom((line) =>
      line.startsWith("!map ")
        ? "map changed"
        : `Global setting changed by Tom (${line.split(" ")[1]}=${line.split(" ")[2]})`,
    );
    const { failures } = await runHostSteps(
      { map: "New Map", teamSize: 4, nbTeams: 2 },
      room.io,
    );
    expect(failures).toEqual([]);
    expect(room.sent.map((s) => s.line)).toEqual([
      "!map New Map",
      "!set teamSize 4",
      "!set nbTeams 2",
    ]);
  });

  it("leaves at least the autohost's command gap between sends", async () => {
    const room = fakeRoom((line) =>
      line.startsWith("!map ")
        ? "map changed"
        : `Global setting changed by Tom (${line.split(" ")[1]}=${line.split(" ")[2]})`,
    );
    await runHostSteps({ map: "New Map", teamSize: 4, nbTeams: 2 }, room.io);
    for (let i = 1; i < room.sent.length; i += 1)
      expect(room.sent[i].at - room.sent[i - 1].at).toBeGreaterThanOrEqual(
        AUTOHOST_COMMAND_GAP_MS,
      );
  });

  it("names a setting the host refused, in the host's words, and still sends the rest", async () => {
    const room = fakeRoom((line) =>
      line === "!set teamSize 40"
        ? 'Value "40" for global setting "teamSize" is not allowed in current preset'
        : line.startsWith("!set nbTeams")
          ? "Global setting changed by Tom (nbTeams=2)"
          : null,
    );
    const { failures } = await runHostSteps(
      { teamSize: 40, nbTeams: 2 },
      room.io,
    );
    expect(failures).toEqual([
      {
        step: "teamSize",
        reason:
          'Value "40" for global setting "teamSize" is not allowed in current preset',
      },
    ]);
    expect(room.sent.map((s) => s.line)).toEqual([
      "!set teamSize 40",
      "!set nbTeams 2",
    ]);
  });

  it("waits the confirmation timeout a short !bSet gets, then calls a silent room a failure", async () => {
    const room = fakeRoom(() => null);
    const start = 1000;
    const { failures } = await runHostSteps({ nbTeams: 2 }, room.io);
    expect(failures).toHaveLength(1);
    expect(failures[0].step).toBe("nbTeams");
    const waited = (await room.io.now()) - start;
    expect(waited).toBeGreaterThanOrEqual(
      confirmTimeoutMs("!set nbTeams 2".length, true),
    );
  });

  it("reports a map change that never showed up in the room", async () => {
    const room = fakeRoom((line) =>
      line.startsWith("!map ") ? "Could not find matching map" : null,
    );
    const { failures } = await runHostSteps({ map: "New Map" }, room.io);
    expect(failures).toEqual([
      { step: "map", reason: "Could not find matching map" },
    ]);
  });

  it("takes a map the room already shows, whatever its case", async () => {
    const room = fakeRoom(() => null, "new map");
    expect((await runHostSteps({ map: "New Map" }, room.io)).failures).toEqual(
      [],
    );
  });

  describe("when the autohost puts a step to a vote", () => {
    const called = (command: string) =>
      `alice called a vote for command "${command}" [!vote y, !vote n, !vote b]`;

    it("counts a setting as taken when the vote passes and the host then applies it", async () => {
      const room = fakeRoom(() => null);
      room.later(500, called("set teamSize 4"));
      room.later(30_000, 'Vote for command "set teamSize 4" passed.');
      room.later(30_000, "Global setting changed by alice (teamSize=4)");
      const result = await runHostSteps({ teamSize: 4 }, room.io);
      expect(result.failures).toEqual([]);
      // The vote outlasted what an echo is given, so this only passes because
      // the step waited for the vote.
      expect(30_000).toBeGreaterThan(
        confirmTimeoutMs("!set teamSize 4".length, true),
      );
    });

    it("says the vote did not pass when it fails, not that the setting was refused", async () => {
      const room = fakeRoom((line) =>
        line.startsWith("!set nbTeams")
          ? "Global setting changed by Tom (nbTeams=2)"
          : null,
      );
      room.later(500, called("set teamSize 4"));
      room.later(20_000, 'Vote for command "set teamSize 4" failed.');
      const result = await runHostSteps({ teamSize: 4, nbTeams: 2 }, room.io);
      expect(result.failures).toEqual([
        { step: "teamSize", reason: "The room's vote on it did not pass." },
      ]);
      // A failed vote on one part is no reason to skip the next.
      expect(room.sent.map((s) => s.line)).toEqual([
        "!set teamSize 4",
        "!set nbTeams 2",
      ]);
    });

    it("reads a vote that failed when its time ran out the same way", async () => {
      const room = fakeRoom(() => null);
      room.later(500, called("set nbTeams 2"));
      room.later(
        45_000,
        'Vote for command "set nbTeams 2" failed (delay expired).',
      );
      const result = await runHostSteps({ nbTeams: 2 }, room.io);
      expect(result.failures).toEqual([
        { step: "nbTeams", reason: "The room's vote on it did not pass." },
      ]);
    });

    it("reports a vote that never reports, after the wait a vote is given", async () => {
      const room = fakeRoom(() => null);
      room.later(500, called("set teamSize 4"));
      const result = await runHostSteps({ teamSize: 4 }, room.io);
      expect(result.failures).toEqual([
        {
          step: "teamSize",
          reason: "The room's vote on it was still open after 53s.",
        },
      ]);
      expect((await room.io.now()) - 1000).toBeGreaterThanOrEqual(VOTE_WAIT_MS);
    });

    it("reports what the room holds when a passed vote lands on another value", async () => {
      const room = fakeRoom(() => null);
      room.later(500, called("set teamSize 4"));
      room.later(10_000, 'Vote for command "set teamSize 4" passed.');
      room.later(10_000, "Global setting changed by alice (teamSize=8)");
      const result = await runHostSteps({ teamSize: 4 }, room.io);
      expect(result.failures).toEqual([
        { step: "teamSize", reason: "The room is set to 8." },
      ]);
    });

    it("does not take a vote on some other setting for its own", async () => {
      const room = fakeRoom(() => null);
      room.later(500, called("set nbTeams 2"));
      const result = await runHostSteps({ teamSize: 4 }, room.io);
      // Not waited out as a vote: the step gives up after an echo's wait and
      // quotes what the host said.
      expect(result.failures).toEqual([
        { step: "teamSize", reason: called("set nbTeams 2") },
      ]);
      expect((await room.io.now()) - 1000).toBeLessThan(VOTE_WAIT_MS);
    });

    it("waits for a vote on the map, which SPADS reads as set map", async () => {
      const room = fakeRoom(() => null);
      room.later(500, called("set map New Map"));
      room.later(15_000, 'Vote for command "set map New Map" passed.');
      room.later(15_000, "Map changed by alice: New Map", "New Map");
      const result = await runHostSteps({ map: "New Map" }, room.io);
      expect(result.failures).toEqual([]);
    });

    it("says a map vote did not pass", async () => {
      const room = fakeRoom(() => null);
      room.later(500, called("set map New Map"));
      room.later(12_000, 'Vote for command "set map New Map" failed.');
      const result = await runHostSteps({ map: "New Map" }, room.io);
      expect(result.failures).toEqual([
        { step: "map", reason: "The room's vote on it did not pass." },
      ]);
    });

    it("treats a vote someone cancels as one that did not pass", async () => {
      const room = fakeRoom(() => null);
      room.later(500, called("set teamSize 4"));
      room.later(5_000, "Vote cancelled by bob");
      const result = await runHostSteps({ teamSize: 4 }, room.io);
      expect(result.failures).toEqual([
        { step: "teamSize", reason: "The room's vote on it did not pass." },
      ]);
    });
  });

  it("sends nothing when there are no steps", async () => {
    const room = fakeRoom(() => null);
    expect((await runHostSteps({}, room.io)).failures).toEqual([]);
    expect(room.sent).toEqual([]);
  });

  it("stops sending when the player has left the room, and says so", async () => {
    // The room is gone after the first command, so neither setting may be sent
    // to whichever battle the player is in now.
    const room = fakeRoom(() => null, "Old Map", 1);
    const result = await runHostSteps(
      { map: "New Map", teamSize: 4, nbTeams: 2 },
      room.io,
    );
    expect(result.left).toBe(true);
    expect(room.sent.map((s) => s.line)).toEqual(["!map New Map"]);
    expect(result.failures).toEqual([]);
  });

  it("sends nothing at all if the player is already gone", async () => {
    const room = fakeRoom(() => null, "Old Map", 0);
    const result = await runHostSteps({ teamSize: 4 }, room.io);
    expect(result.left).toBe(true);
    expect(room.sent).toEqual([]);
  });
});
