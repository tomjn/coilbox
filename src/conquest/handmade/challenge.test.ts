import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  conquestIdentity,
  conquestImportIdentity,
  galaxyIdentity,
  handmadeConquestIdentity,
} from "../../challenge/identity";
import { checkChallengeMap } from "../../challenge/mapCheck";
import { conquestRunResult } from "../../challenge/result";
import { MAX_CODE_LENGTH } from "../../deeplink/parse";
import { decodeConquestChallenge, substitutedMapCount } from "../challenge";
import type { GalaxyDoc } from "../model";
import type { MapManifest } from "./manifest";
import { decodePng } from "./png.testhelper";
import { type HandmadeMapResult, readHandmadeMap } from "./read";

const hoisted = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./library", () => ({ loadHandmadeMap: hoisted.load }));

const {
  decodeConquestImport,
  encodeHandmadeChallenge,
  encodeHandmadeChallengeFile,
  handmadeChallengeSettings,
  isHandmadeChallenge,
  loadChallengeMap,
  parseHandmadeChallengeSettings,
} = await import("./challenge");
const { handmadeConquestDoc, handmadeRun, newHandmadeConquest } = await import(
  "./conquest"
);

const SAMPLE = fileURLToPath(
  new URL("../../../docs/examples/handmade-map/", import.meta.url),
);
const manifestText = readFileSync(`${SAMPLE}map.json`, "utf8");
const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));
const scenarios = {
  "ironcoast-siege.json": readFileSync(`${SAMPLE}ironcoast-siege.json`, "utf8"),
};

function read(edit: (m: MapManifest) => void = () => {}): HandmadeMapResult {
  const m = JSON.parse(manifestText) as MapManifest;
  edit(m);
  return readHandmadeMap({
    manifest: JSON.stringify(m),
    provinces,
    picture: { width: provinces.width, height: provinces.height },
    urlFor: (name) => `coilbox://sample/${name}`,
    scenarios,
  });
}

function readSample(edit?: (m: MapManifest) => void): GalaxyDoc {
  const result = read(edit);
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

const map = readSample();
const OPTIONS = { seed: 7, fogOfWar: true, threatLevel: 2 };

/** The document a conquest with `OPTIONS` is played on. */
function played(
  on: GalaxyDoc = map,
  options: Parameters<typeof handmadeRun>[1] = OPTIONS,
  maps = MAPS,
): GalaxyDoc {
  return handmadeConquestDoc(on, handmadeRun(on, options, maps));
}

function decoded(code: string | null) {
  const result = decodeConquestImport(code ?? "");
  if (!result.ok) throw new Error(`decode failed: ${result.error}`);
  if (!isHandmadeChallenge(result.settings)) {
    throw new Error("expected a challenge on a hand-made map");
  }
  return result.settings;
}

describe("a challenge code for a conquest on a hand-made map", () => {
  const galaxy = played();
  const code = encodeHandmadeChallenge(galaxy);

  it("carries the map's id, fingerprint and title, and no generator settings", () => {
    const settings = decoded(code);
    expect(settings.map).toEqual({
      source: "handmade",
      id: "sample-two-shores",
      fingerprint: map.handmade?.fingerprint,
      title: "Two Shores",
    });
    expect(settings.game).toEqual({ shortname: "TG" });
    expect(settings.fogOfWar).toBe(true);
    expect(settings.threatLevel).toBe(2);
    expect(settings).not.toHaveProperty("seed");
    expect(settings).not.toHaveProperty("nodeCount");
  });

  it("names the battle of every location the author left blank, and no other", () => {
    const settings = decoded(code);
    expect(settings.nodeMaps).toEqual(galaxy.handmade?.battles);
    expect(settings.nodeMaps).not.toHaveProperty("westhaven");
    expect(settings.nodeMaps).not.toHaveProperty("farwatch");
  });

  it("reads back to the settings it was written from, as a code and as a file", () => {
    const settings = handmadeChallengeSettings(galaxy);
    expect(decoded(code)).toEqual(settings);
    expect(decoded(encodeHandmadeChallengeFile(galaxy))).toEqual(settings);
  });

  it("is short enough for a share link", () => {
    expect((code ?? "").length).toBeLessThan(MAX_CODE_LENGTH);
  });

  it("is refused as incomplete by the reader a coilbox from before this has", () => {
    // That reader would otherwise build a generated map and call it this
    // challenge.
    expect(decodeConquestChallenge(code ?? "")).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("is not made for a document that is not a hand-made map", () => {
    expect(encodeHandmadeChallenge({ ...galaxy, handmade: undefined })).toBe(
      null,
    );
  });

  it("is read as a hand-made challenge even when generator settings ride along", () => {
    const settings = handmadeChallengeSettings(galaxy);
    const parsed = parseHandmadeChallengeSettings({
      ...settings,
      seed: 1,
      nodeCount: 20,
      factionCount: 2,
    });
    expect(parsed).toEqual(settings);
  });
});

describe("the identity of a conquest on a hand-made map", () => {
  const galaxy = played();
  const identity = galaxyIdentity(galaxy);

  it("is the same from the document and from its decoded code", () => {
    expect(identity).not.toBeNull();
    expect(
      handmadeConquestIdentity(decoded(encodeHandmadeChallenge(galaxy))),
    ).toBe(identity);
    expect(
      conquestImportIdentity(decoded(encodeHandmadeChallenge(galaxy))),
    ).toBe(identity);
  });

  it("holds the map's id and fingerprint", () => {
    expect(identity).toContain('"sample-two-shores"');
    expect(identity).toContain(`"${map.handmade?.fingerprint}"`);
  });

  it("differs on another version of the map", () => {
    const other = readSample((m) => {
      m.provinces[0].owner = "west";
    });
    expect(galaxyIdentity(played(other))).not.toBe(identity);
  });

  it("differs on another map with the same content", () => {
    const other = readSample((m) => {
      m.id = "another-map";
    });
    expect(other.handmade?.fingerprint).toBe(map.handmade?.fingerprint);
    expect(galaxyIdentity(played(other))).not.toBe(identity);
  });

  it("differs with fog of war, with the threat level and with the battles drawn", () => {
    const fogOff = played(map, { ...OPTIONS, fogOfWar: false });
    const level = played(map, { ...OPTIONS, threatLevel: 1 });
    const otherSeed = played(map, { ...OPTIONS, seed: 8 });
    expect(otherSeed.handmade?.battles).not.toEqual(galaxy.handmade?.battles);
    const all = [fogOff, level, otherSeed].map(galaxyIdentity);
    expect(new Set([identity, ...all]).size).toBe(4);
  });

  it("is the same whatever the map is called", () => {
    const renamed = readSample((m) => {
      m.title = "Two Shores, second printing";
    });
    expect(galaxyIdentity(played(renamed))).toBe(identity);
  });

  it("gives a finished conquest a result under it", () => {
    const state = newHandmadeConquest(map, OPTIONS, MAPS, "t0");
    const result = conquestRunResult(galaxy, {
      ...state,
      status: "won",
      turn: 9,
    });
    expect(result?.identity).toBe(identity);
    expect(result?.score).toEqual({ won: true, measure: 9 });
  });
});

describe("importing a challenge whose battle maps are not all installed", () => {
  const settings = decoded(encodeHandmadeChallenge(played()));
  // Everything but the map Midvale was given.
  const midvale = settings.nodeMaps?.midvale ?? "";
  const fewer = MAPS.filter((m) => m.name !== midvale);
  const imported = played(
    map,
    { seed: 99, fogOfWar: true, threatLevel: 2, named: settings.nodeMaps },
    fewer,
  );

  it("keeps every named battle it can and stands in for the one it cannot", () => {
    expect(midvale).not.toBe("");
    for (const node of imported.nodes) {
      const named = settings.nodeMaps?.[node.id];
      if (!named) continue;
      if (node.id === "midvale") {
        expect(node.battle.mapName).not.toBe(midvale);
        expect(node.battle.mapSubstitutedFrom).toBe(midvale);
      } else {
        expect(node.battle.mapName).toBe(named);
        expect(node.battle.mapSubstitutedFrom).toBeUndefined();
      }
    }
    expect(substitutedMapCount(imported)).toBe(1);
  });

  it("is the same challenge, and its result does not count", () => {
    expect(galaxyIdentity(imported)).toBe(galaxyIdentity(played()));
    const state = newHandmadeConquest(
      map,
      { seed: 99, fogOfWar: true, threatLevel: 2, named: settings.nodeMaps },
      fewer,
      "t0",
    );
    expect(state.handmade?.substituted).toEqual({ midvale });
    expect(conquestRunResult(imported, { ...state, status: "won" })).toBe(null);
  });

  it("passes the challenge on with the map it named, not the stand-in", () => {
    expect(handmadeChallengeSettings(imported)?.nodeMaps).toEqual(
      settings.nodeMaps,
    );
  });

  it("never changes a battle the author set", () => {
    const tampered = played(
      map,
      { ...OPTIONS, named: { ...settings.nodeMaps, westhaven: "Map3" } },
      MAPS,
    );
    expect(tampered.nodes.find((n) => n.id === "westhaven")?.battle).toEqual({
      mapName: "MapA",
    });
  });
});

describe("checking the installed map against a challenge", () => {
  const ref = decoded(encodeHandmadeChallenge(played())).map;
  const notInstalled: HandmadeMapResult = {
    ok: false,
    errors: [
      {
        code: "file-missing",
        file: "map.json",
        message:
          'No hand-made map with the id "sample-two-shores" is installed.',
      },
    ],
  };

  it("passes the map the challenge was made on", () => {
    expect(checkChallengeMap(ref, "Test Game", read())).toEqual({
      ok: true,
      map,
    });
  });

  it("names the map and its game when the map is not installed", () => {
    const check = checkChallengeMap(ref, "Test Game", notInstalled);
    if (check.ok) throw new Error("expected a refusal");
    expect(check.message).toContain('the hand-made map "Two Shores"');
    expect(check.message).toContain("made for Test Game");
    expect(check.message).toContain("not installed here");
    expect(check.message).not.toMatch(/galaxy/i);
  });

  it("names the map by its id when the code carries no title", () => {
    const check = checkChallengeMap(
      { source: "handmade", id: "sample-two-shores" },
      "Test Game",
      notInstalled,
    );
    if (check.ok) throw new Error("expected a refusal");
    expect(check.message).toContain('the hand-made map "sample-two-shores"');
  });

  it("says so when the installed map is a different version", () => {
    const check = checkChallengeMap(
      ref,
      "Test Game",
      read((m) => {
        m.crossings = [];
        m.roads = [...(m.roads ?? []), ["eastcliff", "ironcoast"]];
      }),
    );
    if (check.ok) throw new Error("expected a refusal");
    expect(check.message).toContain(
      'a different version of the hand-made map "Two Shores"',
    );
    expect(check.message).toContain("made for Test Game");
    expect(check.message).toContain("was not started");
    expect(check.message).not.toMatch(/galaxy/i);
  });

  it("passes a version that differs only in what play never reads", () => {
    const check = checkChallengeMap(
      ref,
      "Test Game",
      read((m) => {
        m.title = "Two Shores, second printing";
        m.models = [];
      }),
    );
    expect(check.ok).toBe(true);
  });

  it("passes any version for a code from before fingerprints", () => {
    const check = checkChallengeMap(
      { source: "handmade", id: "sample-two-shores" },
      "Test Game",
      read((m) => {
        m.crossings = [];
        m.roads = [...(m.roads ?? []), ["eastcliff", "ironcoast"]];
      }),
    );
    expect(check.ok).toBe(true);
  });

  it("gives the reader's reason when the installed copy cannot be read", () => {
    // With no crossing the eastern shore cannot be reached.
    const broken = read((m) => {
      m.crossings = [];
    });
    if (broken.ok) throw new Error("expected the reader to refuse the map");
    const check = checkChallengeMap(ref, "Test Game", broken);
    if (check.ok) throw new Error("expected a refusal");
    expect(check.message).toContain('the hand-made map "Two Shores"');
    expect(check.message).toContain("could not be read");
    expect(check.message).toContain(broken.errors[0].message);
  });

  it("reads the map from the library by the id in the code", async () => {
    hoisted.load.mockResolvedValue(read());
    expect(await loadChallengeMap(ref, "Test Game")).toEqual({ ok: true, map });
    expect(hoisted.load).toHaveBeenCalledWith("sample-two-shores");
  });

  it("answers with a sentence when the map folders cannot be listed", async () => {
    hoisted.load.mockRejectedValue(new Error("permission denied"));
    const check = await loadChallengeMap(ref, "Test Game");
    if (check.ok) throw new Error("expected a refusal");
    expect(check.message).toContain('"Two Shores"');
    expect(check.message).toContain("permission denied");
  });
});

describe("challenge codes from before hand-made maps", () => {
  // Written by main at 9b474713 (see `../galaxyGolden.test.ts`, which checks
  // each still rebuilds its galaxy). The reader the import form now uses has
  // to give exactly what the old one gives.
  const codes = readFileSync(
    fileURLToPath(
      new URL("../fixtures/galaxies/challenge-codes.txt", import.meta.url),
    ),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => line.split(" ") as [string, string]);

  it("has the seven codes", () => {
    expect(codes).toHaveLength(7);
  });

  for (const [name, code] of codes) {
    it(`${name} decodes to the same settings and identity`, () => {
      const before = decodeConquestChallenge(code);
      const now = decodeConquestImport(code);
      if (!before.ok || !now.ok) throw new Error("expected both to decode");
      expect(now.settings).toEqual(before.settings);
      expect(isHandmadeChallenge(now.settings)).toBe(false);
      expect(conquestImportIdentity(now.settings)).toBe(
        conquestIdentity(before.settings),
      );
    });
  }
});
