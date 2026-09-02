/**
 * The reverse of `compile.ts`'s own path grammar (issue #2271): given the path
 * a `MissionIssue` carries, which registry it names and so which panel, if
 * any, owns the row.
 */

import { describe, expect, it } from "vitest";
import { placementKey } from "@/placement/placements";
import { problemTarget } from "./problemTargets";
import { zoneKey } from "./zones";

describe("what a mission problem's path points at", () => {
  it("names the trigger for a path under its own registry", () => {
    expect(problemTarget('triggers["open"].difficulty')).toEqual({
      kind: "trigger",
      triggerId: "open",
    });
  });

  it("names the trigger for a step parameter nested under it", () => {
    expect(problemTarget('triggers["open"].actions[0].params.zone')).toEqual({
      kind: "trigger",
      triggerId: "open",
    });
  });

  it("names the objective for a path under its own registry", () => {
    expect(problemTarget('objectives["hold-ridge"].text')).toEqual({
      kind: "objective",
      id: "hold-ridge",
    });
  });

  it("names the variable for a path under the vars registry", () => {
    expect(problemTarget('vars["waves"]')).toEqual({
      kind: "variable",
      name: "waves",
    });
  });

  it("gives the zone's own map selection key", () => {
    expect(problemTarget('zones["north"]')).toEqual({
      kind: "map",
      key: zoneKey("north"),
    });
  });

  it("gives an actor's own map selection key", () => {
    expect(problemTarget('actors["commander"].pos')).toEqual({
      kind: "map",
      key: placementKey("actor", "commander"),
    });
  });

  it("gives a group's own map selection key", () => {
    expect(problemTarget('groups["squad"].orders[0].target')).toEqual({
      kind: "map",
      key: placementKey("group", "squad", 0),
    });
  });

  it("gives a base's own map selection key, spelled prefabs in the compiled file", () => {
    expect(problemTarget('prefabs["base-1"].buildings[0].offset')).toEqual({
      kind: "map",
      key: placementKey("base", "base-1", 0),
    });
  });

  it("finds nothing for the mission as a whole", () => {
    expect(problemTarget("mission")).toBeNull();
  });

  it("finds nothing for a packaged mission's own read failure", () => {
    expect(problemTarget("mission.lua")).toBeNull();
  });

  it("finds nothing for a dialogue line, which has no owning panel here", () => {
    expect(problemTarget('dialogue["briefing"].text')).toBeNull();
  });

  it("finds nothing for a team, which has no owning panel here", () => {
    expect(problemTarget('teams["player"]')).toBeNull();
  });

  it("finds nothing for an id that does not parse as JSON", () => {
    expect(problemTarget('triggers["unterminated')).toBeNull();
  });
});
