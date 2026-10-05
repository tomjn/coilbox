import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScenarioJson } from "../../scenario/model";
import { encodeScenarioExport } from "../../scenario/transfer";
import type { ConquestState } from "../model";
import {
  handmadeRun,
  readHandmadeRun,
  scenarioToPlay,
  withScenarioWon,
} from "./conquest";
import type { HandmadeMapError } from "./errors";
import type { MapManifest } from "./manifest";
import { decodePng } from "./png.testhelper";
import { type HandmadeMapInput, readHandmadeMap } from "./read";

const SAMPLE = fileURLToPath(
  new URL("../../../docs/examples/handmade-map/", import.meta.url),
);
const SCENARIO_FILE = "ironcoast-siege.json";
const manifestText = readFileSync(`${SAMPLE}map.json`, "utf8");
const scenarioText = readFileSync(`${SAMPLE}${SCENARIO_FILE}`, "utf8");
const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));
/**
 * The scenario builder's smallest Splinter Faction document, named and described
 * for the location it sits at. The sample's file is this, exported.
 */
const splinter = parseScenarioJson(
  readFileSync(
    new URL("../../scenario/fixtures/splinter.json", import.meta.url),
    "utf8",
  ),
);
if (!splinter) throw new Error("the Splinter fixture did not parse");
const ironcoastScenario = {
  ...splinter,
  id: "ironcoast-siege",
  name: "Hold Ironcoast",
  description:
    "The player's engineer must hold out against the Loz Alliance watchpost for ninety seconds.",
};

function sample(change: Partial<HandmadeMapInput> = {}): HandmadeMapInput {
  return {
    manifest: manifestText,
    provinces,
    picture: { width: provinces.width, height: provinces.height },
    urlFor: (name) => `asset://map/${name}`,
    scenarios: { [SCENARIO_FILE]: scenarioText },
    ...change,
  };
}

function manifestWith(edit: (m: MapManifest) => void): string {
  const m = JSON.parse(manifestText) as MapManifest;
  edit(m);
  return JSON.stringify(m);
}

function errorsOf(input: HandmadeMapInput): HandmadeMapError[] {
  const result = readHandmadeMap(input);
  if (result.ok) throw new Error("expected the read to fail");
  return result.errors;
}

function readDoc(input: HandmadeMapInput = sample()) {
  const result = readHandmadeMap(input);
  if (!result.ok) {
    throw new Error(result.errors.map((e) => e.message).join("\n"));
  }
  return result.doc;
}

describe("the sample map's scenario location", () => {
  it("is the Splinter fixture as the scenario builder exports it", () => {
    const exported = encodeScenarioExport(
      { scenario: ironcoastScenario, media: {} },
      [{ name: "SplinterFaction", info: { shortname: "SF" } }],
    );
    expect(JSON.parse(scenarioText)).toEqual(JSON.parse(exported));
  });

  it("carries the scenario, and fights on the scenario's map", () => {
    const ironcoast = readDoc().nodes.find((n) => n.id === "ironcoast");
    expect(ironcoast?.scenario?.file).toBe(SCENARIO_FILE);
    expect(ironcoast?.scenario?.doc).toEqual(ironcoastScenario);
    expect(ironcoast?.scenario?.media).toEqual({});
    expect(ironcoast?.battle).toEqual({
      mapName: ironcoastScenario.setup.mapName,
    });
  });

  it("leaves every other location without one", () => {
    const others = readDoc().nodes.filter((n) => n.id !== "ironcoast");
    expect(others.every((n) => n.scenario === undefined)).toBe(true);
  });

  it("is not a blank battle, so no map is picked or saved for it", () => {
    const run = handmadeRun(
      readDoc(),
      { seed: 1, fogOfWar: false, threatLevel: 0 },
      [{ name: "Some Map", width: 8, height: 8 }],
    );
    expect(run.battles.ironcoast).toBeUndefined();
    expect(JSON.stringify(run)).not.toContain("Hold Ironcoast");
  });

  it("reads a bare scenario document too", () => {
    const doc = readDoc(
      sample({
        scenarios: { [SCENARIO_FILE]: JSON.stringify(ironcoastScenario) },
      }),
    );
    expect(doc.nodes.find((n) => n.id === "ironcoast")?.scenario?.doc).toEqual(
      ironcoastScenario,
    );
  });

  it("works on a point location", () => {
    const doc = readDoc(
      sample({
        manifest: manifestWith((m) => {
          const stonebridge = m.locations?.find(
            (l) => l.name === "Stonebridge",
          );
          if (!stonebridge) throw new Error("the sample has no Stonebridge");
          delete stonebridge.battle;
          stonebridge.scenario = SCENARIO_FILE;
        }),
      }),
    );
    expect(
      doc.nodes.find((n) => n.id === "stonebridge")?.scenario?.doc.id,
    ).toBe("ironcoast-siege");
  });
});

describe("a scenario location the author got wrong", () => {
  it("names the location when the file is not in the folder", () => {
    const errors = errorsOf(
      sample({
        urlFor: (name) =>
          name === SCENARIO_FILE ? undefined : `asset://map/${name}`,
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "scenario-missing",
      id: "ironcoast",
      name: "Ironcoast",
      file: SCENARIO_FILE,
    });
    expect(errors[0].message).toContain('"Ironcoast"');
    expect(errors[0].message).toContain(SCENARIO_FILE);
  });

  it.each([
    ["is not JSON", "{ not json"],
    ["is JSON but not a scenario", JSON.stringify({ hello: "world" })],
    [
      "is a scenario with its triggers damaged",
      JSON.stringify({ ...ironcoastScenario, triggers: "none" }),
    ],
    [
      "is another kind of coilbox file",
      scenarioText.replace('"kind": "scenario"', '"kind": "campaign"'),
    ],
  ])("names the location when the file %s", (_what, text) => {
    const errors = errorsOf(sample({ scenarios: { [SCENARIO_FILE]: text } }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "scenario-invalid",
      id: "ironcoast",
      file: SCENARIO_FILE,
    });
    expect(errors[0].message).toContain('"Ironcoast"');
  });

  it("names the location when the file could not be read", () => {
    const errors = errorsOf(sample({ scenarios: {} }));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("scenario-invalid");
    expect(errors[0].message).toContain('"Ironcoast"');
    expect(errors[0].message).toContain("could not be read");
  });

  it("refuses a scenario that has no game and map", () => {
    const blank = {
      ...ironcoastScenario,
      setup: { ...ironcoastScenario.setup, gameName: "", mapName: "" },
    };
    const errors = errorsOf(
      sample({ scenarios: { [SCENARIO_FILE]: JSON.stringify(blank) } }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("scenario-invalid");
    expect(errors[0].message).toContain("no game and map");
  });

  it("refuses an exported scenario whose game has another shortname", () => {
    const other = encodeScenarioExport(
      { scenario: ironcoastScenario, media: {} },
      [{ name: "SplinterFaction", info: { shortname: "OTHER" } }],
    );
    const errors = errorsOf(sample({ scenarios: { [SCENARIO_FILE]: other } }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "scenario-wrong-game",
      id: "ironcoast",
      game: "SplinterFaction",
    });
    expect(errors[0].message).toContain('"Ironcoast"');
    expect(errors[0].message).toContain('"SF"');
  });

  it("matches the shortname whatever its case", () => {
    const lower = encodeScenarioExport(
      { scenario: ironcoastScenario, media: {} },
      [{ name: "SplinterFaction", info: { shortname: "sf" } }],
    );
    expect(
      readHandmadeMap(sample({ scenarios: { [SCENARIO_FILE]: lower } })).ok,
    ).toBe(true);
  });

  it("refuses a scenario for another game than the one the map pins", () => {
    const pinned = (pinnedName: string) =>
      sample({
        manifest: manifestWith((m) => {
          m.game = { shortname: "SF", pinnedName };
        }),
      });
    expect(readHandmadeMap(pinned("SplinterFaction 1.2")).ok).toBe(true);
    const errors = errorsOf(pinned("Other Game 1.2"));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("scenario-wrong-game");
    expect(errors[0].message).toContain('"Other Game 1.2"');
  });

  it("refuses a location with a scenario and a battle", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          const ironcoast = m.provinces.find((p) => p.name === "Ironcoast");
          if (ironcoast) ironcoast.battle = { mapName: "MapA" };
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "scenario-and-battle",
      id: "ironcoast",
      name: "Ironcoast",
    });
  });

  it.each([
    ["a path out of the folder", "../siege.json"],
    ["a file that is not JSON", "siege.lua"],
    ["a number", 3],
  ])("refuses %s as the scenario file name", (_what, value) => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          (m.provinces[0] as unknown as Record<string, unknown>).scenario =
            value;
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("manifest-field");
    expect(errors[0].message).toContain("scenario");
  });
});

describe("which fight at a scenario location plays the scenario", () => {
  const ironcoast = readDoc().nodes.find((n) => n.id === "ironcoast");
  if (!ironcoast) throw new Error("the sample has no Ironcoast");
  const fresh = {
    handmade: { mapId: "sample-two-shores", title: "Two Shores", battles: {} },
  } as unknown as ConquestState;

  it("plays it on the first attack", () => {
    expect(scenarioToPlay(fresh, ironcoast, "attack")?.doc.id).toBe(
      "ironcoast-siege",
    );
  });

  it("never plays it on a defence", () => {
    expect(scenarioToPlay(fresh, ironcoast, "defend")).toBeUndefined();
  });

  it("does not play it again once it is won", () => {
    const won = withScenarioWon(fresh, "ironcoast");
    expect(won.handmade?.scenariosWon).toEqual(["ironcoast"]);
    expect(scenarioToPlay(won, ironcoast, "attack")).toBeUndefined();
    expect(withScenarioWon(won, "ironcoast")).toBe(won);
  });

  it("keeps the record through a save and a load", () => {
    const saved = JSON.parse(
      JSON.stringify(withScenarioWon(fresh, "ironcoast")),
    ) as ConquestState;
    expect(readHandmadeRun(saved)?.scenariosWon).toEqual(["ironcoast"]);
    expect(readHandmadeRun(fresh)?.scenariosWon).toBeUndefined();
  });

  it("plays nothing at a location with no scenario", () => {
    const { scenario: _scenario, ...plain } = ironcoast;
    expect(scenarioToPlay(fresh, plain, "attack")).toBeUndefined();
  });
});
