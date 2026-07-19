import { describe, expect, it } from "vitest";
import type { Side, SkirmishAi } from "@/content/bindings";
import { rgbToHex } from "@/play/participants";
import type { Battle, BattleStatus, Bot, MemberStatus } from "../bindings";
import { hexToColorInt } from "./config";
import { battleToSkirmishDraft } from "./toSkirmish";

const status = (p: Partial<BattleStatus> = {}): BattleStatus => ({
  ready: true,
  teamId: 0,
  ally: 0,
  mode: true,
  handicap: 0,
  sync: 1,
  side: 0,
  ...p,
});

const member = (p: Partial<MemberStatus> = {}): MemberStatus => ({
  battleStatus: status(),
  teamColor: 0,
  scriptPassword: null,
  ...p,
});

const bot = (p: Partial<Bot> = {}): Bot => ({
  name: "bot",
  owner: "host",
  aiDll: "BARb",
  battleStatus: status({ ally: 1 }),
  teamColor: 0,
  ...p,
});

function mkBattle(p: Partial<Battle> = {}): Battle {
  return {
    id: 7,
    host: "host",
    ip: "",
    port: "",
    map: "Comet Catcher Remake 1.8",
    maphash: "",
    modname: "Beyond All Reason test-1234",
    engine: "",
    version: "",
    maxPlayers: 8,
    passworded: false,
    locked: false,
    spectatorCount: 0,
    title: "Ranked 2v2",
    channel: null,
    members: {},
    bots: {},
    scriptTags: {},
    startRects: {},
    ...p,
  };
}

const SIDES: Side[] = [{ name: "Armada" }, { name: "Cortex" }];
const AIS: SkirmishAi[] = [
  { shortName: "BARb", kind: "native", name: "BARbarian" },
  { shortName: "NullAI", kind: "native" },
  { shortName: "ScavengersAI", kind: "lua" },
];

describe("battleToSkirmishDraft", () => {
  it("maps the game, map and start-pos, stripping the modoptions prefix", () => {
    const battle = mkBattle({
      members: { me: member() },
      scriptTags: {
        "game/startpostype": "2",
        "game/modoptions/maxunits": "2000",
        "game/mapoptions/water": "1", // not a mod option -> dropped
      },
    });
    const draft = battleToSkirmishDraft({
      battle,
      me: "me",
      sides: SIDES,
      ais: AIS,
    });
    expect(draft.gameName).toBe("Beyond All Reason test-1234");
    expect(draft.mapName).toBe("Comet Catcher Remake 1.8");
    expect(draft.startPosType).toBe(2);
    expect(draft.modOptionValues).toEqual({ maxunits: "2000" });
  });

  it("makes the logged-in member 'you' and bridges the colour to float RGB", () => {
    const red = hexToColorInt("#ff0000");
    const battle = mkBattle({
      members: {
        me: member({
          teamColor: red,
          battleStatus: status({ side: 1, ally: 0 }),
        }),
      },
    });
    const draft = battleToSkirmishDraft({
      battle,
      me: "me",
      sides: SIDES,
      ais: AIS,
    });
    const you = draft.participants[0];
    expect(you.kind).toBe("you");
    expect(you.side).toBe("Cortex"); // side index 1 -> name
    expect(rgbToHex(you.color)).toBe("#ff0000"); // via hex, not crossed
  });

  it("converts other humans to a fallback AI, keeping team/ally/side/colour", () => {
    const blue = hexToColorInt("#0000ff");
    const battle = mkBattle({
      members: {
        me: member(),
        rival: member({
          teamColor: blue,
          battleStatus: status({ ally: 1, side: 1, handicap: 25 }),
        }),
      },
    });
    const draft = battleToSkirmishDraft({
      battle,
      me: "me",
      sides: SIDES,
      ais: AIS,
    });
    const rival = draft.participants.find((p) => p.name === "rival");
    expect(rival?.kind).toBe("ai");
    // Fallback picks the first playable AI (not the denied NullAI).
    expect(rival?.ai?.shortName).toBe("BARb");
    expect(rival?.allyTeam).toBe(1);
    expect(rival?.side).toBe("Cortex");
    expect(rival?.handicap).toBe(25);
    expect(rgbToHex(rival?.color ?? [0, 0, 0])).toBe("#0000ff");
  });

  it("drops human spectators (not combatants)", () => {
    const battle = mkBattle({
      members: {
        me: member(),
        watcher: member({ battleStatus: status({ mode: false }) }),
      },
    });
    const draft = battleToSkirmishDraft({
      battle,
      me: "me",
      sides: SIDES,
      ais: AIS,
    });
    expect(draft.participants.some((p) => p.name === "watcher")).toBe(false);
  });

  it("resolves a bot's aiDll to the right kind, falling back when unknown", () => {
    const battle = mkBattle({
      members: { me: member() },
      bots: {
        Scav: bot({ name: "Scav", aiDll: "ScavengersAI" }),
        Mystery: bot({ name: "Mystery", aiDll: "NotInstalledAI" }),
      },
    });
    const draft = battleToSkirmishDraft({
      battle,
      me: "me",
      sides: SIDES,
      ais: AIS,
    });
    const scav = draft.participants.find((p) => p.name === "Scav");
    expect(scav?.ai).toEqual({
      kind: "lua",
      shortName: "ScavengersAI",
      name: undefined,
    });
    const mystery = draft.participants.find((p) => p.name === "Mystery");
    // Unresolved dll falls back to a known-good AI so the replay still launches.
    expect(mystery?.ai?.shortName).toBe("BARb");
  });

  it("captures host unit restrictions as the disabled-unit set", () => {
    const battle = mkBattle({
      members: { me: member() },
      scriptTags: {
        "game/restrict/numrestrictions": "2",
        "game/restrict/unit0": "armbanth",
        "game/restrict/limit0": "0",
        "game/restrict/unit1": "corkrog",
        "game/restrict/limit1": "0",
      },
    });
    const draft = battleToSkirmishDraft({
      battle,
      me: "me",
      sides: SIDES,
      ais: AIS,
    });
    expect(draft.restrictions?.disabledUnits).toEqual(["armbanth", "corkrog"]);
  });

  it("synthesizes a spectator 'you' when the local user isn't a member", () => {
    const battle = mkBattle({ members: { someoneElse: member() } });
    const draft = battleToSkirmishDraft({
      battle,
      me: "me",
      sides: SIDES,
      ais: AIS,
    });
    const you = draft.participants[0];
    expect(you.kind).toBe("you");
    expect(you.spectator).toBe(true);
  });
});
