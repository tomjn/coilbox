// @vitest-environment happy-dom
/**
 * What the play list does with a campaign nobody can play (issue #2219).
 *
 * The list used to draw every stored campaign the same way, so a campaign with
 * no missions got a card reading "0/0 missions" and a chevron into a detail
 * page holding a title and an empty list. A campaign whose third mission names
 * no map looked finished until it failed at launch.
 *
 * Neither is hidden. The Campaigns nav item appears as soon as any campaign is
 * stored, so hiding the only one would strand the reader on "No campaigns yet",
 * and in an app where the author and the player are the same person that reads
 * as data loss. What changes is what the card says, and whether it offers a
 * click that goes nowhere.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stored campaigns and saved progress come off disk through the plugin. What is
// under test is the card built from them.
const { useCampaigns, useCampaignProgress } = vi.hoisted(() => ({
  useCampaigns: vi.fn(),
  useCampaignProgress: vi.fn(),
}));
vi.mock("../campaigns", () => ({ useCampaigns, useCampaignProgress }));

// The emblem resolves its image through the plugin, and bears on nothing here.
vi.mock("./components/CampaignImage", () => ({
  CampaignIconBox: () => <div data-testid="icon" />,
}));

import type { LoadedCampaign } from "../campaigns";
import type { Campaign, CampaignMission } from "../model";
import CampaignsPage from "./CampaignsPage";

/** A mission carrying only the snapshot fields a card reads. */
function mission(gameName: string, mapName = "Comet Catcher"): CampaignMission {
  return {
    id: `${gameName}-${mapName}`,
    title: "M",
    briefing: "",
    objectives: [],
    snapshot: { gameName, mapName } as CampaignMission["snapshot"],
    disabledUnits: [],
    skippable: false,
  };
}

function campaignOf(missions: CampaignMission[]): LoadedCampaign {
  const campaign: Campaign = {
    schemaVersion: 1,
    id: "beachhead",
    type: "ta",
    title: "Beachhead",
    description: "",
    missions,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return { campaign, source: "local" };
}

function show(campaigns: LoadedCampaign[]) {
  useCampaigns.mockReturnValue({ campaigns, loading: false, error: null });
  useCampaignProgress.mockReturnValue({
    progress: { schemaVersion: 1, campaigns: {} },
    loading: false,
    error: null,
  });
  return render(
    <MemoryRouter initialEntries={["/campaign"]}>
      <Routes>
        <Route path="/campaign" element={<CampaignsPage />} />
        <Route path="/campaign/:id" element={<p>The campaign detail page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a campaign with no missions", () => {
  const emptyCampaign = campaignOf([]);

  it("is listed rather than hidden", () => {
    show([emptyCampaign]);

    expect(screen.getByText("Beachhead")).toBeTruthy();
    expect(screen.queryByText("No campaigns yet.")).toBeNull();
  });

  it("says it has no missions yet", () => {
    show([emptyCampaign]);

    expect(screen.getByText("No missions yet")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  // The detail page it would open holds a title, a 0% bar and an empty list.
  it("offers no click into a page with nothing on it", () => {
    show([emptyCampaign]);

    expect(screen.queryByRole("link", { name: /Beachhead/ })).toBeNull();
  });

  it("does not count missions nobody is playing", () => {
    show([emptyCampaign]);

    expect(screen.queryByText("0/0 missions")).toBeNull();
  });
});

describe("a campaign whose mission names no map", () => {
  const shortCampaign = campaignOf([
    mission("BAR"),
    mission("BAR"),
    mission("BAR", ""),
  ]);

  it("says which mission stops it", () => {
    show([shortCampaign]);

    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("Mission 3 has no map")).toBeTruthy();
  });

  // Missions one and two play, so the detail page is worth opening. Only the
  // campaign with nothing in it loses its link.
  it("keeps its link and its mission count", () => {
    show([shortCampaign]);

    expect(
      screen.getByRole("link", { name: /Beachhead/ }).getAttribute("href"),
    ).toBe("/campaign/beachhead");
    expect(screen.getByText("0/3 missions")).toBeTruthy();
  });
});

describe("a campaign that plays", () => {
  it("is left alone", () => {
    show([campaignOf([mission("BAR"), mission("BAR")])]);

    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.getByText("0/2 missions")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Beachhead/ }).getAttribute("href"),
    ).toBe("/campaign/beachhead");
  });
});
