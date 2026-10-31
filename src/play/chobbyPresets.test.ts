import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chobbyRecordToDraft,
  describeChobbyRecord,
  parseOptionsPresets,
  presetToChobbyRecord,
} from "./chobbyPresets";
import type { SkirmishDraft } from "./drafts";
import { initialParticipants } from "./participants";

/** A file written by Chobby's own JSON encoder. See fixtures/make-options-presets.lua. */
const FIXTURE = readFileSync(
  new URL("./fixtures/optionsPresets.chobby.json", import.meta.url),
  "utf8",
);

const SIDES = ["Armada", "Cortex", "Legion"];
const AIS = [
  { shortName: "BARb", kind: "native" as const, name: "BARb" },
  { shortName: "SimpleAI", kind: "lua" as const, name: "SimpleAI" },
];
const ctx = { gameName: "Beyond All Reason test-1234", sides: SIDES, ais: AIS };

function record(name: string): unknown {
  return parseOptionsPresets(FIXTURE)[name];
}

describe("the fixture", () => {
  it("is on one line, as Chobby's encoder wrote it and a formatter must not change", () => {
    expect(FIXTURE).not.toMatch(/[\r\n]/);
  });
});

describe("parseOptionsPresets", () => {
  it("lists the records of a file Chobby saved, in file order", () => {
    expect(Object.keys(parseOptionsPresets(FIXTURE))).toEqual([
      "Skirmish 2v2",
      "Multiplayer coop",
      "Keyed boxes",
    ]);
  });

  it("reads the empty array Chobby writes for a new file as no records", () => {
    expect(parseOptionsPresets("[]")).toEqual({});
  });

  it("rejects text that is not JSON, naming the file as unreadable", () => {
    expect(() => parseOptionsPresets('{"half":')).toThrow(/not valid JSON/);
  });

  it("rejects an empty file, which Chobby also treats as broken", () => {
    expect(() => parseOptionsPresets("")).toThrow(/empty/);
  });

  it("rejects JSON that is not a table of records", () => {
    expect(() => parseOptionsPresets('"text"')).toThrow(/not a table/);
    expect(() => parseOptionsPresets("[1,2]")).toThrow(/not a table/);
  });
});

describe("chobbyRecordToDraft", () => {
  it("takes the map, and puts the preset on the game it was imported into", () => {
    const { draft } = chobbyRecordToDraft(record("Skirmish 2v2"), ctx);
    expect(draft.mapName).toBe("Supreme Isthmus v2.1");
    expect(draft.gameName).toBe("Beyond All Reason test-1234");
  });

  it("normalises 0, the string 0 and false to the same value", () => {
    const { draft } = chobbyRecordToDraft(record("Skirmish 2v2"), ctx);
    expect(draft.modOptionValues).toMatchObject({
      scav_spawncountmult: "0",
      experimentalextraunits: "0",
      disable_fogofwar: "0",
      comrespawn: "1",
      startmetal: "1000",
      startenergy: "1000",
      ruins: "disabled",
    });
  });

  it("reads the array form of start boxes, and chooses in-game start positions", () => {
    const { draft } = chobbyRecordToDraft(record("Skirmish 2v2"), ctx);
    expect(draft.startPosType).toBe(2);
    expect(draft.startRects).toEqual({
      "0": { left: 0, top: 0, right: 66, bottom: 200 },
      "1": { left: 134, top: 0, right: 200, bottom: 200 },
    });
  });

  it("skips the null Lua leaves where an ally team had no box", () => {
    const { draft } = chobbyRecordToDraft(record("Multiplayer coop"), ctx);
    expect(draft.startRects).toEqual({
      "1": { left: 100, top: 40, right: 200, bottom: 160 },
    });
  });

  it("reads the keyed form, where key 2 is the second ally team, and string edges", () => {
    const { draft } = chobbyRecordToDraft(record("Keyed boxes"), ctx);
    expect(draft.startRects).toEqual({
      "1": { left: 80, top: 82, right: 115, bottom: 117 },
    });
  });

  it("drops a box under a team number no game could have", () => {
    const { draft } = chobbyRecordToDraft(
      JSON.parse(
        '{"Start Boxes":{"1000000001":{"left":0,"top":0,"right":100,"bottom":200},"1":{"left":0,"top":0,"right":50,"bottom":200}}}',
      ),
      ctx,
    );
    expect(Object.keys(draft.startRects ?? {})).toEqual(["0"]);
  });

  it("keeps a mod option named __proto__ as an option", () => {
    const { draft } = chobbyRecordToDraft(
      JSON.parse('{"Modoptions":{"__proto__":"x","a":"1"}}'),
      ctx,
    );
    expect(Object.keys(draft.modOptionValues)).toEqual(["__proto__", "a"]);
  });

  it("keeps fixed start positions when the record has no boxes", () => {
    const { draft } = chobbyRecordToDraft({ Map: "A map" }, ctx);
    expect(draft.startPosType).toBe(0);
    expect(draft.startRects).toBeUndefined();
  });

  it("turns bots into AI opponents beside you, with their ally team, side, colour and bonus", () => {
    const { draft } = chobbyRecordToDraft(record("Skirmish 2v2"), ctx);
    const [you, ...bots] = draft.participants;
    expect(you).toMatchObject({ kind: "you", allyTeam: 0 });
    const barb = bots.find((b) => b.name === "BARb(1)");
    expect(barb).toMatchObject({
      kind: "ai",
      allyTeam: 1,
      side: "Cortex",
      color: [0.9, 0.24, 0.2],
      handicap: 25,
      ai: { shortName: "BARb", kind: "native" },
    });
    const simple = bots.find((b) => b.name === "SimpleAI(2)");
    expect(simple).toMatchObject({
      side: "Armada",
      ai: { shortName: "SimpleAI", kind: "lua" },
    });
    expect(simple?.handicap).toBeUndefined();
  });

  it("gives every participant its own id", () => {
    const { draft } = chobbyRecordToDraft(record("Skirmish 2v2"), ctx);
    const ids = draft.participants.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("treats a bot with no known AI list entry as native", () => {
    const { draft } = chobbyRecordToDraft(record("Skirmish 2v2"), {
      ...ctx,
      ais: [],
    });
    expect(draft.participants[1].ai?.kind).toBe("native");
  });

  it("reads an empty Bots array as no opponents", () => {
    const { draft } = chobbyRecordToDraft(record("Multiplayer coop"), ctx);
    expect(draft.participants).toHaveLength(1);
  });

  it("says Multiplayer Battle Settings was dropped, and nothing else", () => {
    expect(
      chobbyRecordToDraft(record("Multiplayer coop"), ctx).dropped,
    ).toEqual(["Multiplayer Battle Settings"]);
    expect(chobbyRecordToDraft(record("Skirmish 2v2"), ctx).dropped).toEqual(
      [],
    );
  });

  it("names a section it does not know as dropped too", () => {
    const { dropped } = chobbyRecordToDraft({ Map: "m", Surprise: {} }, ctx);
    expect(dropped).toEqual(["Surprise"]);
  });

  it("copes with a record that is not a table", () => {
    const { draft } = chobbyRecordToDraft("nonsense", ctx);
    expect(draft.mapName).toBe("");
    expect(draft.participants).toHaveLength(1);
  });
});

describe("describeChobbyRecord", () => {
  it("counts what a record holds", () => {
    expect(describeChobbyRecord(record("Skirmish 2v2"))).toEqual({
      map: "Supreme Isthmus v2.1",
      options: 7,
      bots: 2,
      boxes: 2,
      multiplayer: false,
    });
    expect(describeChobbyRecord(record("Multiplayer coop"))).toEqual({
      map: "Full Metal Plate 1.7",
      options: 3,
      bots: 0,
      boxes: 1,
      multiplayer: true,
    });
  });
});

describe("presetToChobbyRecord", () => {
  const you = initialParticipants()[0];
  const draft: SkirmishDraft = {
    participants: [
      you,
      {
        id: "a",
        kind: "ai",
        name: "AI 1",
        ai: { shortName: "BARb", kind: "native" },
        side: "Legion",
        color: [0.5, 0.25, 1],
        allyTeam: 1,
        spectator: false,
        handicap: 10,
      },
      {
        id: "b",
        kind: "ai",
        name: "AI 1",
        ai: { shortName: "SimpleAI", kind: "lua" },
        side: "",
        color: [1, 1, 1],
        allyTeam: 2,
        spectator: false,
      },
      { ...you, id: "c", kind: "ai", name: "Empty slot", ai: undefined },
    ],
    gameName: "Beyond All Reason test-1234",
    mapName: "Supreme Isthmus v2.1",
    startPosType: 2,
    startRects: {
      "0": { left: 0, top: 0, right: 66, bottom: 200 },
      "2": { left: 134, top: 0, right: 200, bottom: 200 },
    },
    modOptionValues: { startmetal: "1000", ruins: "disabled" },
    mapOptionValues: { wind: "1" },
    restrictions: { disabledUnits: ["armcom"] },
  };

  it("writes the map and the options Chobby reads", () => {
    const out = presetToChobbyRecord(draft, SIDES);
    expect(out.Map).toBe("Supreme Isthmus v2.1");
    expect(out.Modoptions).toEqual({ startmetal: "1000", ruins: "disabled" });
  });

  it("leaves Multiplayer Battle Settings out", () => {
    expect(presetToChobbyRecord(draft, SIDES)).not.toHaveProperty(
      "Multiplayer Battle Settings",
    );
  });

  it("writes only AI opponents as bots, under distinct names", () => {
    const bots = presetToChobbyRecord(draft, SIDES).Bots as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(bots)).toEqual(["AI 1", "AI 1 (2)"]);
    expect(bots["AI 1"]).toEqual({
      aiLib: "BARb",
      allyNumber: 1,
      aiOptions: {},
      teamColor: [0.5, 0.25, 1],
      side: 2,
      handicap: 10,
    });
    // "Engine default" is not a side in the list, so none is written.
    expect(bots["AI 1 (2)"]).not.toHaveProperty("side");
    expect(bots["AI 1 (2)"]).not.toHaveProperty("handicap");
  });

  it("writes no side when the sides of the preset's game are not known", () => {
    const bots = presetToChobbyRecord(draft, undefined).Bots as Record<
      string,
      Record<string, unknown>
    >;
    expect(bots["AI 1"]).not.toHaveProperty("side");
  });

  it("writes no side for a faction the game's list does not have", () => {
    const bots = presetToChobbyRecord(draft, ["Armada", "Cortex"])
      .Bots as Record<string, Record<string, unknown>>;
    expect(bots["AI 1"]).not.toHaveProperty("side");
  });

  it("ignores a box for a team no game could have, rather than building an array that long", () => {
    const rect = { left: 0, top: 0, right: 100, bottom: 200 };
    const out = presetToChobbyRecord(
      { ...draft, startRects: { "0": rect, "1000000001": rect } },
      SIDES,
    );
    expect(out["Start Boxes"]).toEqual([rect]);
  });

  it("keeps a bot named __proto__ as a bot", () => {
    const named = {
      ...draft,
      participants: draft.participants.map((p) =>
        p.id === "a" ? { ...p, name: "__proto__" } : p,
      ),
    };
    const bots = presetToChobbyRecord(named, SIDES).Bots as object;
    expect(Object.keys(bots)).toContain("__proto__");
    expect(JSON.stringify(bots)).toContain('"__proto__":{"aiLib":"BARb"');
  });

  it("leaves out boxes the preset keeps but does not use", () => {
    for (const startPosType of [0, 1]) {
      const out = presetToChobbyRecord({ ...draft, startPosType }, SIDES);
      expect(out["Start Boxes"]).toEqual([]);
    }
  });

  it("writes start boxes as the array Chobby walks, filling a gap with the whole map", () => {
    const boxes = presetToChobbyRecord(draft, SIDES)["Start Boxes"];
    expect(boxes).toEqual([
      { left: 0, top: 0, right: 66, bottom: 200 },
      { left: 0, top: 0, right: 200, bottom: 200 },
      { left: 134, top: 0, right: 200, bottom: 200 },
    ]);
  });

  it("always writes Start Boxes, empty when the preset has none", () => {
    const out = presetToChobbyRecord(
      { ...draft, startRects: undefined },
      SIDES,
    );
    expect(out["Start Boxes"]).toEqual([]);
  });

  it("serialises to one line", () => {
    const text = JSON.stringify(presetToChobbyRecord(draft, SIDES));
    expect(text).not.toMatch(/[\r\n]/);
  });

  it("round-trips: what coilbox writes, it reads back as the same setup", () => {
    const back = chobbyRecordToDraft(presetToChobbyRecord(draft, SIDES), {
      ...ctx,
      ais: AIS,
    }).draft;
    expect(back.mapName).toBe(draft.mapName);
    expect(back.modOptionValues).toEqual(draft.modOptionValues);
    expect(back.startRects).toEqual({
      "0": { left: 0, top: 0, right: 66, bottom: 200 },
      "1": { left: 0, top: 0, right: 200, bottom: 200 },
      "2": { left: 134, top: 0, right: 200, bottom: 200 },
    });
    const bots = back.participants.filter((p) => p.kind === "ai");
    expect(bots.map((b) => [b.name, b.ai?.shortName, b.allyTeam])).toEqual([
      ["AI 1", "BARb", 1],
      ["AI 1 (2)", "SimpleAI", 2],
    ]);
  });
});
