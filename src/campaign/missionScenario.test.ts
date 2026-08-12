import { describe, expect, it } from "vitest";
import type { Scenario } from "../scenario/model";
import {
  attachScenario,
  detachScenario,
  missionFromScenario,
  scenarioAttachment,
  scenarioIsAttached,
} from "./missionScenario";
import type { Campaign, CampaignMission } from "./model";

function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    schemaVersion: 2,
    id: "s1",
    name: "Ambush",
    description: "",
    runtimeVersion: 1,
    setup: {
      participants: [],
      gameName: "BAR",
      mapName: "Bismuth Valley",
      startPosType: 0,
      modOptionValues: {},
    },
    teams: {},
    zones: [],
    actors: [],
    groups: [],
    blueprints: [],
    bases: [],
    restrictions: {},
    vars: {},
    triggers: [],
    objectives: [],
    dialogue: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function mission(over: Partial<CampaignMission> = {}): CampaignMission {
  return {
    id: "m1",
    title: "Mission 1",
    briefing: "Hold the line.",
    objectives: ["Survive"],
    snapshot: {
      participants: [],
      gameName: "Old game",
      mapName: "Old map",
      startPosType: 0,
      modOptionValues: {},
    },
    disabledUnits: [],
    skippable: false,
    ...over,
  };
}

describe("attachScenario", () => {
  it("copies the document rather than referencing it", () => {
    const source = scenario();
    const attached = attachScenario(mission(), source);
    source.name = "Renamed";
    source.setup.mapName = "Somewhere else";
    expect(attached.scenario?.name).toBe("Ambush");
    expect(attached.snapshot.mapName).toBe("Bismuth Valley");
  });

  it("takes the mission's game and map from the scenario's setup", () => {
    const attached = attachScenario(mission(), scenario());
    expect(attached.snapshot.gameName).toBe("BAR");
    expect(attached.snapshot.mapName).toBe("Bismuth Valley");
  });

  it("leaves the mission's presentation alone", () => {
    const attached = attachScenario(mission(), scenario());
    expect(attached.title).toBe("Mission 1");
    expect(attached.briefing).toBe("Hold the line.");
    expect(attached.objectives).toEqual(["Survive"]);
  });
});

describe("detachScenario", () => {
  it("removes the key entirely, keeping the snapshot", () => {
    const attached = attachScenario(mission(), scenario());
    const detached = detachScenario(attached);
    expect("scenario" in detached).toBe(false);
    expect(detached.snapshot.mapName).toBe("Bismuth Valley");
  });
});

describe("missionFromScenario", () => {
  it("titles the mission after the scenario and carries no presentation", () => {
    const built = missionFromScenario(scenario());
    expect(built.title).toBe("Ambush");
    expect(built.briefing).toBe("");
    expect(built.objectives).toEqual([]);
    expect(built.scenario?.id).toBe("s1");
    expect(built.snapshot.gameName).toBe("BAR");
  });
});

describe("scenarioIsAttached", () => {
  const campaign = (missions: CampaignMission[]): Campaign => ({
    schemaVersion: 1,
    id: "c1",
    type: "ta",
    title: "Test",
    description: "",
    missions,
    createdAt: "t0",
    updatedAt: "t1",
  });

  it("finds a scenario a mission carries", () => {
    const attached = attachScenario(mission(), scenario());
    expect(scenarioIsAttached([campaign([attached])], "s1")).toBe(true);
  });

  it("is false when no mission carries it", () => {
    expect(scenarioIsAttached([campaign([mission()])], "s1")).toBe(false);
    const attached = attachScenario(mission(), scenario({ id: "other" }));
    expect(scenarioIsAttached([campaign([attached])], "s1")).toBe(false);
  });

  it("is false with no campaigns at all", () => {
    expect(scenarioIsAttached([], "s1")).toBe(false);
  });
});

describe("scenarioAttachment", () => {
  it("reports none for a scenario-less mission", () => {
    expect(scenarioAttachment(mission(), [scenario()])).toEqual({
      state: "none",
    });
  });

  it("reports current when the stored scenario has the same updatedAt", () => {
    const live = scenario();
    const attached = attachScenario(mission(), live);
    expect(scenarioAttachment(attached, [live]).state).toBe("current");
  });

  it("reports stale once the stored scenario has been edited since", () => {
    const attached = attachScenario(mission(), scenario());
    const live = scenario({ updatedAt: "2026-02-02T00:00:00.000Z" });
    const found = scenarioAttachment(attached, [live]);
    expect(found.state).toBe("stale");
    expect(found).toMatchObject({
      live: { updatedAt: "2026-02-02T00:00:00.000Z" },
    });
  });

  it("reports orphaned when no stored scenario has that id", () => {
    const attached = attachScenario(mission(), scenario());
    expect(scenarioAttachment(attached, []).state).toBe("orphaned");
    expect(
      scenarioAttachment(attached, [scenario({ id: "other" })]).state,
    ).toBe("orphaned");
  });
});
