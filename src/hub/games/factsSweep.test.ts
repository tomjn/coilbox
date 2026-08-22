import { describe, expect, it, vi } from "vitest";
import type { GameItem, Side, UnitDatasetEntry } from "@/content/bindings";
import { MUTATOR_FOLDER, SCRATCH_FOLDER } from "@/lib/generatedGames";
import type { GameFacts, GameFactsResult } from "./facts";
import {
  factionKeys,
  type GameSweepTools,
  gameFactions,
  gameSweepSummary,
  gamesToSend,
  sweepGameFacts,
} from "./factsSweep";

const target = {
  hubUrl: "https://hub.example",
  enginePath: "/engines/105",
  dataDir: "/data",
};

function game(
  name: string,
  archive: string,
  info: Record<string, string> = {},
): GameItem {
  return {
    name,
    primaryArchive: { name: archive },
    dependencyArchives: [],
    info: { shortname: "BA", version: "12.24", ...info },
  };
}

function unit(
  name: string,
  buildOptions: string[] = [],
  fullName?: string,
  stats?: Record<string, unknown>,
): UnitDatasetEntry {
  return {
    name,
    buildOptions,
    ...(fullName ? { fullName } : {}),
    ...(stats ? { stats } : {}),
  };
}

/**
 * A machine holding `games`, whose archives each answer with `sides` and
 * `units`, and a hub that takes everything.
 *
 * `units` and `sides` are keyed by primary archive name, so a test can give two
 * games different unit graphs.
 */
function tools(
  games: GameItem[],
  units: Record<string, UnitDatasetEntry[]> = {},
  sides: Record<string, Side[]> = {},
  outcomes: GameFactsResult[] = [],
): GameSweepTools & { sent: () => GameFacts[]; mounted: () => string[] } {
  const sent: GameFacts[] = [];
  const mounted: string[] = [];
  return {
    scan: vi.fn(async () => ({
      maps: [],
      games,
      errors: [],
    })) as unknown as GameSweepTools["scan"],
    info: vi.fn(async ({ gameArchive }: { gameArchive: string }) => {
      mounted.push(gameArchive);
      return {
        sides: sides[gameArchive] ?? [{ name: "Armada", startUnit: "armcom" }],
        unitCount: 0,
        units: [],
        options: [],
        errors: [],
      };
    }) as unknown as GameSweepTools["info"],
    dataset: vi.fn(async ({ gameArchive }: { gameArchive: string }) => ({
      units: units[gameArchive] ?? [unit("armcom")],
      errors: [],
    })) as unknown as GameSweepTools["dataset"],
    send: vi.fn(async (_hubUrl: string, facts: GameFacts) => {
      sent.push(facts);
      return outcomes;
    }) as unknown as GameSweepTools["send"],
    releases: vi.fn(async () => ({
      md5s: [],
    })) as unknown as GameSweepTools["releases"],
    sent: () => sent,
    mounted: () => mounted,
  };
}

describe("gamesToSend", () => {
  /// The rule the whole issue rests on: a public catalog gets released games and
  /// nothing somebody is in the middle of editing.
  it("sends the packaged release and neither a working folder nor coilbox's own games", () => {
    const { sendable, skipped } = gamesToSend(
      [
        game("Balanced Annihilation 12.24", "ba1224.sdz"),
        game("SplinterFaction 0.1.78", "SplinterFaction.sdd", {
          shortname: "SF",
        }),
        game("Coilbox unit test scratch", SCRATCH_FOLDER, {
          shortname: "coilbox-lego",
        }),
        game("Coilbox mission test", MUTATOR_FOLDER, {
          shortname: "coilbox-mission",
        }),
      ],
      new Set<string>(),
    );

    expect(sendable.map((s) => s.game.name)).toEqual([
      "Balanced Annihilation 12.24",
    ]);
    expect(skipped).toEqual([
      { game: "SplinterFaction 0.1.78", reason: "development-folder" },
      { game: "Coilbox unit test scratch", reason: "development-folder" },
      { game: "Coilbox mission test", reason: "development-folder" },
    ]);
  });

  /// `release` is required, so a game with no version is a 400 for the whole
  /// submission. Skipping it with a reason beats sending it to be refused.
  it("skips a game whose modinfo declares no version", () => {
    const { sendable, skipped } = gamesToSend(
      [
        game("Nameless Mod", "nameless.sdz", { version: "  " }),
        game("Balanced Annihilation 12.24", "ba1224.sdz"),
      ],
      new Set<string>(),
    );

    expect(sendable.map((s) => s.game.name)).toEqual([
      "Balanced Annihilation 12.24",
    ]);
    expect(skipped).toEqual([{ game: "Nameless Mod", reason: "no-release" }]);
  });

  it("skips a game with no modinfo shortname, since the hub files games under one", () => {
    const { sendable, skipped } = gamesToSend(
      [game("Odd Mod", "odd.sdz", { shortname: "" })],
      new Set<string>(),
    );

    expect(sendable).toEqual([]);
    expect(skipped).toEqual([{ game: "Odd Mod", reason: "no-shortname" }]);
  });

  /// The hub holds one set of current facts per shortname, so two installs
  /// posted in one run would leave them pointing at whichever went last and the
  /// next run would move them again.
  it("sends one install per game, and the same one every time", () => {
    const installs = [
      game("SplinterFaction 0.1.77", "sf0177.sdz", { shortname: "SF" }),
      game("SplinterFaction 0.1.78", "sf0178.sdz", { shortname: "SF" }),
    ];

    const forwards = gamesToSend(installs, new Set<string>());
    const backwards = gamesToSend([...installs].reverse(), new Set<string>());

    expect(forwards.sendable.map((s) => s.game.name)).toEqual([
      "SplinterFaction 0.1.78",
    ]);
    expect(backwards.sendable.map((s) => s.game.name)).toEqual([
      "SplinterFaction 0.1.78",
    ]);
    expect(forwards.skipped).toEqual([
      { game: "SplinterFaction 0.1.77", reason: "another-install" },
    ]);
  });

  /// A commit snapshot is a private build. It never speaks for a game, even
  /// when it is the only install, because the catalog describes a game as its
  /// players know it.
  it("skips a rapid install no named tag points at, and sends nothing in its place", () => {
    const { sendable, skipped } = gamesToSend(
      [
        game("Beyond All Reason test-30922", "ded9b29714a05164.sdp", {
          shortname: "BYAR",
        }),
      ],
      new Set<string>(),
    );

    expect(sendable).toEqual([]);
    expect(skipped).toEqual([
      { game: "Beyond All Reason test-30922", reason: "snapshot-build" },
    ]);
  });

  /// Rapid is how most people install Beyond All Reason, so a rule that refused
  /// every pool install would keep the largest game out of the catalog.
  it("sends a rapid install a named tag points at", () => {
    const { sendable } = gamesToSend(
      [
        game("Beyond All Reason 1.2.3", "ded9b29714a05164.sdp", {
          shortname: "BYAR",
        }),
      ],
      new Set(["ded9b29714a05164"]),
    );

    expect(sendable.map((s) => s.game.name)).toEqual([
      "Beyond All Reason 1.2.3",
    ]);
  });

  /// The bug this rule exists for: a name holding `test-` beats a tagged
  /// version under a plain string comparison, because `t` sorts above `V`.
  it("prefers the packaged release over a snapshot whatever the two names sort like", () => {
    const { sendable, skipped } = gamesToSend(
      [
        game("Balanced Annihilation test-7183-001edc3", "cc956b0843d10d36.sdp"),
        game(
          "Balanced Annihilation V15.9.8",
          "balanced_annihilation-v15.9.8.sdz",
        ),
      ],
      new Set<string>(),
    );

    expect(sendable.map((s) => s.game.name)).toEqual([
      "Balanced Annihilation V15.9.8",
    ]);
    expect(skipped).toEqual([
      {
        game: "Balanced Annihilation test-7183-001edc3",
        reason: "snapshot-build",
      },
    ]);
  });
});

describe("factionKeys", () => {
  const units = [
    unit("armcom", ["armlab", "armsolar"]),
    unit("armlab", ["armflash"]),
    unit("armsolar"),
    unit("armflash"),
    unit("corcom", ["corlab"]),
    unit("corlab", ["corraid"]),
    unit("corraid"),
    unit("gaiatree"),
  ];
  const sides: Side[] = [
    { name: "Armada", startUnit: "armcom" },
    { name: "Cortex", startUnit: "corcom" },
  ];

  it("attributes a unit to the side whose start unit reaches it", () => {
    const keys = factionKeys(units, sides);

    expect(keys.get("armflash")).toBe("armada");
    expect(keys.get("corraid")).toBe("cortex");
    expect(keys.get("armcom")).toBe("armada");
  });

  it("leaves a unit no start unit reaches without a faction", () => {
    expect(factionKeys(units, sides).get("gaiatree")).toBeUndefined();
  });

  /// The forest keeps the first side to claim a start unit, and a unit two
  /// factions can build goes to whichever root reached it first, so a key is one
  /// answer rather than two.
  it("gives a unit both factions build one faction, the first", () => {
    const shared = [
      unit("armcom", ["shared"]),
      unit("corcom", ["shared"]),
      unit("shared"),
    ];

    expect(factionKeys(shared, sides).get("shared")).toBe("armada");
    expect(factionKeys(shared, [...sides].reverse()).get("shared")).toBe(
      "cortex",
    );
  });

  it("ignores a side with no start unit", () => {
    const keys = factionKeys(units, [...sides, { name: "Spectator" } as Side]);

    expect([...new Set(keys.values())].sort()).toEqual(["armada", "cortex"]);
  });
});

describe("gameFactions", () => {
  it("names a faction the way the modinfo names it, trimmed and nothing else", () => {
    expect(gameFactions([{ name: "  Armada ", startUnit: "armcom" }])).toEqual([
      { key: "armada", name: "Armada" },
    ]);
  });

  it("ignores a side with no start unit, the way the unit picker does", () => {
    expect(
      gameFactions([
        { name: "Armada", startUnit: "armcom" },
        { name: "Spectator" },
      ]),
    ).toEqual([{ key: "armada", name: "Armada" }]);
  });

  /// A duplicate key would be the hub writing one row twice, and the two
  /// spellings would take turns winning.
  it("makes two sides that lowercase to one key one faction", () => {
    expect(
      gameFactions([
        { name: "Armada", startUnit: "armcom" },
        { name: "ARMADA", startUnit: "arm2com" },
      ]),
    ).toEqual([{ key: "armada", name: "Armada" }]);
  });
});

describe("sweepGameFacts", () => {
  /// The join the hub does at read time is exact, so the key a unit carries and
  /// the key the faction is filed under have to come out of one expression. This
  /// is the assertion that they do, over a modinfo spelt the way a real one is:
  /// padded, capitalised however the author felt, and not always ASCII.
  it("sends faction names verbatim and keys that its units point at", async () => {
    const kit = tools(
      [game("Beyond All Reason test", "bar.sdz")],
      {
        "bar.sdz": [
          unit("armcom", ["armlab"], "Armada Commander"),
          unit("armlab", [], "Armada Bot Lab"),
          unit("legcom", ["leglab"], "Legion Commander"),
          unit("leglab", [], "Legion Bot Lab"),
          unit("gaiatree", [], "Tree"),
        ],
      },
      {
        "bar.sdz": [
          { name: "  ARMada ", startUnit: "armcom" },
          { name: "Legião", startUnit: "legcom" },
          { name: "Gaia" },
        ],
      },
    );

    await sweepGameFacts(target, () => {}, kit);
    const [facts] = kit.sent();

    expect(facts.factions).toEqual([
      { key: "armada", name: "ARMada" },
      { key: "legião", name: "Legião" },
    ]);
    const keyed = Object.fromEntries(
      facts.units.map((sent) => [sent.name, sent.factionKey]),
    );
    expect(keyed).toEqual({
      armcom: "armada",
      armlab: "armada",
      legcom: "legião",
      leglab: "legião",
      gaiatree: undefined,
    });
    const keys = facts.factions?.map((sent) => sent.key) ?? [];
    for (const sent of facts.units) {
      if (sent.factionKey) expect(keys).toContain(sent.factionKey);
    }
  });

  /// Factions are a replaced set, so an empty list is the hub being told this
  /// game has none. A read that found no sides has not learnt that.
  it("says nothing about factions when no side declares a start unit", async () => {
    const kit = tools(
      [game("Balanced Annihilation 12.24", "ba1224.sdz")],
      {},
      {
        "ba1224.sdz": [{ name: "Spectator" }],
      },
    );

    await sweepGameFacts(target, () => {}, kit);

    expect(kit.sent()[0]).not.toHaveProperty("factions");
  });

  it("sends what one game says about its units", async () => {
    const kit = tools(
      [game("Balanced Annihilation 12.24", "ba1224.sdz")],
      {
        "ba1224.sdz": [
          unit("armcom", ["armlab"], "Commander"),
          unit("armlab", [], "Vehicle Lab"),
        ],
      },
      { "ba1224.sdz": [{ name: "Armada", startUnit: "armcom" }] },
    );

    const report = await sweepGameFacts(target, () => {}, kit);

    expect(report.sent).toBe(1);
    expect(kit.sent()).toEqual([
      {
        shortname: "BA",
        release: "12.24",
        startUnits: ["armcom"],
        factions: [{ key: "armada", name: "Armada" }],
        units: [
          {
            name: "armcom",
            fullName: "Commander",
            factionKey: "armada",
            buildOptions: ["armlab"],
            stats: {},
          },
          {
            name: "armlab",
            fullName: "Vehicle Lab",
            factionKey: "armada",
            buildOptions: [],
            stats: {},
          },
        ],
      },
    ]);
  });

  /// The stats the worker read travel to the hub untouched (issue #1876). The
  /// hub stores them as schemaless JSON and renders what arrives, so anything
  /// this reshaped would be a stat nobody could trace back to a unitdef.
  it("sends the stats the worker read, as it read them", async () => {
    const kit = tools([game("Balanced Annihilation 12.24", "ba1224.sdz")], {
      "ba1224.sdz": [
        unit("armcom", [], "Commander", {
          health: 3000,
          metalCost: 2600,
          maxVelocity: 27,
          range: 250,
          weapons: [{ damage: 450, reload: 1.5, projectile: "DGun" }],
        }),
      ],
    });

    await sweepGameFacts(target, () => {}, kit);

    expect(kit.sent()[0].units[0].stats).toEqual({
      health: 3000,
      metalCost: 2600,
      maxVelocity: 27,
      range: 250,
      weapons: [{ damage: 450, reload: 1.5, projectile: "DGun" }],
    });
  });

  /// The rule the extraction rests on, held at this end too: a unitdef that
  /// declares nothing sends nothing, not a table of zeroes. A worker too old to
  /// report stats at all lands in the same place.
  it("sends no stats for a unit the worker had none for", async () => {
    const kit = tools([game("Balanced Annihilation 12.24", "ba1224.sdz")], {
      "ba1224.sdz": [
        unit("armsolar", [], "Solar Collector", { health: 355 }),
        unit("armnothing"),
      ],
    });

    await sweepGameFacts(target, () => {}, kit);
    const [solar, nothing] = kit.sent()[0].units;

    expect(solar.stats).toEqual({ health: 355 });
    expect(nothing.stats).toEqual({});
    expect(nothing.stats).not.toHaveProperty("health");
  });

  /// The whole point of the skip rules, end to end: a working folder's archives
  /// are never even mounted.
  it("never reads or sends a working folder", async () => {
    const kit = tools([
      game("Balanced Annihilation 12.24", "ba1224.sdz"),
      game("SplinterFaction 0.1.78", "SplinterFaction.sdd", {
        shortname: "SF",
      }),
      game("Coilbox unit test scratch", SCRATCH_FOLDER, {
        shortname: "coilbox-lego",
      }),
    ]);

    const report = await sweepGameFacts(target, () => {}, kit);

    expect(kit.mounted()).toEqual(["ba1224.sdz"]);
    expect(kit.sent().map((facts) => facts.shortname)).toEqual(["BA"]);
    expect(report.found).toBe(3);
    expect(report.sent).toBe(1);
    expect(report.skipped).toHaveLength(2);
  });

  /// A complete submission with no units is an instruction to retire the lot, so
  /// a read that came back empty must not travel as one.
  it("skips a game whose archives produced no units", async () => {
    const kit = tools([game("Balanced Annihilation 12.24", "ba1224.sdz")], {
      "ba1224.sdz": [],
    });

    const report = await sweepGameFacts(target, () => {}, kit);

    expect(kit.send).not.toHaveBeenCalled();
    expect(report.skipped).toEqual([
      { game: "Balanced Annihilation 12.24", reason: "no-units" },
    ]);
  });

  it("carries on past a game the hub would not take", async () => {
    const kit = tools([
      game("Balanced Annihilation 12.24", "ba1224.sdz"),
      game("Zero-K 1.2", "zk12.sdz", { shortname: "ZK" }),
    ]);
    let first = true;
    kit.send = vi.fn(async (_hubUrl: string, facts: GameFacts) => {
      if (first) {
        first = false;
        throw new Error("The hub at hub.example refused the request: no.");
      }
      return [
        { kind: "unit", name: facts.units[0].name, outcome: "accepted" },
      ] as GameFactsResult[];
    }) as unknown as GameSweepTools["send"];

    const report = await sweepGameFacts(target, () => {}, kit);

    expect(report.sent).toBe(1);
    expect(report.failed).toEqual([
      {
        game: "Balanced Annihilation 12.24",
        said: "The hub at hub.example refused the request: no.",
      },
    ]);
  });

  /// A refusal is per unit inside a 200, so it does not lose the game it was in.
  it("keeps the units the hub refused inside an otherwise fine submission", async () => {
    const kit = tools(
      [game("Balanced Annihilation 12.24", "ba1224.sdz")],
      {},
      {},
      [
        { kind: "unit", name: "armcom", outcome: "accepted" },
        { kind: "unit", name: "armodd", outcome: "refused", said: "no" },
      ],
    );

    const report = await sweepGameFacts(target, () => {}, kit);

    expect(report.sent).toBe(1);
    expect(report.refused).toEqual([
      { kind: "unit", name: "armodd", outcome: "refused", said: "no" },
    ]);
  });

  it("does nothing with a machine that has no games", async () => {
    const kit = tools([]);

    const report = await sweepGameFacts(target, () => {}, kit);

    expect(report.found).toBe(0);
    expect(kit.send).not.toHaveBeenCalled();
  });

  it("counts games as it goes", async () => {
    const kit = tools([
      game("Balanced Annihilation 12.24", "ba1224.sdz"),
      game("Zero-K 1.2", "zk12.sdz", { shortname: "ZK" }),
    ]);
    const seen: string[] = [];

    await sweepGameFacts(target, (p) => seen.push(p.phase), kit);

    expect(seen[0]).toBe("scanning");
    expect(seen).toContain("reading");
    expect(seen.at(-1)).toBe("sending");
  });
});

describe("gameSweepSummary", () => {
  const base = {
    found: 3,
    sent: 2,
    skipped: [],
    failed: [],
    refused: [],
    errors: [],
  };

  it("says what was sent", () => {
    expect(gameSweepSummary(base)).toBe(
      "Sent what 2 games say about their units.",
    );
  });

  it("says nothing was worth sending when only working folders were found", () => {
    expect(gameSweepSummary({ ...base, sent: 0 })).toContain(
      "Only released games are sent",
    );
  });

  it("counts the games the hub would not take", () => {
    const said = gameSweepSummary({
      ...base,
      failed: [{ game: "Zero-K 1.2", said: "no" }],
    });
    expect(said).toContain("would not take one game");
  });

  it("counts the units the hub would not take", () => {
    const said = gameSweepSummary({
      ...base,
      refused: [{ kind: "unit", name: "armodd", outcome: "refused" }],
    });
    expect(said).toContain("would not take 1 unit");
  });

  /// A refused faction and a refused unit are fixed in different places, so the
  /// sentence does not call one the other.
  it("counts a refused faction as a faction", () => {
    const said = gameSweepSummary({
      ...base,
      refused: [
        { kind: "unit", name: "armodd", outcome: "refused" },
        { kind: "unit", name: "corodd", outcome: "refused" },
        { kind: "faction", name: "", outcome: "refused" },
      ],
    });
    expect(said).toContain("would not take 2 units and 1 faction");
  });
});
