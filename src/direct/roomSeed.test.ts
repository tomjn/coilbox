import { describe, expect, it } from "vitest";
import type { SkirmishDraft } from "@/play/drafts";
import { type Participant, RANDOM_SIDE } from "@/play/participants";
import { DEFAULT_ROOM_MAX_PLAYERS } from "./room";
import { draftToRoomSeed, quickRoomDraft, roomSeedSummary } from "./roomSeed";

const you = (p: Partial<Participant> = {}): Participant => ({
  id: "you",
  kind: "you",
  name: "You",
  side: "Cortex",
  color: [1, 0, 0],
  allyTeam: 0,
  spectator: false,
  ...p,
});

const bot = (p: Partial<Participant> = {}): Participant => ({
  id: "ai1",
  kind: "ai",
  name: "AI 1",
  side: "Armada",
  color: [0, 0, 1],
  allyTeam: 1,
  spectator: false,
  ai: { kind: "native", shortName: "BARb", name: "BARbarian" },
  ...p,
});

const draft = (p: Partial<SkirmishDraft> = {}): SkirmishDraft => ({
  participants: [you(), bot()],
  gameName: "Beyond All Reason test-1234",
  mapName: "Comet Catcher Remake 1.8",
  startPosType: 1,
  modOptionValues: {},
  ...p,
});

describe("draftToRoomSeed", () => {
  it("opens the room on the setup's game and map", () => {
    const seed = draftToRoomSeed({ draft: draft() });
    expect(seed.gameName).toBe("Beyond All Reason test-1234");
    expect(seed.mapName).toBe("Comet Catcher Remake 1.8");
  });

  it("carries each bot over with its side, team and bonus", () => {
    const seed = draftToRoomSeed({
      draft: draft({
        participants: [
          you(),
          bot({ side: "Armada", allyTeam: 1, handicap: 25 }),
          bot({
            id: "ai2",
            name: "AI 2",
            side: RANDOM_SIDE,
            allyTeam: 2,
            ai: { kind: "lua", shortName: "SimpleAI" },
          }),
        ],
      }),
    });
    expect(seed.bots).toEqual([
      {
        name: "AI1",
        ai: "BARb",
        side: "Armada",
        ally: 1,
        teamId: 1,
        handicap: 25,
      },
      {
        name: "AI2",
        ai: "SimpleAI",
        side: RANDOM_SIDE,
        ally: 2,
        teamId: 2,
        handicap: 0,
      },
    ]);
  });

  it("leaves every human seat but the host's open", () => {
    const seed = draftToRoomSeed({ draft: draft() });
    expect(seed.maxPlayers).toBe(DEFAULT_ROOM_MAX_PLAYERS);
    expect(seed.openHumanSlots).toBe(DEFAULT_ROOM_MAX_PLAYERS - 1);
  });

  it("does not take a human seat for a bot", () => {
    const seed = draftToRoomSeed({
      draft: draft({
        participants: [you(), bot(), bot({ id: "ai2", name: "AI 2" })],
      }),
    });
    expect(seed.bots).toHaveLength(2);
    expect(seed.openHumanSlots).toBe(DEFAULT_ROOM_MAX_PLAYERS - 1);
  });

  it("gives a bot a name the room's wire format can carry", () => {
    const seed = draftToRoomSeed({
      draft: draft({
        participants: [
          you(),
          bot({ name: "Big Bad  Bot" }),
          bot({ id: "ai2", name: "BigBadBot" }),
        ],
      }),
    });
    expect(seed.bots.map((b) => b.name)).toEqual(["BigBadBot", "BigBadBot1"]);
  });

  it("skips a bot whose AI the game does not offer, and says which", () => {
    const seed = draftToRoomSeed({
      draft: draft({
        participants: [
          you(),
          bot({ ai: { kind: "native", shortName: "Gone" } }),
          bot({
            id: "ai2",
            name: "AI 2",
            ai: { kind: "lua", shortName: "SimpleAI" },
          }),
        ],
      }),
      // Nothing the game offers is a usable opponent, so there is no default
      // to remap to either.
      ais: [{ shortName: "Sandbox" }],
    });
    expect(seed.bots).toEqual([]);
    expect(seed.skippedBots).toEqual(["AI1", "AI2"]);
  });

  it("keeps a bot whose AI the game offers", () => {
    const seed = draftToRoomSeed({
      draft: draft(),
      ais: [{ shortName: "BARb" }, { shortName: "SimpleAI" }],
    });
    expect(seed.bots.map((b) => b.ai)).toEqual(["BARb"]);
    expect(seed.skippedBots).toEqual([]);
  });

  it("opens an empty setup with no bots and the host's seat taken", () => {
    const seed = draftToRoomSeed({
      draft: draft({ participants: [], gameName: "", mapName: "" }),
    });
    expect(seed.bots).toEqual([]);
    expect(seed.skippedBots).toEqual([]);
    expect(seed.gameName).toBe("");
    expect(seed.mapName).toBe("");
    expect(seed.openHumanSlots).toBe(DEFAULT_ROOM_MAX_PLAYERS - 1);
  });
});

describe("roomSeedSummary", () => {
  it("counts the bots and the seats left for people", () => {
    const seed = draftToRoomSeed({ draft: draft() });
    expect(roomSeedSummary(seed)).toBe(
      "Opens with 1 bot. 7 seats are left open for people.",
    );
  });

  it("says one seat in the singular", () => {
    const seed = {
      ...draftToRoomSeed({ draft: draft() }),
      openHumanSlots: 1,
    };
    expect(roomSeedSummary(seed)).toBe(
      "Opens with 1 bot. 1 seat is left open for people.",
    );
  });

  it("names the bots the game has no AI for", () => {
    const seed = draftToRoomSeed({
      draft: draft(),
      ais: [{ shortName: "Sandbox" }],
    });
    expect(roomSeedSummary(seed)).toBe(
      "Opens with no bots. 7 seats are left open for people. This game offers no AI for AI1, so it is left out.",
    );
  });

  it("leaves the bots out of the sentence for an empty setup", () => {
    const seed = draftToRoomSeed({
      draft: draft({ participants: [] }),
    });
    expect(roomSeedSummary(seed)).toBe(
      "Opens with no bots. 7 seats are left open for people.",
    );
  });
});

describe("quickRoomDraft", () => {
  it("is you against one AI on the given game and map", () => {
    const d = quickRoomDraft("Some Game", "Some Map");
    expect(d.gameName).toBe("Some Game");
    expect(d.mapName).toBe("Some Map");
    expect(d.participants.map((p) => p.kind)).toEqual(["you", "ai"]);
    expect(d.participants[0].allyTeam).not.toBe(d.participants[1].allyTeam);
    expect(d.modOptionValues).toEqual({});
  });

  it("leaves the AI for the game's standard one", () => {
    const d = quickRoomDraft("Some Game", "Some Map");
    expect(d.participants[1].ai).toBeUndefined();
    const seed = draftToRoomSeed({
      draft: d,
      ais: [{ shortName: "Sandbox" }, { shortName: "SimpleAI" }],
    });
    expect(seed.bots).toHaveLength(1);
    expect(seed.bots[0].ai).toBe("SimpleAI");
  });
});
