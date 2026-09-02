/**
 * What a shut group in the mission editor says it is holding (issue #2261).
 *
 * The point of the whole restructure rests on these strings. Four groups that
 * only named themselves would be worse than the flat scroll they replace: an
 * author who wanted to know whether a mission had a voiceover would have to
 * open all four to find out, where scrolling used to answer it. So each one is
 * asserted in both states, set and unset.
 */

import { describe, expect, it } from "vitest";
import { newScenario } from "@/scenario/create";
import type { CampaignMission } from "../../model";
import {
  contentSummary,
  DEFAULT_OPEN,
  presentationSummary,
  rulesSummary,
  scenarioSummary,
  storedGroups,
} from "./missionEditorGroups";

function mission(over: Partial<CampaignMission> = {}): CampaignMission {
  return {
    id: "m1",
    title: "Beachhead",
    briefing: "",
    objectives: [],
    snapshot: newScenario("Beachhead").setup,
    disabledUnits: [],
    skippable: false,
    ...over,
  };
}

describe("which groups open by default", () => {
  it("opens the mission itself and leaves the rest shut", () => {
    expect(DEFAULT_OPEN).toEqual({
      content: true,
      scenario: false,
      presentation: false,
      rules: false,
    });
  });

  it("takes a remembered choice over the default", () => {
    expect(storedGroups('{"rules":true,"content":false}')).toEqual({
      rules: true,
      content: false,
    });
  });

  it("ignores junk left under the key by something else", () => {
    expect(storedGroups("not json")).toEqual({});
    expect(storedGroups(null)).toEqual({});
    expect(storedGroups('{"rules":"yes","nonsense":true}')).toEqual({});
  });
});

describe("Content", () => {
  it("says there is no briefing and no objectives", () => {
    expect(contentSummary(mission())).toBe("No briefing, 0 objectives");
  });

  it("counts the objectives and names the briefing", () => {
    expect(
      contentSummary(
        mission({ briefing: "Hold the line", objectives: ["Survive"] }),
      ),
    ).toBe("Briefing written, 1 objective");
  });

  it("calls whitespace no briefing", () => {
    expect(contentSummary(mission({ briefing: "   \n " }))).toBe(
      "No briefing, 0 objectives",
    );
  });

  it("says a mission can be skipped", () => {
    expect(contentSummary(mission({ skippable: true }))).toBe(
      "No briefing, 0 objectives, skippable",
    );
  });
});

describe("Scenario", () => {
  it("says when nothing is attached", () => {
    expect(scenarioSummary(mission())).toBe("No scenario attached");
  });

  it("names the scenario and what is in it", () => {
    const scenario = newScenario("Bismuth Valley");
    scenario.zones = [
      {
        id: "z1",
        name: "Ridge",
        shape: "circle",
        center: { x: 0, z: 0 },
        radius: 200,
      },
    ];
    expect(scenarioSummary(mission({ scenario }))).toBe(
      "Bismuth Valley · 0 unit placements · 1 zone · 0 triggers · 0 objectives",
    );
  });
});

describe("Presentation", () => {
  it("names all four slots when none is set", () => {
    expect(presentationSummary(mission())).toBe(
      "No panorama, side graphic, voiceover or cutscene",
    );
  });

  it("names the source a slot draws from, not just the slot", () => {
    expect(
      presentationSummary(
        mission({
          panoramaMap: { style: "textured" },
          sideGraphicUnit: { unitDef: "armcom" },
        }),
      ),
    ).toBe("Map panorama, armcom side graphic");
  });

  it("tells an imported video from an imported image", () => {
    expect(
      presentationSummary(
        mission({
          panorama: { kind: "file", file: "backdrop.mp4" },
          sideGraphic: { kind: "file", file: "emblem.png" },
        }),
      ),
    ).toBe("Panorama video, side graphic image");
  });

  it("lists the audio and video cues", () => {
    expect(
      presentationSummary(
        mission({
          voiceover: { kind: "file", file: "brief.ogg" },
          cutscene: { kind: "file", file: "intro.mp4" },
        }),
      ),
    ).toBe("Voiceover, cutscene");
  });
});

describe("Rules", () => {
  it("says when there are none", () => {
    expect(rulesSummary(mission())).toBe("No restrictions");
  });

  it("counts the bans", () => {
    expect(rulesSummary(mission({ disabledUnits: ["armcom"] }))).toBe(
      "1 unit banned",
    );
    expect(
      rulesSummary(
        mission({ disabledUnits: ["armcom", "corcom", "armflash"] }),
      ),
    ).toBe("3 units banned");
  });
});
