import { describe, expect, it } from "vitest";
import type { Campaign } from "../campaign/model";
import { defaultSkirmishDraft } from "../play/drafts";
import { resolveStart, type StartCampaign } from "./start";

function mission(id: string, title: string): Campaign["missions"][number] {
  return {
    id,
    title,
    briefing: "",
    objectives: [],
    disabledUnits: [],
    skippable: false,
    snapshot: defaultSkirmishDraft,
  };
}

function campaign(
  id: string,
  source: StartCampaign["source"] = "bundled",
  missions = [mission("m1", "Landfall"), mission("m2", "The Ridge")],
): StartCampaign {
  return {
    source,
    campaign: {
      schemaVersion: 1,
      id,
      type: "ta",
      title: "Basic Training",
      description: "",
      missions,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  };
}

/** The issue text of a resolution that must be a problem. */
function issue(raw: unknown, campaigns: StartCampaign[]): string {
  const r = resolveStart(raw, campaigns);
  if (r.status !== "problem")
    throw new Error(`expected a problem, got ${r.status}`);
  return r.issue;
}

describe("resolveStart", () => {
  it("is nothing at all for a profile with no start key", () => {
    // Every profile written before the key existed, and plain coilbox.
    expect(resolveStart(undefined, [campaign("c1")])).toEqual({
      status: "none",
    });
    expect(resolveStart(null, [])).toEqual({ status: "none" });
  });

  it("takes the first mission when only a campaign is named", () => {
    const r = resolveStart({ campaign: "c1" }, [campaign("c1")]);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.campaign.id).toBe("c1");
    expect(r.mission.id).toBe("m1");
  });

  it("takes the named mission", () => {
    const r = resolveStart({ campaign: "c1", mission: "m2" }, [campaign("c1")]);
    expect(r.status === "ok" && r.mission.id).toBe("m2");
  });

  it("reports a campaign that is not there", () => {
    expect(issue({ campaign: "nope" }, [campaign("c1")])).toContain(
      "'nope' is not bundled",
    );
  });

  it("refuses a local campaign, which players will not have", () => {
    expect(issue({ campaign: "c1" }, [campaign("c1", "local")])).toContain(
      "local campaign",
    );
  });

  it("reports a mission the campaign does not have", () => {
    expect(issue({ campaign: "c1", mission: "m9" }, [campaign("c1")])).toBe(
      "start mission 'm9' is not in campaign 'Basic Training'",
    );
  });

  it("reports a campaign with no missions to start on", () => {
    expect(
      issue({ campaign: "c1" }, [campaign("c1", "bundled", [])]),
    ).toContain("has no missions");
  });

  it("reports a value of the wrong shape instead of throwing", () => {
    // `profile.json` is cast, not validated, so anything can arrive.
    for (const raw of ["c1", 3, [], {}, { campaign: 3 }, { campaign: "" }]) {
      expect(issue(raw, [campaign("c1")])).toContain("`start` must be");
    }
    expect(issue({ campaign: "c1", mission: 2 }, [campaign("c1")])).toContain(
      "`start.mission`",
    );
  });
});
