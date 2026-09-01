// @vitest-environment happy-dom
/**
 * The two irreversible things a mission row offers: removing the mission
 * (issue #2192) and re-copying its scenario (issue #2199).
 *
 * The trash button used to remove the mission on the first click, and delete
 * its panorama from disk with it, so a misclick on the row next to Edit threw
 * away a briefing, objectives and an attached scenario. The half of that worth
 * pinning is the cancel: the mission has to survive, and so does the file,
 * because the file is the part nothing can bring back.
 *
 * Updating the scenario is the same shape of loss in a quieter form. A mission
 * plays its own copy, and once the builder's document has moved on the copy is
 * the only one of itself, so the case worth pinning is which document ends up
 * saved and when the action is offered at all.
 *
 * The third thing here is what the page says about its own writes (issue
 * #2198). It saves as you go and never asks, so the case that has to hold is
 * the refused write: an indicator that can only ever say "Saved" is worse than
 * no indicator, because it is believed.
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
const {
  campaignSave,
  campaignImageDelete,
  useCampaigns,
  useScenarios,
  refreshCampaigns,
} = vi.hoisted(() => ({
  campaignSave: vi.fn(async (_args: { id: string; json: string }) => ({})),
  campaignImageDelete: vi.fn(
    async (_args: { campaignId: string; file: string }) => ({}),
  ),
  useCampaigns: vi.fn(),
  useScenarios: vi.fn(),
  refreshCampaigns: vi.fn(async () => []),
}));
vi.mock("../bindings", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../bindings")),
  campaignSave,
  campaignImageDelete,
}));
vi.mock("../campaigns", () => ({ useCampaigns, refreshCampaigns }));
// What the scenario builder holds, which is the other half of every staleness
// question this page asks.
vi.mock("@/scenario/scenarios", () => ({ useScenarios }));
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
import type { Scenario } from "@/scenario/model";
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

function show(missions: CampaignMission[], stored: Scenario[] = []) {
  useCampaigns.mockReturnValue({
    campaigns: [{ campaign: campaign(missions), source: "local" }],
    loading: false,
    error: null,
  });
  useScenarios.mockReturnValue({
    scenarios: stored.map((scenario) => ({ scenario })),
    loading: false,
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
  refreshCampaigns.mockClear();
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

const ATTACHED_AT = "2026-01-01T00:00:00.000Z";
const STORED_AT = "2026-06-01T00:00:00.000Z";

/** The scenario as the mission copied it: one zone, on Comet Catcher. */
const asAttached: Scenario = {
  ...source,
  updatedAt: ATTACHED_AT,
  setup: { ...source.setup, gameName: "BAR 1.0", mapName: "Comet Catcher" },
  zones: [
    {
      id: "landing",
      name: "Landing",
      shape: "circle",
      center: { x: 512, z: 512 },
      radius: 300,
    },
  ],
};

/** The same scenario after the builder went on editing it: the zone is gone. */
const asStored: Scenario = { ...asAttached, updatedAt: STORED_AT, zones: [] };

/** A mission carrying a copy of `scenario`, with authoring of its own on top. */
function scenarioMission(scenario: Scenario): CampaignMission {
  return attachScenario(
    {
      id: "m1",
      title: "Beachhead",
      briefing: "Take the shore before dawn.",
      objectives: ["Hold the beach"],
      snapshot: scenario.setup,
      disabledUnits: [],
      skippable: false,
    },
    scenario,
  );
}

const STALE = "The scenario has been edited since this copy was attached.";
const UPDATE = "Update to latest: Beachhead";

describe("re-copying a mission's scenario", () => {
  it("offers the update beside the warning that says it is needed", () => {
    show([scenarioMission(asAttached)], [asStored]);

    expect(screen.getByText(STALE)).toBeTruthy();
    expect(screen.getByRole("button", { name: UPDATE })).toBeTruthy();
  });

  it("offers nothing when the copy is the scenario the builder holds", () => {
    show([scenarioMission(asAttached)], [asAttached]);

    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.queryByRole("button", { name: UPDATE })).toBeNull();
  });

  it("offers nothing when the source scenario is gone", () => {
    // Nothing to copy from, so a button here could only fail. The mission plays
    // its own copy and that is the whole of the story.
    show([scenarioMission(asAttached)], []);

    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.queryByRole("button", { name: UPDATE })).toBeNull();
  });

  it("says what the copy loses before anything is written", () => {
    show([scenarioMission(asAttached)], [asStored]);

    fireEvent.click(screen.getByRole("button", { name: UPDATE }));

    expect(
      screen.getByText(/no other copy of what the mission is playing/),
    ).toBeTruthy();
    // The counts are the concrete part: one zone now, none afterwards.
    expect(
      screen.getByText(/0 unit placements · 1 zone · 0 triggers/),
    ).toBeTruthy();
    expect(
      screen.getByText(/0 unit placements · 0 zones · 0 triggers/),
    ).toBeTruthy();
    expect(campaignSave).not.toHaveBeenCalled();
  });

  it("keeps the mission's own copy when the answer is no", () => {
    show([scenarioMission(asAttached)], [asStored]);

    fireEvent.click(screen.getByRole("button", { name: UPDATE }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText(STALE)).toBeTruthy();
    expect(campaignSave).not.toHaveBeenCalled();
  });

  it("replaces the copy once confirmed, keeping the mission's own fields", async () => {
    show([scenarioMission(asAttached)], [asStored]);

    fireEvent.click(screen.getByRole("button", { name: UPDATE }));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await vi.waitFor(() => expect(campaignSave).toHaveBeenCalled());

    const saved = savedMissions()[0];
    expect(saved.scenario?.updatedAt).toBe(STORED_AT);
    expect(saved.scenario?.zones).toEqual([]);
    expect(saved.title).toBe("Beachhead");
    expect(saved.briefing).toBe("Take the shore before dawn.");
    expect(saved.objectives).toEqual(["Hold the beach"]);
    // The row has caught up, so there is nothing left to warn about.
    expect(screen.queryByText(STALE)).toBeNull();
  });

  it("warns when the update moves the mission to another map", () => {
    const moved: Scenario = {
      ...asStored,
      setup: { ...asStored.setup, mapName: "Red Comet" },
    };
    show([scenarioMission(asAttached)], [moved]);

    fireEvent.click(screen.getByRole("button", { name: UPDATE }));

    expect(
      screen.getByText(
        /The mission's map changes from Comet Catcher to Red Comet\./,
      ),
    ).toBeTruthy();
  });
});

const SAVED = /^Saved \d{1,2}:\d{2}/;
const NOT_SAVED = "Not saved. Leaving this page loses the change.";
const REFUSED = "the campaign folder is read-only";

/** The title box, which edits as it is typed in and writes on blur. */
function titleBox(): HTMLElement {
  return screen.getByLabelText("Campaign title");
}

describe("saying whether an edit reached disk", () => {
  it("says nothing until something has been written", () => {
    show([]);

    expect(screen.queryByText(SAVED)).toBeNull();
    expect(screen.queryByText("Saving…")).toBeNull();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("calls a typed-in title unsaved until the box is left", () => {
    show([]);

    fireEvent.change(titleBox(), { target: { value: "Landfall II" } });

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(campaignSave).not.toHaveBeenCalled();
  });

  it("says it is saving while the write is in flight, then names the time", async () => {
    let finish: (() => void) | undefined;
    campaignSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({});
        }),
    );
    show([]);

    fireEvent.change(titleBox(), { target: { value: "Landfall II" } });
    fireEvent.blur(titleBox());

    expect(await screen.findByText("Saving…")).toBeTruthy();
    expect(screen.queryByText(SAVED)).toBeNull();

    finish?.();
    expect(await screen.findByText(SAVED)).toBeTruthy();
    expect(screen.queryByText("Saving…")).toBeNull();
  });

  it("does not claim a refused write saved, and says what it costs", async () => {
    campaignSave.mockRejectedValueOnce(new Error(REFUSED));
    show([]);

    fireEvent.blur(titleBox());

    expect(await screen.findByText(NOT_SAVED)).toBeTruthy();
    expect(screen.queryByText(SAVED)).toBeNull();
    // The reason the plugin gave, which the indicator has no room for.
    expect(screen.getByText(REFUSED)).toBeTruthy();
  });

  it("writes the document again on retry, and says so once it lands", async () => {
    campaignSave.mockRejectedValueOnce(new Error(REFUSED));
    show([]);

    fireEvent.change(titleBox(), { target: { value: "Landfall II" } });
    fireEvent.blur(titleBox());
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByText(SAVED)).toBeTruthy();
    expect(screen.queryByText(NOT_SAVED)).toBeNull();
    // The retry carries the edit that failed, not the document as stored.
    const written = campaignSave.mock.calls.at(-1)?.[0];
    expect(JSON.parse(written?.json ?? "{}").title).toBe("Landfall II");
    // And the reason for the failed write is gone with it.
    expect(screen.queryByText(REFUSED)).toBeNull();
  });

  it("keeps the failure up while the write that failed is the last one", async () => {
    campaignSave.mockRejectedValueOnce(new Error(REFUSED));
    show([]);

    fireEvent.blur(titleBox());
    await screen.findByText(NOT_SAVED);

    // Nothing else has been asked for, so nothing may quietly clear this.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText(NOT_SAVED)).toBeTruthy();
  });

  it("reports a mission change too, not only the text boxes", async () => {
    show([mission()]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(SAVED)).toBeTruthy();
  });
});
