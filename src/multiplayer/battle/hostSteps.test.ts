import { describe, expect, it } from "vitest";
import type { Participant } from "@/play/participants";
import {
  type HostStepsIo,
  runHostSteps,
  settingAnswer,
  teamShape,
} from "./hostSteps";
import { AUTOHOST_COMMAND_GAP_MS, confirmTimeoutMs } from "./tweakDelivery";

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
) {
  let clock = 1000;
  const said: { at: number; text: string }[] = [];
  const sent: { line: string; at: number }[] = [];
  const state = { map };
  const io: HostStepsIo = {
    async send(line) {
      sent.push({ line, at: clock });
      const text = reply(line, clock);
      if (text) said.push({ at: clock, text });
      const mapMatch = /^!map (.+)$/.exec(line);
      if (mapMatch && text === "map changed") state.map = mapMatch[1];
    },
    hostSaidSince: (at) =>
      said
        .filter((m) => m.at >= at && m.text !== "map changed")
        .map((m) => m.text),
    currentMap: () => state.map,
    async sleep(ms) {
      clock += ms;
    },
    now: () => clock,
  };
  return { io, sent, said };
}

describe("runHostSteps", () => {
  it("sends the map, then the size, then the count, and reports nothing when all take", async () => {
    const room = fakeRoom((line) =>
      line.startsWith("!map ")
        ? "map changed"
        : `Global setting changed by Tom (${line.split(" ")[1]}=${line.split(" ")[2]})`,
    );
    const failures = await runHostSteps(
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
    const failures = await runHostSteps({ teamSize: 40, nbTeams: 2 }, room.io);
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
    const failures = await runHostSteps({ nbTeams: 2 }, room.io);
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
    const failures = await runHostSteps({ map: "New Map" }, room.io);
    expect(failures).toEqual([
      { step: "map", reason: "Could not find matching map" },
    ]);
  });

  it("takes a map the room already shows, whatever its case", async () => {
    const room = fakeRoom(() => null, "new map");
    expect(await runHostSteps({ map: "New Map" }, room.io)).toEqual([]);
  });

  it("sends nothing when there are no steps", async () => {
    const room = fakeRoom(() => null);
    expect(await runHostSteps({}, room.io)).toEqual([]);
    expect(room.sent).toEqual([]);
  });
});
