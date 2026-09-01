import { describe, expect, it } from "vitest";
import type { Campaign, CampaignMission } from "../campaign/model";
import {
  campaignsUsingScenario,
  isSetUp,
  playableScenarios,
  scenarioContents,
} from "./listing";
import { parseScenario, type Scenario } from "./model";

function build(overrides: Record<string, unknown> = {}): Scenario {
  const scenario = parseScenario({
    id: "s1",
    name: "Scenario",
    runtimeVersion: 1,
    setup: {
      gameName: "Splinter Faction test",
      mapName: "Comet Catcher Redux",
      startPosType: 0,
      modOptionValues: {},
      participants: [],
    },
    teams: {},
    ...overrides,
  });
  if (!scenario) throw new Error("fixture is not a valid scenario");
  return scenario;
}

const actor = (id: string) => ({
  id,
  unitDef: "armcom",
  team: "you",
  pos: { x: 0, z: 0 },
  facing: 0,
});

describe("scenarioContents", () => {
  it("counts nothing in the singular the way it counts something", () => {
    expect(scenarioContents(build())).toBe(
      "0 unit placements · 0 zones · 0 triggers · 0 objectives",
    );
  });

  it("counts actors and groups as one number, because both are placements", () => {
    const scenario = build({
      actors: [actor("a1"), actor("a2")],
      groups: [
        {
          id: "g1",
          team: "you",
          units: [{ def: "armpw", count: 4 }],
          pos: { x: 0, z: 0 },
          orders: [],
          dormant: false,
        },
      ],
    });

    expect(scenarioContents(scenario)).toContain("3 unit placements");
  });

  it("drops the plural on a count of one", () => {
    const scenario = build({
      actors: [actor("a1")],
      zones: [
        {
          id: "z1",
          name: "Base",
          shape: "box",
          min: { x: 0, z: 0 },
          max: { x: 100, z: 100 },
        },
      ],
    });

    expect(scenarioContents(scenario)).toBe(
      "1 unit placement · 1 zone · 0 triggers · 0 objectives",
    );
  });
});

describe("campaignsUsingScenario", () => {
  const mission = (scenarioId?: string) =>
    ({
      id: `m-${scenarioId ?? "none"}`,
      title: "Mission",
      briefing: "",
      objectives: [],
      snapshot: build().setup,
      scenario: scenarioId ? build({ id: scenarioId }) : undefined,
      disabledUnits: [],
      skippable: false,
    }) as CampaignMission;

  const campaign = (title: string, missions: CampaignMission[]) =>
    ({ title, missions }) as Campaign;

  it("names the campaign whose mission carries the scenario", () => {
    expect(
      campaignsUsingScenario(
        [campaign("Core Contingency", [mission(), mission("s1")])],
        "s1",
      ),
    ).toEqual(["Core Contingency"]);
  });

  it("names every campaign that carries it", () => {
    expect(
      campaignsUsingScenario(
        [
          campaign("Core Contingency", [mission("s1")]),
          campaign("Battle Tactics", [mission("s2")]),
          campaign("The Cold Place", [mission("s1")]),
        ],
        "s1",
      ),
    ).toEqual(["Core Contingency", "The Cold Place"]);
  });

  // A row counts campaigns, not attachments, so a campaign using the same
  // scenario twice is still one campaign to lose it from.
  it("counts a campaign once however many of its missions carry it", () => {
    expect(
      campaignsUsingScenario(
        [campaign("Core Contingency", [mission("s1"), mission("s1")])],
        "s1",
      ),
    ).toEqual(["Core Contingency"]);
  });

  it("finds nothing when no mission carries it", () => {
    expect(
      campaignsUsingScenario([campaign("Core Contingency", [mission()])], "s1"),
    ).toEqual([]);
  });
});

describe("playableScenarios", () => {
  it("keeps a scenario that names a game and a map", () => {
    expect(isSetUp(build())).toBe(true);
    expect(playableScenarios([build()])).toHaveLength(1);
  });

  it("drops a draft with no game or no map", () => {
    const noGame = build({
      id: "s2",
      setup: {
        gameName: "",
        mapName: "Comet Catcher Redux",
        startPosType: 0,
        modOptionValues: {},
        participants: [],
      },
    });
    const noMap = build({
      id: "s3",
      setup: {
        gameName: "Splinter Faction test",
        mapName: "",
        startPosType: 0,
        modOptionValues: {},
        participants: [],
      },
    });

    expect(isSetUp(noGame)).toBe(false);
    expect(isSetUp(noMap)).toBe(false);
    expect(playableScenarios([build(), noGame, noMap])).toEqual([build()]);
  });

  it("keeps the order it was given, which is newest edit first", () => {
    const first = build({ id: "a" });
    const second = build({ id: "b" });

    expect(playableScenarios([first, second]).map((s) => s.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
