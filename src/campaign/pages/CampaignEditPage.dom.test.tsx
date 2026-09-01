// @vitest-environment happy-dom
/**
 * What it takes to remove a mission from a campaign (issue #2192).
 *
 * The trash button used to remove the mission on the first click, and delete
 * its panorama from disk with it, so a misclick on the row next to Edit threw
 * away a briefing, objectives and an attached scenario. The half of that worth
 * pinning is the cancel: the mission has to survive, and so does the file,
 * because the file is the part nothing can bring back.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The drawer is the app shell's, and nothing opened in it bears on removal.
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));

// The campaign comes off disk through the plugin, and the writes go back the
// same way. Both stand in, so what is asserted is what the page asked for.
const { campaignSave, campaignImageDelete, useCampaigns } = vi.hoisted(() => ({
  campaignSave: vi.fn(async (_args: { id: string; json: string }) => ({})),
  campaignImageDelete: vi.fn(
    async (_args: { campaignId: string; file: string }) => ({}),
  ),
  useCampaigns: vi.fn(),
}));
vi.mock("../bindings", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../bindings")),
  campaignSave,
  campaignImageDelete,
}));
vi.mock("../campaigns", () => ({
  useCampaigns,
  refreshCampaigns: async () => [],
}));
vi.mock("@/scenario/scenarios", () => ({
  useScenarios: () => ({ scenarios: [], loading: false }),
}));
vi.mock("@/play/presets", () => ({
  useSkirmishPresets: () => ({ presets: [] }),
}));
vi.mock("@/play/config", () => ({ usePreferredTarget: () => ({}) }));
vi.mock("@/content/config", () => ({
  useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
}));
// Both reach for stored media through the coilbox:// protocol, which a test has
// no business standing up, and neither is part of removing a mission.
vi.mock("./components/CampaignImage", () => ({
  CampaignImage: () => null,
  CampaignImageField: () => null,
}));
vi.mock("./components/PanoramaScroller", () => ({
  PanoramaScroller: () => null,
}));

import { newScenario } from "@/scenario/create";
import { attachScenario } from "../missionScenario";
import type { Campaign, CampaignMission } from "../model";
import CampaignEditPage from "./CampaignEditPage";

const source = { ...newScenario("Beachhead"), id: "beachhead" };

/** A mission with real authoring on it, including an imported panorama. */
function mission(): CampaignMission {
  return attachScenario(
    {
      id: "m1",
      title: "Beachhead",
      briefing: "Take the shore before dawn.",
      objectives: ["Hold the beach"],
      panorama: { kind: "file", file: "shore.jpg" },
      snapshot: source.setup,
      disabledUnits: ["armbrtha"],
      skippable: false,
    },
    source,
  );
}

function campaign(missions: CampaignMission[]): Campaign {
  return {
    schemaVersion: 1,
    id: "c1",
    type: "ta",
    title: "Landfall",
    description: "",
    missions,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function show(missions: CampaignMission[]) {
  useCampaigns.mockReturnValue({
    campaigns: [{ campaign: campaign(missions), source: "local" }],
    loading: false,
    error: null,
  });
  render(
    <MemoryRouter initialEntries={["/campaign-builder/c1"]}>
      <Routes>
        <Route path="/campaign-builder/:id" element={<CampaignEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The missions the page last asked the plugin to store. */
function savedMissions(): CampaignMission[] {
  const last = campaignSave.mock.calls.at(-1)?.[0];
  if (!last) throw new Error("nothing was saved");
  return (JSON.parse(last.json) as Campaign).missions;
}

beforeEach(() => {
  campaignSave.mockClear();
  campaignImageDelete.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("removing a campaign mission", () => {
  it("asks first, and says what the mission holds", () => {
    show([mission()]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));

    expect(screen.getByText("Remove Beachhead?")).toBeTruthy();
    expect(screen.getByText("its briefing")).toBeTruthy();
    expect(screen.getByText("1 objective")).toBeTruthy();
    expect(screen.getByText("1 unit restriction")).toBeTruthy();
    expect(
      screen.getByText("its panorama image, deleted from disk"),
    ).toBeTruthy();
    expect(screen.getByText(/copy of the scenario "Beachhead"/)).toBeTruthy();
    // Nothing has happened yet: the mission is still in the list, and the
    // panorama is still on disk.
    expect(screen.getByText("1. Beachhead")).toBeTruthy();
    expect(campaignSave).not.toHaveBeenCalled();
    expect(campaignImageDelete).not.toHaveBeenCalled();
  });

  it("leaves the mission and its panorama alone when the answer is no", () => {
    show([mission()]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Remove Beachhead?")).toBeNull();
    expect(screen.getByText("1. Beachhead")).toBeTruthy();
    expect(campaignImageDelete).not.toHaveBeenCalled();
    expect(campaignSave).not.toHaveBeenCalled();
  });

  it("removes the mission and deletes its panorama once confirmed", async () => {
    show([mission()]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await vi.waitFor(() => expect(campaignSave).toHaveBeenCalled());

    expect(campaignImageDelete).toHaveBeenCalledWith({
      campaignId: "c1",
      file: "shore.jpg",
    });
    expect(savedMissions()).toEqual([]);
    expect(screen.queryByText("1. Beachhead")).toBeNull();
  });

  it("does not claim a mission holds what it does not", () => {
    show([
      {
        id: "m2",
        title: "Empty",
        briefing: "",
        objectives: [],
        snapshot: source.setup,
        disabledUnits: [],
        skippable: false,
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Empty" }));

    expect(
      screen.getByText(/nothing has been written on this mission/),
    ).toBeTruthy();
  });
});
