import { describe, expect, it } from "vitest";
import type {
  BuildOrder,
  DemoBuildOrders,
  DemoInfo,
  DemoTrailer,
  RecordedPick,
  TeamStatSample,
  UnitDatasetEntry,
} from "./bindings";
import { signedInLobbyNames, userNameInReplay } from "./replayHubName";
import { buildReplaySummary } from "./replaySummary";

function info(patch: Partial<DemoInfo> = {}): DemoInfo {
  return {
    engineVersion: "2025.04.10",
    gameId: "9f2c4b1ad07e5386c1f4a92b6e8d0375",
    startTimeMs: 1_777_320_845_000,
    durationSec: 754,
    wallclockSec: 800,
    mapName: "Comet Catcher Redux",
    gameType: "Beyond All Reason test-1",
    winningAllyTeams: [1],
    winnersKnown: true,
    numAllyTeams: 2,
    allyTeams: [],
    players: [
      {
        player: 0,
        name: "Alice",
        team: 0,
        allyTeam: 0,
        side: "Armada",
        spectator: false,
      },
      {
        player: 1,
        name: "Bob",
        team: 1,
        allyTeam: 1,
        side: "Cortex",
        spectator: false,
      },
      { player: 2, name: "Carol", spectator: true },
    ],
    ais: [],
    modOptions: {},
    mapOptions: {},
    startPositions: [
      { team: 0, x: 100.5, y: 3, z: 200.25 },
      { team: 1, x: 900, y: 3, z: 800 },
    ],
    ...patch,
  };
}

function sample(frame: number, metalUsed: number): TeamStatSample {
  return {
    frame,
    metalUsed,
    energyUsed: 2,
    metalProduced: 3,
    energyProduced: 4,
    metalExcess: 0.1,
    energyExcess: 0,
    metalReceived: 0,
    energyReceived: 0,
    metalSent: 0,
    energySent: 0,
    damageDealt: 10,
    damageReceived: 11,
    unitsProduced: 5,
    unitsDied: 1,
    unitsReceived: 0,
    unitsSent: 0,
    unitsCaptured: 0,
    unitsOutCaptured: 0,
    unitsKilled: 2,
  };
}

const trailer: DemoTrailer = {
  winningAllyTeams: [1],
  teamStatPeriodSec: 15,
  teams: [
    { team: 0, samples: [sample(450, 1), sample(900, 7)] },
    { team: 1, samples: [sample(900, 9)] },
    { team: 2, samples: [] },
  ],
};

function order(
  frame: number,
  team: number | undefined,
  unitDefId: number,
): BuildOrder {
  return {
    frame,
    player: team ?? 0,
    team,
    origin: { kind: "player" } as unknown as BuildOrder["origin"],
    unitDefId,
    count: 1,
    slot: { kind: "append" } as BuildOrder["slot"],
    builders: 1,
    options: 0,
  };
}

function orders(patch: Partial<DemoBuildOrders> = {}): DemoBuildOrders {
  return {
    orders: [
      order(30, 1, 2),
      order(10, 0, 1),
      order(40, 0, 2),
      order(50, undefined, 3),
    ],
    players: [],
    removals: 0,
    lastFrame: 22620,
    incomplete: false,
    ...patch,
  };
}

const units: UnitDatasetEntry[] = [
  {
    name: "armcom",
    fullName: "Commander",
    stats: { metalCost: 2700, energyCost: 26000, buildTime: 75000 },
  },
  {
    name: "armsolar",
    fullName: "Solar Collector",
    stats: { metalCost: 155, energyCost: 0 },
  },
];

describe("buildReplaySummary", () => {
  it("builds the hub's summary from the page's reads", () => {
    const made = buildReplaySummary(info(), trailer, orders(), units, []);
    if (!("summary" in made)) throw new Error(JSON.stringify(made));
    const { summary } = made;
    expect(summary).toMatchObject({
      v: 1,
      engine: "2025.04.10",
      game: "Beyond All Reason test-1",
      map: "Comet Catcher Redux",
      started_at: 1_777_320_845,
      duration: 754,
      winners: [1],
      spectators: ["Carol"],
    });
    expect(summary.players).toEqual([
      { name: "Alice", team: 0, ally_team: 0, faction: "Armada" },
      { name: "Bob", team: 1, ally_team: 1, faction: "Cortex" },
    ]);
    // Only teams with samples, each with its last.
    expect(summary.totals.map((t) => [t.team, t.metal_used])).toEqual([
      [0, 7],
      [1, 9],
    ]);
    expect(Object.keys(summary.totals[0])).toHaveLength(20);
    expect(summary.totals[0].metal_excess).toBe(0.1);
    expect(summary.start_positions).toEqual([
      { team: 0, x: 100.5, z: 200.25 },
      { team: 1, x: 900, z: 800 },
    ]);
    // By team, each in the order given, and an order with no team left out.
    expect(summary.build_orders).toEqual([
      {
        team: 0,
        orders: [
          { frame: 10, unit_def_id: 1 },
          { frame: 40, unit_def_id: 2 },
        ],
      },
      { team: 1, orders: [{ frame: 30, unit_def_id: 2 }] },
    ]);
    expect(summary.units).toEqual([
      {
        unit_def_id: 1,
        name: "armcom",
        display_name: "Commander",
        metal: 2700,
        energy: 26000,
        build_time: 75000,
        category: expect.any(String),
      },
      {
        unit_def_id: 2,
        name: "armsolar",
        display_name: "Solar Collector",
        metal: 155,
        energy: 0,
        build_time: null,
        category: expect.any(String),
      },
    ]);
  });

  it("names a unit as the replay's own list does", () => {
    const made = buildReplaySummary(
      info(),
      trailer,
      orders({ unitNames: ["ArmCom", "armsolar"] }),
      units,
      [],
    );
    if (!("summary" in made)) throw new Error("no summary");
    expect(made.summary.units[0].name).toBe("ArmCom");
  });

  it("refuses a recording with no game over", () => {
    expect(
      buildReplaySummary(
        info({ winnersKnown: false }),
        trailer,
        orders(),
        units,
        [],
      ),
    ).toEqual({ problem: { kind: "unfinished" } });
  });

  it("refuses build orders the walk did not finish", () => {
    expect(
      buildReplaySummary(
        info(),
        trailer,
        orders({ incomplete: true }),
        units,
        [],
      ),
    ).toEqual({ problem: { kind: "incompleteOrders" } });
  });

  it("refuses a unit no list says the cost of", () => {
    expect(
      buildReplaySummary(
        info(),
        trailer,
        orders(),
        [units[0], { name: "armsolar" }],
        [],
      ),
    ).toEqual({ problem: { kind: "unknownUnit", unitDefId: 2 } });
    expect(
      buildReplaySummary(info(), trailer, orders(), [units[0]], []),
    ).toEqual({
      problem: { kind: "unknownUnit", unitDefId: 2 },
    });
  });

  it("sends a side the script does not have as null", () => {
    const made = buildReplaySummary(
      info({
        players: [{ name: "Alice", team: 0, allyTeam: 0, spectator: false }],
      }),
      trailer,
      orders({ orders: [] }),
      [],
      [],
    );
    if (!("summary" in made)) throw new Error("no summary");
    expect(made.summary.players[0].faction).toBeNull();
    expect(made.summary.units).toEqual([]);
  });
});

describe("buildReplaySummary and a faction picked in the match", () => {
  const sides = [
    { name: "Armada", startUnit: "armcom" },
    { name: "Legion", startUnit: "legcom" },
  ];
  const list: UnitDatasetEntry[] = [
    ...units,
    { name: "legcom", stats: { metalCost: 2700, energyCost: 26000 } },
  ];
  const picked = (pick: RecordedPick) =>
    info({
      players: [
        {
          name: "Alice",
          team: 0,
          allyTeam: 0,
          side: "Armada",
          pick,
          spectator: false,
        },
      ],
    });
  const summaryOf = (
    pick: RecordedPick,
    given: DemoBuildOrders = orders({ orders: [order(10, 0, 1)] }),
    from: UnitDatasetEntry[] = list,
  ) => {
    const made = buildReplaySummary(picked(pick), trailer, given, from, sides);
    if (!("summary" in made)) throw new Error(JSON.stringify(made));
    return made.summary;
  };

  it("sends the picked side and lists the unit nobody built", () => {
    const summary = summaryOf({ frame: 41, unitDefId: 3 });
    expect(summary.players[0].faction).toBe("Legion");
    expect(summary.units.map((u) => [u.unit_def_id, u.name])).toEqual([
      [1, "armcom"],
      [3, "legcom"],
    ]);
  });

  it("names a picked unit as the replay's own list does", () => {
    const summary = summaryOf(
      { frame: -1, unitDefId: 3, unit: "legcom" },
      orders({ orders: [], unitNames: ["armcom", "armsolar", "legcom"] }),
    );
    expect(summary.players[0].faction).toBe("Legion");
    expect(summary.units.map((u) => u.name)).toEqual(["legcom"]);
  });

  it("lists a unit once when it was both picked and built", () => {
    const summary = summaryOf({ frame: -1, unitDefId: 1 });
    expect(summary.units.map((u) => u.unit_def_id)).toEqual([1]);
  });

  it("leaves out a picked unit nothing names and still sends", () => {
    const summary = summaryOf({ frame: -1, unitDefId: 9 });
    expect(summary.players[0].faction).toBeNull();
    expect(summary.units.map((u) => u.unit_def_id)).toEqual([1]);
  });

  it("sends a picked name as it was sent", () => {
    const summary = summaryOf({ frame: -1, name: "legion" });
    expect(summary.players[0].faction).toBe("legion");
  });
});

describe("the user's name in a replay", () => {
  it("takes every login that has connected, and the last login", () => {
    expect(
      signedInLobbyNames(
        [
          { serverId: "a", username: "Alice", lastUsedAt: 5 },
          { serverId: "b", username: "Never" },
          { serverId: "c", username: "Old" },
        ],
        { serverId: "c", username: "Old" },
      ),
    ).toEqual(["Alice", "Old"]);
  });

  it("finds a player or a spectator, as the replay spells them", () => {
    expect(userNameInReplay(info(), ["Bob"])).toBe("Bob");
    expect(userNameInReplay(info(), ["carol"])).toBe("Carol");
    expect(userNameInReplay(info(), ["Dave"])).toBeNull();
    expect(userNameInReplay(info(), [])).toBeNull();
  });
});
