import { describe, expect, it } from "vitest";
import type { Campaign, CampaignMission, CampaignProgress } from "./model";
import { missionStates } from "./progress";

/** Build a minimal mission with only the fields `missionStates` reads. */
function mission(id: string, skippable = false): CampaignMission {
  return {
    id,
    title: id,
    briefing: "",
    objectives: [],
    // The snapshot shape is irrelevant to progress derivation.
    snapshot: {} as CampaignMission["snapshot"],
    disabledUnits: [],
    skippable,
  };
}

function campaign(missions: CampaignMission[]): Campaign {
  return {
    schemaVersion: 1,
    id: "c",
    type: "ta",
    title: "C",
    description: "",
    missions,
    createdAt: "",
    updatedAt: "",
  };
}

function progress(completed: string[]): CampaignProgress {
  return { completedMissionIds: completed, updatedAt: "" };
}

describe("missionStates", () => {
  it("with empty progress unlocks only the first mission", () => {
    const c = campaign([mission("a"), mission("b"), mission("c")]);
    const states = missionStates(c, undefined);
    expect(states.get("a")).toBe("available");
    expect(states.get("b")).toBe("locked");
    expect(states.get("c")).toBe("locked");
  });

  it("unlocks the next mission once the previous is complete", () => {
    const c = campaign([mission("a"), mission("b"), mission("c")]);
    const states = missionStates(c, progress(["a"]));
    expect(states.get("a")).toBe("complete");
    expect(states.get("b")).toBe("available");
    expect(states.get("c")).toBe("locked");
  });

  it("marks every mission complete when all are done", () => {
    const c = campaign([mission("a"), mission("b"), mission("c")]);
    const states = missionStates(c, progress(["a", "b", "c"]));
    expect([...states.values()]).toEqual(["complete", "complete", "complete"]);
  });

  it("lets a skippable mission carry availability past an unfinished one", () => {
    // a available -> b skippable is available -> c skippable is available too.
    const c = campaign([mission("a"), mission("b", true), mission("c", true)]);
    const states = missionStates(c, undefined);
    expect(states.get("a")).toBe("available");
    expect(states.get("b")).toBe("available");
    expect(states.get("c")).toBe("available");
  });

  it("does not unlock a non-skippable mission after a skipped-over one", () => {
    // a available, b skippable available, c NOT skippable -> locked (b unbeaten).
    const c = campaign([mission("a"), mission("b", true), mission("c")]);
    const states = missionStates(c, undefined);
    expect(states.get("a")).toBe("available");
    expect(states.get("b")).toBe("available");
    expect(states.get("c")).toBe("locked");
  });

  it("stops the chain at a locked non-skippable gap", () => {
    // a available, b locked (non-skippable, a unbeaten), c skippable but prev is
    // locked -> also locked.
    const c = campaign([mission("a"), mission("b"), mission("c", true)]);
    const states = missionStates(c, undefined);
    expect(states.get("a")).toBe("available");
    expect(states.get("b")).toBe("locked");
    expect(states.get("c")).toBe("locked");
  });
});
