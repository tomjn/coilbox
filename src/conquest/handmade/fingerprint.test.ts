import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScenarioJson, type Scenario } from "../../scenario/model";
import type { MapManifest } from "./manifest";
import { decodePng } from "./png.testhelper";
import { readHandmadeMap } from "./read";
import type { ProvincePixels } from "./trace";

const SAMPLE = fileURLToPath(
  new URL("../../../docs/examples/handmade-map/", import.meta.url),
);
const manifestText = readFileSync(`${SAMPLE}map.json`, "utf8");
const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));
const SCENARIO_FILE = "ironcoast-siege.json";
/** The sample's scenario file, as the scenario builder exported it. */
const scenarioText = readFileSync(`${SAMPLE}${SCENARIO_FILE}`, "utf8");
// The bare document inside the exported file.
const sampleScenario = parseScenarioJson(
  JSON.stringify(JSON.parse(scenarioText).payload.scenario),
);
if (!sampleScenario) throw new Error("the sample scenario did not parse");

/** The sample's fingerprint after `edit` to its manifest, on `image`. */
function fingerprint(
  edit: (m: MapManifest) => void = () => {},
  image: ProvincePixels = provinces,
  folder = "one",
  scenarios: Record<string, string> = { [SCENARIO_FILE]: scenarioText },
): string {
  const m = JSON.parse(manifestText) as MapManifest;
  edit(m);
  const result = readHandmadeMap({
    manifest: JSON.stringify(m, null, folder === "one" ? 0 : 4),
    provinces: image,
    picture: { width: image.width, height: image.height },
    urlFor: (name) => `coilbox://${folder}/${name}`,
    scenarios,
  });
  if (!result.ok) {
    throw new Error(result.errors.map((e) => e.message).join("\n"));
  }
  const value = result.doc.handmade?.fingerprint;
  if (!value) throw new Error("the reader set no fingerprint");
  return value;
}

const province = (m: MapManifest, name: string) => {
  const found = m.provinces.find((p) => p.name === name);
  if (!found) throw new Error(`no province ${name}`);
  return found;
};

/** The image with every pixel of one colour painted another. */
function repaint(from: string, to: string): ProvincePixels {
  const rgb = (hex: string) =>
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [fr, fg, fb] = rgb(from);
  const data = new Uint8Array(provinces.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === fr && data[i + 1] === fg && data[i + 2] === fb) {
      data.set(rgb(to), i);
    }
  }
  return { ...provinces, data };
}

const BASE = fingerprint();

describe("what changes a hand-made map's fingerprint", () => {
  const changes: [string, (m: MapManifest) => void][] = [
    [
      "an owner",
      (m) => {
        province(m, "Northmarch").owner = "west";
      },
    ],
    [
      "a capital moving",
      (m) => {
        province(m, "Westhaven").capital = undefined;
        province(m, "Midvale").capital = true;
      },
    ],
    [
      "a difficulty",
      (m) => {
        province(m, "Northmarch").difficulty = 4;
      },
    ],
    [
      "a battle's map",
      (m) => {
        province(m, "Westhaven").battle = { mapName: "Other" };
      },
    ],
    [
      "a battle's enemy count",
      (m) => {
        province(m, "Farwatch").battle = { mapName: "MapB", enemyAiCount: 3 };
      },
    ],
    [
      "a battle given to a blank location",
      (m) => {
        province(m, "Midvale").battle = { mapName: "MapA" };
      },
    ],
    [
      "a crossing removed and a road put in its place",
      (m) => {
        m.crossings = [];
        m.roads = [...(m.roads ?? []), ["eastcliff", "ironcoast"]];
      },
    ],
    [
      "a blocked border opened",
      (m) => {
        m.blockedBorders = [];
      },
    ],
    [
      "a Warpath kind",
      (m) => {
        province(m, "Eastcliff").warpath = { kind: "elite" };
      },
    ],
    [
      "the Warpath markings removed",
      (m) => {
        m.warpath = undefined;
        province(m, "Eastcliff").warpath = undefined;
      },
    ],
    [
      "a faction's aggression",
      (m) => {
        m.factions[1].aggression = 0.9;
      },
    ],
    [
      "a faction's side",
      (m) => {
        m.factions[0].side = "Core";
      },
    ],
    [
      "a faction the player may no longer pick",
      (m) => {
        m.factions[1].playable = false;
      },
    ],
    [
      "a location's id",
      (m) => {
        province(m, "Northmarch").id = "the-north";
        m.blockedBorders = [["the-north", "midvale"]];
      },
    ],
    [
      "the order of the locations",
      (m) => {
        m.provinces.reverse();
      },
    ],
  ];

  for (const [what, edit] of changes) {
    it(`changes with ${what}`, () => {
      expect(fingerprint(edit)).not.toBe(BASE);
    });
  }

  it("changes with the game", () => {
    // A scenario is tied to its game, so Ironcoast plays a skirmish here.
    const skirmish = (m: MapManifest) => {
      const ironcoast = province(m, "Ironcoast");
      ironcoast.scenario = undefined;
      ironcoast.battle = { mapName: "MapC" };
    };
    expect(
      fingerprint((m) => {
        skirmish(m);
        m.game = { shortname: "OTHER" };
      }),
    ).not.toBe(fingerprint(skirmish));
  });

  it("gives each of those changes a fingerprint of its own", () => {
    const all = [BASE, ...changes.map(([, edit]) => fingerprint(edit))];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("what leaves a hand-made map's fingerprint alone", () => {
  const same: [string, (m: MapManifest) => void][] = [
    [
      "the towns switch",
      (m) => {
        m.towns = !m.towns;
      },
    ],
    [
      "the title and description",
      (m) => {
        m.title = "Another name";
        m.description = "Another description.";
      },
    ],
    [
      "a location's name and blurb, with its id kept",
      (m) => {
        const p = province(m, "Northmarch");
        p.id = "northmarch";
        p.name = "The Cold North";
        p.blurb = "Colder than it was.";
      },
    ],
    [
      "a faction's name and colour, and the default faction",
      (m) => {
        m.factions[0].name = "The West";
        m.factions[0].color = "#123456";
        m.playerFaction = "east";
      },
    ],
    [
      "the picture, the heightmap and the placed models",
      (m) => {
        m.files.picture = "provinces.png";
        m.files.heightmap = undefined;
        m.heightScale = undefined;
        m.models = [];
      },
    ],
    [
      "where a marker sits",
      (m) => {
        province(m, "Northmarch").anchor = [10, 10];
      },
    ],
    [
      "the size of the map in map units",
      (m) => {
        m.size = { width: m.size.width * 2, height: m.size.height * 2 };
        for (const l of m.locations ?? []) l.pos = [l.pos[0] * 2, l.pos[1] * 2];
        for (const p of m.provinces) {
          if (p.anchor) p.anchor = [p.anchor[0] * 2, p.anchor[1] * 2];
        }
        m.models = [];
      },
    ],
    [
      "the pinned archive of the game",
      (m) => {
        m.game = { ...m.game, pinnedName: "SplinterFaction 9.9" };
      },
    ],
  ];

  for (const [what, edit] of same) {
    it(`is the same after a change to ${what}`, () => {
      expect(fingerprint(edit)).toBe(BASE);
    });
  }

  it("is the same when the manifest is laid out differently and the folder moves", () => {
    expect(fingerprint(() => {}, provinces, "two")).toBe(BASE);
  });

  it("is the same when a province is painted in another colour", () => {
    const m = JSON.parse(manifestText) as MapManifest;
    const from = province(m, "Northmarch").color.toLowerCase();
    expect(
      fingerprint(
        (edited) => {
          province(edited, "Northmarch").color = "#010203";
        },
        repaint(from, "#010203"),
      ),
    ).toBe(BASE);
  });
});

describe("a location's scenario in the fingerprint", () => {
  /** The sample with Ironcoast playing `scenario`, a bare document. */
  const withScenario = (scenario: Scenario, file = SCENARIO_FILE) =>
    fingerprint(
      (m) => {
        province(m, "Ironcoast").scenario = file;
      },
      provinces,
      "one",
      { [file]: JSON.stringify(scenario) },
    );

  it("is the same for the exported file and the bare scenario inside it", () => {
    expect(withScenario(sampleScenario)).toBe(BASE);
  });

  it("is the same when the file is renamed", () => {
    expect(withScenario(sampleScenario, "renamed.json")).toBe(BASE);
  });

  it("is the same when the scenario's name, description and dates change", () => {
    expect(
      withScenario({
        ...sampleScenario,
        id: "another-id",
        name: "Another name",
        description: "Another description.",
        createdAt: "2030-01-01T00:00:00.000Z",
        updatedAt: "2030-01-02T00:00:00.000Z",
      }),
    ).toBe(BASE);
  });

  it("changes when the scenario changes under the same file name", () => {
    expect(sampleScenario.triggers.length).toBeGreaterThan(0);
    const fewer = withScenario({
      ...sampleScenario,
      triggers: sampleScenario.triggers.slice(1),
    });
    const otherMap = withScenario({
      ...sampleScenario,
      setup: { ...sampleScenario.setup, mapName: "Another Map" },
    });
    const otherVars = withScenario({
      ...sampleScenario,
      vars: { ...sampleScenario.vars, added: 1 },
    });
    expect(new Set([BASE, fewer, otherMap, otherVars]).size).toBe(4);
  });

  it("changes when the location stops playing a scenario", () => {
    expect(
      fingerprint((m) => {
        const ironcoast = province(m, "Ironcoast");
        ironcoast.scenario = undefined;
        ironcoast.battle = { mapName: sampleScenario.setup.mapName };
      }),
    ).not.toBe(BASE);
  });
});
