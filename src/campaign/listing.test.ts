import { describe, expect, it } from "vitest";
import {
  campaignFallbackMap,
  campaignGameLabel,
  campaignIsPlayable,
  campaignSummary,
  sortCampaigns,
} from "./listing";
import type { Campaign, CampaignMission } from "./model";

/** A mission carrying only the snapshot fields a row reads. */
function mission(gameName: string, mapName = "Comet Catcher"): CampaignMission {
  return {
    id: crypto.randomUUID(),
    title: "M",
    briefing: "",
    objectives: [],
    snapshot: { gameName, mapName } as CampaignMission["snapshot"],
    disabledUnits: [],
    skippable: false,
  };
}

function campaign(
  missions: CampaignMission[],
  updatedAt = "2026-09-01T12:00:00.000Z",
): Campaign {
  return {
    schemaVersion: 1,
    id: "c",
    type: "ta",
    title: "C",
    description: "",
    missions,
    createdAt: "",
    updatedAt,
  };
}

const now = Date.parse("2026-09-01T12:00:00.000Z");

describe("campaignGameLabel", () => {
  it("names the game when every mission is on it", () => {
    expect(campaignGameLabel(campaign([mission("BAR"), mission("BAR")]))).toBe(
      "BAR",
    );
  });

  it("counts the games when the missions do not agree", () => {
    expect(
      campaignGameLabel(
        campaign([mission("BAR"), mission("Zero-K"), mission("BAR")]),
      ),
    ).toBe("2 games");
  });

  it("has no answer for a campaign with no missions", () => {
    expect(campaignGameLabel(campaign([]))).toBeNull();
  });

  it("ignores a mission whose snapshot names no game", () => {
    expect(campaignGameLabel(campaign([mission("BAR"), mission("")]))).toBe(
      "BAR",
    );
  });
});

describe("campaignSummary", () => {
  it("reads game, size and last edit", () => {
    const c = campaign([mission("BAR")], "2026-09-01T10:00:00.000Z");
    expect(campaignSummary(c, now)).toBe("BAR · 1 mission · edited 2h ago");
  });

  it("drops the game rather than leading with a gap", () => {
    expect(campaignSummary(campaign([], "2026-09-01T10:00:00.000Z"), now)).toBe(
      "0 missions · edited 2h ago",
    );
  });

  it("drops the edit time when the document carries none", () => {
    expect(campaignSummary(campaign([mission("BAR")], ""), now)).toBe(
      "BAR · 1 mission",
    );
  });
});

describe("campaignIsPlayable", () => {
  it("plays a campaign whose every mission names a game and a map", () => {
    expect(campaignIsPlayable(campaign([mission("BAR"), mission("BAR")]))).toBe(
      true,
    );
  });

  it("cannot play a campaign with no missions", () => {
    expect(campaignIsPlayable(campaign([]))).toBe(false);
  });

  it("cannot play a campaign whose mission names no game", () => {
    expect(campaignIsPlayable(campaign([mission("")]))).toBe(false);
  });

  it("cannot play a campaign whose mission names no map", () => {
    expect(campaignIsPlayable(campaign([mission("BAR", "")]))).toBe(false);
  });

  // Play order is the array order, so a mission nobody can launch stops the
  // campaign there however many good ones came first.
  it("cannot play a campaign whose last mission is incomplete", () => {
    expect(campaignIsPlayable(campaign([mission("BAR"), mission("")]))).toBe(
      false,
    );
  });

  // A preset-only mission is a supported campaign mission that plays as an
  // ordinary skirmish, so a campaign of them is finished, not a draft.
  it("plays a campaign whose missions carry no scenario", () => {
    const c = campaign([mission("BAR")]);
    expect(c.missions[0].scenario).toBeUndefined();
    expect(campaignIsPlayable(c)).toBe(true);
  });
});

describe("campaignFallbackMap", () => {
  it("takes the first mission's map, not any later one", () => {
    const c = campaign([
      mission("BAR", "Comet Catcher"),
      mission("BAR", "Delta Siege"),
    ]);
    expect(campaignFallbackMap(c)).toBe("Comet Catcher");
  });

  it("has no map for a campaign with no missions", () => {
    expect(campaignFallbackMap(campaign([]))).toBeNull();
  });

  it("has no map when the first mission names none", () => {
    expect(campaignFallbackMap(campaign([mission("BAR", "")]))).toBeNull();
  });
});

describe("sortCampaigns", () => {
  /** A list entry as `useCampaigns` holds one, named so the order is readable. */
  function row(id: string, updatedAt: string, source: "local" | "bundled") {
    return { campaign: { ...campaign([]), id, updatedAt }, source };
  }

  const ids = (list: { campaign: Campaign }[]) =>
    list.map((l) => l.campaign.id);

  it("puts the newest edit first", () => {
    const sorted = sortCampaigns([
      row("older", "2026-08-01T00:00:00.000Z", "local"),
      row("newest", "2026-09-01T00:00:00.000Z", "local"),
      row("middle", "2026-08-20T00:00:00.000Z", "local"),
    ]);
    expect(ids(sorted)).toEqual(["newest", "middle", "older"]);
  });

  it("keeps bundled campaigns below the author's own, however new they are", () => {
    const sorted = sortCampaigns([
      row("bundled-today", "2026-09-01T00:00:00.000Z", "bundled"),
      row("mine-last-month", "2026-08-01T00:00:00.000Z", "local"),
    ]);
    expect(ids(sorted)).toEqual(["mine-last-month", "bundled-today"]);
  });

  it("orders bundled campaigns among themselves by edit too", () => {
    const sorted = sortCampaigns([
      row("bundled-old", "2026-01-01T00:00:00.000Z", "bundled"),
      row("bundled-new", "2026-08-01T00:00:00.000Z", "bundled"),
    ]);
    expect(ids(sorted)).toEqual(["bundled-new", "bundled-old"]);
  });

  // A hand-authored or bundled document can omit `updatedAt`, which
  // `parseCampaignJson` reads as "". Sorting it to the top would be a worse
  // arbitrary order than the read order it replaced.
  it("sinks a campaign with no timestamp below the dated ones", () => {
    const sorted = sortCampaigns([
      row("undated", "", "local"),
      row("dated", "2026-01-01T00:00:00.000Z", "local"),
    ]);
    expect(ids(sorted)).toEqual(["dated", "undated"]);
  });

  it("leaves campaigns that cannot be told apart in the order they were read", () => {
    const sorted = sortCampaigns([
      row("first", "", "local"),
      row("second", "", "local"),
      row("third", "", "local"),
    ]);
    expect(ids(sorted)).toEqual(["first", "second", "third"]);
  });

  it("does not reorder the caller's array", () => {
    const list = [
      row("old", "2026-01-01T00:00:00.000Z", "local"),
      row("new", "2026-09-01T00:00:00.000Z", "local"),
    ];
    sortCampaigns(list);
    expect(ids(list)).toEqual(["old", "new"]);
  });
});
