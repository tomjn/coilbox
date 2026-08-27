import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import { isBlackHex } from "@/lib/teamColor";
import type { BattleConfig } from "./bindings";
import {
  aiByline,
  applyRestrictions,
  effectiveTeams,
  initialParticipants,
  makeAiParticipant,
  PALETTE,
  type Participant,
  RANDOM_SIDE,
  resolveRandomSides,
  rgbToHex,
  sanitizeColors,
  setParticipantTeam,
  showsFactionColumn,
  toBattleConfig,
} from "./participants";

describe("showsFactionColumn", () => {
  it("shows the column when there is a choice to make", () => {
    expect(showsFactionColumn([{ name: "Arm" }, { name: "Core" }])).toBe(true);
  });

  it("hides it for a game with one faction, which Zero-K is", () => {
    expect(showsFactionColumn([{ name: "Zero-K" }])).toBe(false);
  });

  it("hides it when the game is not installed and its sides are unknown", () => {
    expect(showsFactionColumn([])).toBe(false);
  });
});

const you = (color: Participant["color"]): Participant => ({
  id: "you",
  kind: "you",
  name: "You",
  side: "",
  color,
  allyTeam: 0,
  spectator: false,
});

const ai = (id: string, color: Participant["color"]): Participant => ({
  id,
  kind: "ai",
  name: id,
  side: "",
  color,
  allyTeam: 1,
  spectator: false,
});

describe("makeAiParticipant colours", () => {
  it("gives each added AI a distinct, non-black colour as participants accumulate", () => {
    let ps = initialParticipants();
    const seen = new Set(ps.map((p) => rgbToHex(p.color)));
    for (let i = 0; i < 8; i++) {
      const next = makeAiParticipant(ps);
      const hex = rgbToHex(next.color);
      expect(isBlackHex(hex)).toBe(false);
      expect(seen.has(hex)).toBe(false);
      seen.add(hex);
      ps = [...ps, next];
    }
  });
});

describe("makeAiParticipant default side", () => {
  it("defaults a newly added AI to Random", () => {
    const p = makeAiParticipant(initialParticipants());
    expect(p.side).toBe(RANDOM_SIDE);
  });

  it("honours an explicit side when given one", () => {
    const p = makeAiParticipant(initialParticipants(), "Armada");
    expect(p.side).toBe("Armada");
  });
});

describe("resolveRandomSides", () => {
  const sides = [{ name: "Armada" }, { name: "Cortex" }, { name: "Legion" }];
  const randomAi = (id: string): Participant => ({
    ...ai(id, PALETTE[1]),
    side: RANDOM_SIDE,
  });

  it("resolves a Random row to a concrete side via the injected roll", () => {
    // roll 0.5 * 3 = 1.5 -> floor 1 -> the second side.
    const out = resolveRandomSides([randomAi("a")], sides, () => 0.5);
    expect(out[0].side).toBe("Cortex");
  });

  it("rolls each Random AI independently", () => {
    const rolls = [0, 0.99]; // -> Armada, then Legion
    let i = 0;
    const out = resolveRandomSides(
      [randomAi("a"), randomAi("b")],
      sides,
      () => rolls[i++],
    );
    expect(out.map((p) => p.side)).toEqual(["Armada", "Legion"]);
  });

  it("resolves to the only side when the game has a single side", () => {
    const out = resolveRandomSides(
      [randomAi("a")],
      [{ name: "Solo" }],
      () => 0.9,
    );
    expect(out[0].side).toBe("Solo");
  });

  it("falls back to engine default when the sides list is empty", () => {
    const out = resolveRandomSides([randomAi("a")], []);
    expect(out[0].side).toBe("");
  });

  it("clamps a roll of exactly 1 to the last side", () => {
    const out = resolveRandomSides([randomAi("a")], sides, () => 1);
    expect(out[0].side).toBe("Legion");
  });

  it("leaves concrete and engine-default rows untouched, returning the same reference", () => {
    const ps = [you(PALETTE[0]), { ...ai("a", PALETTE[1]), side: "Armada" }];
    expect(resolveRandomSides(ps, sides)).toBe(ps);
  });
});

describe("sanitizeColors", () => {
  it("heals a black 'you' row by seeding from the remembered colour", () => {
    const ps = [you([0, 0, 0]), ai("AI 1", PALETTE[1])];
    const out = sanitizeColors(ps, "#ff0000");
    expect(rgbToHex(out[0].color)).toBe("#ff0000");
  });

  it("picks a non-black colour for 'you' when there is no remembered colour", () => {
    const ps = [you([0, 0, 0]), ai("AI 1", PALETTE[1])];
    const out = sanitizeColors(ps, "");
    expect(isBlackHex(rgbToHex(out[0].color))).toBe(false);
  });

  it("keeps a valid 'you' colour and only heals black opponents", () => {
    const green = PALETTE[2];
    const ps = [you(green), ai("AI 1", [0, 0, 0])];
    const out = sanitizeColors(ps, "#ff0000");
    expect(rgbToHex(out[0].color)).toBe(rgbToHex(green)); // untouched
    expect(isBlackHex(rgbToHex(out[1].color))).toBe(false); // healed
  });

  it("returns the same array reference when nothing needs healing", () => {
    const ps = initialParticipants();
    expect(sanitizeColors(ps, "")).toBe(ps);
  });
});

describe("toBattleConfig AI blocks", () => {
  const base = {
    mapName: "All That Glitters v2.2.3",
    gameType: "SplinterFaction 0.1.75",
    startPosType: 0,
    modOptions: {},
    optionSchema: [],
    mapOptionSchema: [],
  };

  const withAi = (kind: "native" | "lua", shortName: string) =>
    toBattleConfig({
      ...base,
      participants: [
        you(PALETTE[0]),
        {
          ...ai("bot1", PALETTE[1]),
          ai: { kind, shortName, name: shortName },
        },
      ],
    });

  it("emits a game Lua AI as an [AI] block the engine parses, not a team key", () => {
    const cfg = withAi("lua", "SimpleAI");
    // The engine only reads [GAME]\AIn sections; a `LuaAI` team key is ignored,
    // leaving the team with no controller at all.
    expect(cfg.ais).toEqual([
      {
        name: "bot1",
        shortName: "SimpleAI",
        version: "<game>",
        team: 1,
        host: 0,
      },
    ]);
  });

  it("emits a native AI as an [AI] block with no version", () => {
    const cfg = withAi("native", "NullAI");
    expect(cfg.ais).toEqual([
      {
        name: "bot1",
        shortName: "NullAI",
        version: undefined,
        team: 1,
        host: 0,
      },
    ]);
  });
});

/**
 * The bug this guards against (#1868): singleplayer emitted no `[mapoptions]`
 * block at all, so a map that declares its own options got none of them. The
 * engine substitutes nothing here. `CGameSetup::Init` copies the script's
 * section verbatim and `Spring.GetMapOptions()` hands game Lua exactly that, so
 * an absent key is `nil` where the map author asked for a value.
 *
 * BlockFort v1's real declarations, read from unitsync: fog on, extractor
 * radius 100. Its own `gui_dualfog_gadget.lua` tests `== "1"`, so without the
 * block the map plays with fog off against its author's wishes.
 */
describe("toBattleConfig map options", () => {
  const mapOptionSchema: ConfigOption[] = [
    { key: "atmosphere", name: "Atmosphere Settings", type: "section" },
    {
      key: "fog",
      name: "Fog",
      type: "bool",
      default: "1",
      section: "atmosphere",
    },
    {
      key: "extractorradius",
      name: "Extractor Radius",
      type: "number",
      default: "100",
    },
    { key: "tweak", name: "Tweak", type: "string" },
  ];

  const build = (schema: ConfigOption[]) =>
    toBattleConfig({
      participants: [you(PALETTE[0]), ai("bot1", PALETTE[1])],
      mapName: "BlockFort v1",
      gameType: "SplinterFaction 0.1.75",
      startPosType: 0,
      modOptions: {},
      optionSchema: [],
      mapOptionSchema: schema,
    });

  it("writes the map's own declared defaults", () => {
    expect(build(mapOptionSchema).mapOptions).toEqual({
      fog: "1",
      extractorradius: "100",
    });
  });

  it("omits the block when the map declares nothing", () => {
    expect(build([]).mapOptions).toBeUndefined();
  });
});

describe("effectiveTeams", () => {
  it("defaults to row order when no slots are chosen", () => {
    const ps = [you(PALETTE[0]), ai("a", PALETTE[1]), ai("b", PALETTE[2])];
    const { teamIndexById, leaderIdByTeam } = effectiveTeams(ps);
    expect(teamIndexById.get("you")).toBe(0);
    expect(teamIndexById.get("a")).toBe(1);
    expect(teamIndexById.get("b")).toBe(2);
    expect(leaderIdByTeam).toEqual(["you", "a", "b"]);
  });

  it("honours an explicit permutation", () => {
    const ps = [
      { ...you(PALETTE[0]), team: 1 },
      { ...ai("a", PALETTE[1]), team: 0 },
    ];
    const { teamIndexById } = effectiveTeams(ps);
    expect(teamIndexById.get("you")).toBe(1);
    expect(teamIndexById.get("a")).toBe(0);
  });

  it("groups rows sharing a slot into one team led by the first row", () => {
    const ps = [
      { ...you(PALETTE[0]), team: 0 },
      { ...ai("a", PALETTE[1]), team: 0 },
      { ...ai("b", PALETTE[2]), team: 1 },
    ];
    const { teamIndexById, leaderIdByTeam } = effectiveTeams(ps);
    expect(teamIndexById.get("you")).toBe(0);
    expect(teamIndexById.get("a")).toBe(0);
    expect(teamIndexById.get("b")).toBe(1);
    expect(leaderIdByTeam).toEqual(["you", "b"]);
  });

  it("compacts gaps so indices stay contiguous (1,1,3 -> 0,0,1)", () => {
    const ps = [
      { ...you(PALETTE[0]), team: 1 },
      { ...ai("a", PALETTE[1]), team: 1 },
      { ...ai("b", PALETTE[2]), team: 3 },
    ];
    const { teamIndexById, leaderIdByTeam } = effectiveTeams(ps);
    expect(teamIndexById.get("you")).toBe(0);
    expect(teamIndexById.get("a")).toBe(0);
    expect(teamIndexById.get("b")).toBe(1);
    expect(leaderIdByTeam).toHaveLength(2);
  });

  it("heals invalid slot values back to a per-row slot", () => {
    const ps = [
      { ...you(PALETTE[0]), team: -2 },
      { ...ai("a", PALETTE[1]), team: 1.5 },
    ];
    const { teamIndexById } = effectiveTeams(ps);
    expect(teamIndexById.get("you")).toBe(0);
    expect(teamIndexById.get("a")).toBe(1);
  });

  it("excludes a spectating 'you' row", () => {
    const ps = [{ ...you(PALETTE[0]), spectator: true }, ai("a", PALETTE[1])];
    const { teamIndexById, leaderIdByTeam } = effectiveTeams(ps);
    expect(teamIndexById.has("you")).toBe(false);
    expect(teamIndexById.get("a")).toBe(0);
    expect(leaderIdByTeam).toEqual(["a"]);
  });
});

describe("setParticipantTeam", () => {
  it("assigns the picked slot and materialises effective slots on other rows", () => {
    const ps = [you(PALETTE[0]), ai("a", PALETTE[1])];
    const out = setParticipantTeam(ps, "you", 1);
    expect(out.find((p) => p.id === "you")?.team).toBe(1);
    expect(out.find((p) => p.id === "a")?.team).toBe(1); // shares slot 1 now
  });

  it("lets two rows share a slot after prior explicit assignment", () => {
    let ps = [you(PALETTE[0]), ai("a", PALETTE[1]), ai("b", PALETTE[2])];
    ps = setParticipantTeam(ps, "a", 0); // a joins you on team 0
    const { teamIndexById } = effectiveTeams(ps);
    expect(teamIndexById.get("you")).toBe(0);
    expect(teamIndexById.get("a")).toBe(0);
    expect(teamIndexById.get("b")).toBe(1);
  });

  it("anchors against displayed (compacted) numbers, not stale slot values", () => {
    // Stale draft: slots 4 and 7 display as teams 1 and 2. Moving "you" to
    // displayed team 2 (slot 1) must join a's team, not land somewhere new.
    const ps = [
      { ...you(PALETTE[0]), team: 4 },
      { ...ai("a", PALETTE[1]), team: 7 },
    ];
    const out = setParticipantTeam(ps, "you", 1);
    const { teamIndexById, leaderIdByTeam } = effectiveTeams(out);
    expect(teamIndexById.get("you")).toBe(0);
    expect(teamIndexById.get("a")).toBe(0);
    expect(leaderIdByTeam).toHaveLength(1); // one shared team
  });
});

describe("toBattleConfig team slots", () => {
  const base = {
    mapName: "m",
    gameType: "g",
    startPosType: 0,
    modOptions: {},
    optionSchema: [],
    mapOptionSchema: [],
  };

  it("emits teams in effective slot order with players and AIs following", () => {
    const cfg = toBattleConfig({
      ...base,
      participants: [
        { ...you(PALETTE[0]), team: 1 },
        {
          ...ai("a", PALETTE[1]),
          ai: { kind: "native", shortName: "X" },
          team: 0,
        },
      ],
    });
    expect(cfg.teams).toHaveLength(2);
    // Team 0 is the AI's (slot 0), team 1 is yours (slot 1).
    expect(rgbToHex(cfg.teams[0].rgbColor)).toBe(rgbToHex(PALETTE[1]));
    expect(rgbToHex(cfg.teams[1].rgbColor)).toBe(rgbToHex(PALETTE[0]));
    expect(cfg.players[0].team).toBe(1);
    expect(cfg.ais[0].team).toBe(0);
  });

  it("emits one shared team with the leader's attributes", () => {
    const cfg = toBattleConfig({
      ...base,
      participants: [
        { ...you(PALETTE[0]), handicap: 10, team: 0 },
        {
          ...ai("a", PALETTE[1]),
          ai: { kind: "native", shortName: "X" },
          allyTeam: 5,
          team: 0,
        },
        {
          ...ai("b", PALETTE[2]),
          ai: { kind: "native", shortName: "X" },
          team: 1,
        },
      ],
    });
    expect(cfg.teams).toHaveLength(2);
    // The shared team takes the leader's ("you") colour, ally and handicap;
    // the sharer's divergent allyTeam value is ignored.
    expect(rgbToHex(cfg.teams[0].rgbColor)).toBe(rgbToHex(PALETTE[0]));
    expect(cfg.teams[0].allyTeam).toBe(0);
    expect(cfg.teams[0].advantage).toBeCloseTo(0.1, 5);
    expect(cfg.players[0].team).toBe(0);
    expect(cfg.ais.map((a) => a.team)).toEqual([0, 1]);
    // Ally teams remap from leaders only: allys 0 (you) and 1 (b).
    expect(cfg.allyTeams).toHaveLength(2);
  });

  it("keeps row-order teams for participants without slots (legacy drafts)", () => {
    const cfg = toBattleConfig({
      ...base,
      participants: [you(PALETTE[0]), ai("a", PALETTE[1])],
    });
    expect(cfg.players[0].team).toBe(0);
    expect(cfg.teams).toHaveLength(2);
  });
});

describe("applyRestrictions", () => {
  const cfg = (): BattleConfig =>
    toBattleConfig({
      participants: [you(PALETTE[0]), ai("a", PALETTE[1])],
      mapName: "m",
      gameType: "g",
      startPosType: 0,
      modOptions: {},
      optionSchema: [],
      mapOptionSchema: [],
    });

  it("adds advantage and income onto the player team (team 0)", () => {
    const out = applyRestrictions(cfg(), {
      advantage: 0.1,
      incomeMultiplier: 0.2,
    });
    expect(out.teams[0].advantage).toBeCloseTo(0.1, 5);
    expect(out.teams[0].incomeMultiplier).toBeCloseTo(1.2, 5);
  });

  it("leaves the config untouched when there are no restrictions", () => {
    const out = applyRestrictions(cfg(), undefined);
    expect(out.teams[0].advantage).toBeUndefined();
    expect(out.teams[0].incomeMultiplier).toBeUndefined();
  });

  it("is a no-op on a team-less config", () => {
    const empty = { ...cfg(), teams: [] };
    expect(() => applyRestrictions(empty, { advantage: 0.5 })).not.toThrow();
  });

  it("targets the player's team when 'you' is not team 0", () => {
    const permuted = toBattleConfig({
      participants: [
        { ...you(PALETTE[0]), team: 1 },
        { ...ai("a", PALETTE[1]), team: 0 },
      ],
      mapName: "m",
      gameType: "g",
      startPosType: 0,
      modOptions: {},
      optionSchema: [],
      mapOptionSchema: [],
    });
    const out = applyRestrictions(permuted, { advantage: 0.1 });
    expect(out.teams[1].advantage).toBeCloseTo(0.1, 5); // yours
    expect(out.teams[0].advantage).toBeUndefined(); // the AI's
  });
});

describe("aiByline", () => {
  it("joins a v-prefixed numeric version and description", () => {
    expect(aiByline({ version: "1.2", description: "Balanced macro AI" })).toBe(
      "v1.2 · Balanced macro AI",
    );
  });

  it("shows the description alone when there is no version", () => {
    expect(aiByline({ description: "Rushes early" })).toBe("Rushes early");
  });

  it("shows a version alone, v-prefixed only when numeric", () => {
    expect(aiByline({ version: "1.0" })).toBe("v1.0");
    expect(aiByline({ version: "stable" })).toBe("stable");
  });

  it("returns undefined when neither field is present or usable", () => {
    expect(aiByline({})).toBeUndefined();
    expect(aiByline({ version: "  ", description: "" })).toBeUndefined();
  });
});
