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
const SCENARIO_FILE = "highmoor-siege.json";
const manifestText = readFileSync(`${SAMPLE}map.json`, "utf8");
const scenarioText = readFileSync(`${SAMPLE}${SCENARIO_FILE}`, "utf8");
const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));
const siege = parseScenarioJson(
  readFileSync(
    new URL("../../scenario/fixtures/siege.json", import.meta.url),
    "utf8",
  ),
);
if (!siege) throw new Error("the Siege fixture did not parse");

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
  it("is the Siege fixture as the scenario builder exports it", () => {
    const exported = encodeScenarioExport({ scenario: siege, media: {} }, [
      { name: "Test Game", info: { shortname: "TG" } },
    ]);
    expect(JSON.parse(scenarioText)).toEqual(JSON.parse(exported));
  });

  it("carries the scenario, and fights on the scenario's map", () => {
    const highmoor = readDoc().nodes.find((n) => n.id === "highmoor");
    expect(highmoor?.scenario?.file).toBe(SCENARIO_FILE);
    expect(highmoor?.scenario?.doc).toEqual(siege);
    expect(highmoor?.scenario?.media).toEqual({});
    expect(highmoor?.battle).toEqual({ mapName: siege.setup.mapName });
  });

  it("leaves every other location without one", () => {
    const others = readDoc().nodes.filter((n) => n.id !== "highmoor");
    expect(others.every((n) => n.scenario === undefined)).toBe(true);
  });

  it("is not a blank battle, so no map is picked or saved for it", () => {
    const run = handmadeRun(
      readDoc(),
      { seed: 1, fogOfWar: false, threatLevel: 0 },
      [{ name: "Some Map", width: 8, height: 8 }],
    );
    expect(run.battles.highmoor).toBeUndefined();
    expect(JSON.stringify(run)).not.toContain("Siege");
  });

  it("reads a bare scenario document too", () => {
    const doc = readDoc(
      sample({ scenarios: { [SCENARIO_FILE]: JSON.stringify(siege) } }),
    );
    expect(doc.nodes.find((n) => n.id === "highmoor")?.scenario?.doc).toEqual(
      siege,
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
    ).toBe("siege");
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
      id: "highmoor",
      name: "Highmoor",
      file: SCENARIO_FILE,
    });
    expect(errors[0].message).toContain('"Highmoor"');
    expect(errors[0].message).toContain(SCENARIO_FILE);
  });

  it.each([
    ["is not JSON", "{ not json"],
    ["is JSON but not a scenario", JSON.stringify({ hello: "world" })],
    [
      "is a scenario with its triggers damaged",
      JSON.stringify({ ...siege, triggers: "none" }),
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
      id: "highmoor",
      file: SCENARIO_FILE,
    });
    expect(errors[0].message).toContain('"Highmoor"');
  });

  it("names the location when the file could not be read", () => {
    const errors = errorsOf(sample({ scenarios: {} }));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("scenario-invalid");
    expect(errors[0].message).toContain('"Highmoor"');
    expect(errors[0].message).toContain("could not be read");
  });

  it("refuses a scenario that has no game and map", () => {
    const blank = {
      ...siege,
      setup: { ...siege.setup, gameName: "", mapName: "" },
    };
    const errors = errorsOf(
      sample({ scenarios: { [SCENARIO_FILE]: JSON.stringify(blank) } }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("scenario-invalid");
    expect(errors[0].message).toContain("no game and map");
  });

  it("refuses an exported scenario whose game has another shortname", () => {
    const other = encodeScenarioExport({ scenario: siege, media: {} }, [
      { name: "Test Game", info: { shortname: "OTHER" } },
    ]);
    const errors = errorsOf(sample({ scenarios: { [SCENARIO_FILE]: other } }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "scenario-wrong-game",
      id: "highmoor",
      game: "Test Game",
    });
    expect(errors[0].message).toContain('"Highmoor"');
    expect(errors[0].message).toContain('"TG"');
  });

  it("matches the shortname whatever its case", () => {
    const lower = encodeScenarioExport({ scenario: siege, media: {} }, [
      { name: "Test Game", info: { shortname: "tg" } },
    ]);
    expect(
      readHandmadeMap(sample({ scenarios: { [SCENARIO_FILE]: lower } })).ok,
    ).toBe(true);
  });

  it("refuses a scenario for another game than the one the map pins", () => {
    const pinned = (pinnedName: string) =>
      sample({
        manifest: manifestWith((m) => {
          m.game = { shortname: "TG", pinnedName };
        }),
      });
    expect(readHandmadeMap(pinned("Test Game 1.2")).ok).toBe(true);
    const errors = errorsOf(pinned("Other Game 1.2"));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("scenario-wrong-game");
    expect(errors[0].message).toContain('"Other Game 1.2"');
  });

  it("refuses a location with a scenario and a battle", () => {
    const errors = errorsOf(
      sample({
        manifest: manifestWith((m) => {
          const highmoor = m.provinces.find((p) => p.name === "Highmoor");
          if (highmoor) highmoor.battle = { mapName: "MapA" };
        }),
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "scenario-and-battle",
      id: "highmoor",
      name: "Highmoor",
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
  const highmoor = readDoc().nodes.find((n) => n.id === "highmoor");
  if (!highmoor) throw new Error("the sample has no Highmoor");
  const fresh = {
    handmade: { mapId: "sample-two-shores", title: "Two Shores", battles: {} },
  } as unknown as ConquestState;

  it("plays it on the first attack", () => {
    expect(scenarioToPlay(fresh, highmoor, "attack")?.doc.id).toBe("siege");
  });

  it("never plays it on a defence", () => {
    expect(scenarioToPlay(fresh, highmoor, "defend")).toBeUndefined();
  });

  it("does not play it again once it is won", () => {
    const won = withScenarioWon(fresh, "highmoor");
    expect(won.handmade?.scenariosWon).toEqual(["highmoor"]);
    expect(scenarioToPlay(won, highmoor, "attack")).toBeUndefined();
    expect(withScenarioWon(won, "highmoor")).toBe(won);
  });

  it("keeps the record through a save and a load", () => {
    const saved = JSON.parse(
      JSON.stringify(withScenarioWon(fresh, "highmoor")),
    ) as ConquestState;
    expect(readHandmadeRun(saved)?.scenariosWon).toEqual(["highmoor"]);
    expect(readHandmadeRun(fresh)?.scenariosWon).toBeUndefined();
  });

  it("plays nothing at a location with no scenario", () => {
    const { scenario: _scenario, ...plain } = highmoor;
    expect(scenarioToPlay(fresh, plain, "attack")).toBeUndefined();
  });
});
