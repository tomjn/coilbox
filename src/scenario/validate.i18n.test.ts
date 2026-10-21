/**
 * Issue #4604: the mission problem messages, the noun and location tables and
 * the trigger type tables resolve when they are read, so a catalog loaded after
 * the modules still translates them. The catalog is a fixture, not a real
 * translation.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { afterEach, describe, expect, it } from "vitest";
import { ACTION_TYPES, groupLabel, TYPE_DESCRIPTIONS } from "./triggerTypes";
import { describeIssue, validateMission } from "./validate";

function fixtureCatalog() {
  return {
    [msg`group`.id]: "Fixture group",
    [msg`Trigger`.id]: "Fixture trigger",
    [msg`Units`.id]: "Fixture units",
    [msg`Marks an objective as done.`.id]: "Fixture done",
    [msg`position`.id]: "Fixture position",
  };
}

afterEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the mission problem strings", () => {
  const mission = {
    triggers: [
      {
        id: "open",
        conditions: { conditions: [] },
        actions: [{ type: "spawn_group", params: { group: "g" } }],
      },
    ],
  };

  it("stay English without a translation", () => {
    const [issue] = validateMission(mission);
    expect(issue.message).toBe('no group called "g"');
    expect(describeIssue(issue)).toBe(
      'Trigger "open", action 1, group: no group called "g"',
    );
  });

  it("use the fixture catalog for the noun and the location", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    const [issue] = validateMission(mission);
    expect(issue.message).toBe('no Fixture group called "g"');
    expect(describeIssue(issue)).toBe(
      'Fixture trigger "open", action 1, group: no Fixture group called "g"',
    );
  });
});

describe("the trigger type tables", () => {
  it("translate descriptions, parameter labels and bands when read", () => {
    expect(TYPE_DESCRIPTIONS.complete_objective).toBe(
      "Marks an objective as done.",
    );
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    expect(TYPE_DESCRIPTIONS.complete_objective).toBe("Fixture done");
    expect(ACTION_TYPES.camera_pan.pos.label).toBe("Fixture position");
    expect(groupLabel("Units")).toBe("Fixture units");
    expect(groupLabel("Not a band")).toBe("Not a band");
  });
});
