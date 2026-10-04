import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateGalaxy } from "../generate";
import {
  type ConquestState,
  DEFAULT_AGGRESSION,
  type GalaxyDoc,
  parseGalaxyJson,
  reconcileState,
} from "../model";
import { advanceAfterBattle } from "../rules";
import { finishedConquest } from "../unlocks";
import {
  blankLocations,
  handmadeConquestDoc,
  newHandmadeConquest,
  pickBlankBattles,
  readHandmadeRun,
} from "./conquest";
import type { MapManifest } from "./manifest";
import { decodePng } from "./png.testhelper";
import { hasBlankBattle, readHandmadeMap } from "./read";

const SAMPLE = fileURLToPath(
  new URL("../../../docs/examples/handmade-map/", import.meta.url),
);
const manifestText = readFileSync(`${SAMPLE}map.json`, "utf8");
const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));

/** The sample map as the reader gives it, after `edit` and a repaint. */
function readSample(
  edit: (m: MapManifest) => void = () => {},
  repaint?: { from: string; to: string },
  folder = "session-1",
): GalaxyDoc {
  const m = JSON.parse(manifestText) as MapManifest;
  edit(m);
  let image = provinces;
  if (repaint) {
    const rgb = (hex: string) =>
      [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const [fr, fg, fb] = rgb(repaint.from);
    const data = new Uint8Array(provinces.data);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === fr && data[i + 1] === fg && data[i + 2] === fb) {
        data.set(rgb(repaint.to), i);
      }
    }
    image = { ...provinces, data };
  }
  const result = readHandmadeMap({
    manifest: JSON.stringify(m),
    provinces: image,
    picture: { width: image.width, height: image.height },
    urlFor: (name) => `coilbox://${folder}/${name}`,
  });
  if (!result.ok) {
    throw new Error(result.errors.map((e) => e.message).join("\n"));
  }
  return result.doc;
}

/** Three maps to a difficulty tier, so a seed has something to choose. */
const MAPS = Array.from({ length: 15 }, (_, i) => ({
  name: `Map${i + 1}`,
  width: 2 * (i + 1),
  height: 2 * (i + 1),
}));
const OPTIONS = { seed: 7, fogOfWar: false, threatLevel: 0 };

describe("picking battles for blank locations", () => {
  const map = readSample();

  it("gives every blank location a map and leaves the authored ones out", () => {
    const battles = pickBlankBattles(map, MAPS, 7);
    const blank = map.nodes.filter(hasBlankBattle).map((n) => n.id);
    expect(blank.length).toBeGreaterThan(0);
    expect(Object.keys(battles).sort()).toEqual([...blank].sort());
    expect(battles.westhaven).toBeUndefined();
    expect(blankLocations(map, battles)).toEqual([]);
  });

  it("gives the same battles for the same seed", () => {
    expect(pickBlankBattles(map, MAPS, 7)).toEqual(
      pickBlankBattles(map, MAPS, 7),
    );
    const seeds = [1, 2, 3, 4, 5].map((seed) =>
      JSON.stringify(pickBlankBattles(map, MAPS, seed)),
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("draws from the difficulty tiers generation uses", () => {
    // One node of generation at each difficulty names the tier's maps.
    const generated = generateGalaxy({
      seed: 1,
      game: { shortname: "TG" },
      maps: MAPS,
      nodeCount: 40,
      factionCount: 2,
    });
    const tier = (d: number) =>
      new Set(
        generated.nodes
          .filter((n) => n.difficulty === d)
          .map((n) => n.battle.mapName),
      );
    const battles = pickBlankBattles(map, MAPS, 7);
    for (const node of map.nodes.filter(hasBlankBattle)) {
      expect(tier(node.difficulty)).toContain(battles[node.id]);
    }
  });

  it("keeps a pick made earlier when the installed maps change", () => {
    const kept = pickBlankBattles(map, MAPS, 7);
    const later = pickBlankBattles(map, [{ name: "Only" }], 7, kept);
    expect(later).toEqual(kept);
  });

  it("leaves a location blank when no maps are installed", () => {
    const battles = pickBlankBattles(map, [], 7);
    expect(battles).toEqual({});
    expect(blankLocations(map, battles).length).toBeGreaterThan(0);
  });
});

describe("starting a conquest on a hand-made map", () => {
  const map = readSample();

  it("takes ownership and capitals from the manifest", () => {
    const state = newHandmadeConquest(map, OPTIONS, MAPS, "t0");
    expect(state.owners.westhaven).toBe("west");
    expect(state.owners.midvale).toBe("west");
    expect(state.owners.farwatch).toBe("east");
    expect(state.owners.northmarch).toBe("neutral");
    expect(state.playerFactionId).toBe("west");
    expect(state.seed).toBe(7);
    expect(state.handmade?.mapId).toBe("sample-two-shores");
    expect(state.handmade?.title).toBe("Two Shores");
  });

  it("plays the faction the player chose", () => {
    const state = newHandmadeConquest(
      map,
      { ...OPTIONS, playerFactionId: "east" },
      MAPS,
      "t0",
    );
    expect(state.playerFactionId).toBe("east");
  });

  it("saves no image address and no copy of the map", () => {
    const state = newHandmadeConquest(map, OPTIONS, MAPS, "t0");
    expect(JSON.stringify(state)).not.toContain("coilbox://");
    expect(JSON.stringify(state)).not.toContain("outline");
  });

  it("builds a document every battle of which can launch", () => {
    const state = newHandmadeConquest(map, OPTIONS, MAPS, "t0");
    const run = readHandmadeRun(state);
    if (!run) throw new Error("expected a hand-made run");
    const doc = handmadeConquestDoc(map, run);
    expect(doc.nodes.every((n) => n.battle.mapName !== "")).toBe(true);
    // The authored battle is untouched, extras included.
    expect(doc.nodes.find((n) => n.id === "farwatch")?.battle).toEqual({
      mapName: "MapB",
      enemyAiCount: 2,
    });
    expect(parseGalaxyJson(JSON.stringify(doc))).not.toBeNull();
    expect(doc.generated).toBeUndefined();
    expect(doc.handmade).toEqual({
      mapId: "sample-two-shores",
      fingerprint: map.handmade?.fingerprint,
      battles: state.handmade?.battles,
    });
    expect(doc.handmade?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("turns fog of war on only when asked", () => {
    const fog = newHandmadeConquest(
      map,
      { ...OPTIONS, fogOfWar: true },
      MAPS,
      "t0",
    );
    expect(fog.revealed).toContain("westhaven");
    expect(
      handmadeConquestDoc(map, fog.handmade ?? { battles: {} }).rules?.fogOfWar,
    ).toBe(true);
    const clear = newHandmadeConquest(map, OPTIONS, MAPS, "t0");
    expect(clear.revealed).toBeUndefined();
    expect(
      handmadeConquestDoc(map, clear.handmade ?? { battles: {} }).rules
        ?.fogOfWar,
    ).toBeUndefined();
  });

  it("raises aggression with the threat level and leaves level 0 alone", () => {
    expect(handmadeConquestDoc(map, { battles: {} }).factions).toBe(
      map.factions,
    );
    const top = handmadeConquestDoc(map, { battles: {}, threatLevel: 3 });
    expect(top.factions.find((f) => f.id === "east")?.aggression).toBe(1);
    const mid = handmadeConquestDoc(map, { battles: {}, threatLevel: 1 });
    expect(mid.factions.find((f) => f.id === "east")?.aggression).toBeCloseTo(
      0.6,
    );
    expect(
      mid.factions.find((f) => f.id === "west")?.aggression,
    ).toBeGreaterThan(DEFAULT_AGGRESSION);
    expect(mid.handmade?.threatLevel).toBe(1);
  });

  it("counts a finished conquest at the level it was played", () => {
    const state = newHandmadeConquest(
      map,
      { ...OPTIONS, threatLevel: 2 },
      MAPS,
      "t0",
    );
    const doc = handmadeConquestDoc(map, state.handmade ?? { battles: {} });
    expect(finishedConquest(doc, { ...state, status: "won" })?.level).toBe(2);
  });

  it("is won by taking the enemy capital", () => {
    const start = newHandmadeConquest(map, OPTIONS, MAPS, "t0");
    const doc = handmadeConquestDoc(map, start.handmade ?? { battles: {} });
    // Hold everything but the capital, so it is in reach.
    const owners = Object.fromEntries(
      doc.nodes.map((n) => [n.id, n.id === "farwatch" ? "east" : "west"]),
    );
    const won = advanceAfterBattle(
      doc,
      { ...start, owners },
      "farwatch",
      "attack",
      "victory",
    );
    expect(won.status).toBe("won");
    expect(won.handmade).toEqual(start.handmade);
  });
});

describe("resuming after the map folder changed", () => {
  const map = readSample();
  /** A conquest some way in: the player took Eastcliff and Southreach. */
  function saved(): ConquestState {
    const start = newHandmadeConquest(map, OPTIONS, MAPS, "t0");
    return {
      ...start,
      turn: 4,
      owners: { ...start.owners, eastcliff: "west", southreach: "west" },
      incursions: [
        { nodeId: "southreach", factionId: "east", expiresOnTurn: 6 },
      ],
      lastRound: [
        { factionId: "east", nodeId: "southreach", from: "neutral" },
        { factionId: "east", nodeId: "highmoor", from: "neutral" },
      ],
    };
  }
  /** What a load does: read the folder, apply the choices, reconcile. */
  function resume(next: GalaxyDoc, state: ConquestState) {
    const run = readHandmadeRun(state);
    if (!run) throw new Error("expected a hand-made run");
    const battles = pickBlankBattles(next, MAPS, state.seed, run.battles);
    const doc = handmadeConquestDoc(next, { ...run, battles });
    return { doc, state: reconcileState(doc, state) };
  }

  it("survives the save file as JSON", () => {
    const state = JSON.parse(JSON.stringify(saved())) as ConquestState;
    const { doc, state: healed } = resume(map, state);
    expect(healed.owners).toEqual(saved().owners);
    expect(healed.turn).toBe(4);
    expect(doc.nodes.every((n) => n.battle.mapName !== "")).toBe(true);
  });

  it("uses the image addresses of the session that loads it", () => {
    const { doc } = resume(
      readSample(() => {}, undefined, "session-2"),
      saved(),
    );
    expect(doc.terrain?.image).toBe("coilbox://session-2/picture.png");
  });

  it("drops a province that was removed", () => {
    const smaller = readSample(
      (m) => {
        m.provinces = m.provinces.filter((p) => p.name !== "Southreach");
        m.roads = [["stonebridge", "midvale"]];
      },
      { from: "#8a6fc2", to: "#7ab85a" },
    );
    expect(smaller.nodes.some((n) => n.id === "southreach")).toBe(false);
    const { doc, state } = resume(smaller, saved());
    expect(state.owners.southreach).toBeUndefined();
    expect(Object.keys(state.owners).sort()).toEqual(
      doc.nodes.map((n) => n.id).sort(),
    );
    // The incursion on it and its recap line go with it.
    expect(state.incursions).toEqual([]);
    expect(state.lastRound).toEqual([
      { factionId: "east", nodeId: "highmoor", from: "neutral" },
    ]);
    // Everything else is as the player left it.
    expect(state.owners.eastcliff).toBe("west");
    expect(state.turn).toBe(4);
    expect(state.status).toBe("active");
  });

  it("starts a province whose id changed from the manifest again", () => {
    const renamed = readSample((m) => {
      const p = m.provinces.find((x) => x.name === "Eastcliff");
      if (!p) throw new Error("no Eastcliff");
      p.name = "Eastcliffe";
      m.crossings = [["eastcliffe", "ironcoast"]];
    });
    const { doc, state } = resume(renamed, saved());
    expect(state.owners.eastcliff).toBeUndefined();
    // The capture is lost with the old id. The new id has the manifest's owner.
    expect(state.owners.eastcliffe).toBe("neutral");
    // A blank battle under the new id gets a map.
    expect(
      doc.nodes.find((n) => n.id === "eastcliffe")?.battle.mapName,
    ).not.toBe("");
    // The rest of the conquest is untouched.
    expect(state.owners.southreach).toBe("west");
    expect(state.incursions).toHaveLength(1);
  });

  it("keeps each blank location on its map when the installed maps change", () => {
    const state = saved();
    const run = readHandmadeRun(state);
    if (!run) throw new Error("expected a hand-made run");
    const battles = pickBlankBattles(
      map,
      [{ name: "Only" }],
      state.seed,
      run.battles,
    );
    expect(battles).toEqual(state.handmade?.battles);
  });
});

describe("reading the hand-made part of a save", () => {
  const base = newHandmadeConquest(readSample(), OPTIONS, MAPS, "t0");

  it("is null for a conquest that is not on a hand-made map", () => {
    expect(readHandmadeRun({ ...base, handmade: undefined })).toBeNull();
  });

  it("drops what is not a battle map name and clamps the level", () => {
    const damaged = {
      ...base,
      handmade: {
        mapId: "m",
        battles: { a: "MapA", b: 3, c: "" },
        threatLevel: 9,
        fogOfWar: "yes",
      },
    } as unknown as ConquestState;
    expect(readHandmadeRun(damaged)).toEqual({
      mapId: "m",
      title: "m",
      battles: { a: "MapA" },
      threatLevel: 3,
      fogOfWar: undefined,
    });
  });
});
