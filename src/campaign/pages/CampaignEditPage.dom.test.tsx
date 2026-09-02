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
 * Copying a mission is the reverse of both (issue #2196), and it changes what
 * removal can promise: two missions in one campaign read one media folder, so
 * the copy plays the original's files and neither one's removal takes them.
 *
 * The next thing here is what the page says about its own writes (issue
 * #2198). It saves as you go and never asks, so the case that has to hold is
 * the refused write: an indicator that can only ever say "Saved" is worse than
 * no indicator, because it is believed.
 *
 * And because it saves as you go, two writes can be asked for close enough
 * together to be in flight at once (issue #2221). Every one of them writes the
 * whole document, so the order they land in decides what the file is left
 * holding, and the last one asked for has to be the last one written.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
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
  campaignMediaDelete,
  useCampaigns,
  useScenarios,
  refreshCampaigns,
  useUnitsyncThumbnails,
} = vi.hoisted(() => ({
  campaignSave: vi.fn(async (_args: { id: string; json: string }) => ({})),
  campaignMediaDelete: vi.fn(
    async (_args: { campaignId: string; file: string }) => ({
      deleted: true,
      from: "media" as const,
    }),
  ),
  useCampaigns: vi.fn(),
  useScenarios: vi.fn(),
  refreshCampaigns: vi.fn(async () => []),
  useUnitsyncThumbnails: vi.fn(() => ({ thumbs: new Map() })),
}));
vi.mock("../bindings", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../bindings")),
  campaignSave,
  campaignMediaDelete,
}));
vi.mock("../campaigns", () => ({ useCampaigns, refreshCampaigns }));
// What the scenario builder holds, which is the other half of every staleness
// question this page asks.
vi.mock("@/scenario/scenarios", () => ({ useScenarios }));
vi.mock("@/play/presets", () => ({
  useSkirmishPresets: () => ({ presets: [] }),
}));
vi.mock("@/play/config", () => ({ usePreferredTarget: () => ({}) }));
vi.mock("@/content/config", () => ({ useUnitsyncThumbnails }));
// Both reach for stored media through the coilbox:// protocol, which a test has
// no business standing up, and neither is part of removing a mission.
// The field itself reaches for stored media through the coilbox:// protocol,
// which a test has no business standing up. It still renders its label, because
// whether the icon and background pickers are on the page at all is the whole
// of issue #2194.
vi.mock("./components/CampaignImage", () => ({
  CampaignImage: () => null,
  CampaignImageField: ({ label }: { label: string }) => (
    <div>{label} picker</div>
  ),
}));
vi.mock("./components/PanoramaScroller", () => ({
  PanoramaScroller: () => null,
}));

import { newScenario } from "@/scenario/create";
import type { Scenario } from "@/scenario/model";
import { attachScenario } from "../missionScenario";
import type { Campaign, CampaignMission } from "../model";
import CampaignEditPage, { duplicateMission } from "./CampaignEditPage";

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

/** A mission with nothing on it but an id and a title, for order questions. */
function plain(id: string, title: string): CampaignMission {
  return {
    id,
    title,
    briefing: "",
    objectives: [],
    snapshot: source.setup,
    disabledUnits: [],
    skippable: false,
  };
}

function campaign(
  missions: CampaignMission[],
  art: Partial<Campaign> = {},
): Campaign {
  return {
    schemaVersion: 1,
    id: "c1",
    type: "ta",
    title: "Landfall",
    description: "",
    missions,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...art,
  };
}

function show(
  missions: CampaignMission[],
  stored: Scenario[] = [],
  art: Partial<Campaign> = {},
) {
  useCampaigns.mockReturnValue({
    campaigns: [{ campaign: campaign(missions, art), source: "local" }],
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
  campaignMediaDelete.mockClear();
  refreshCampaigns.mockClear();
  useUnitsyncThumbnails.mockReturnValue({ thumbs: new Map() });
  // The Presentation disclosure remembers itself in localStorage, which
  // outlives a render, so each test starts from "never chosen".
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

/**
 * The open confirmation popover. The row behind it now says what the mission
 * holds too (issue #2195), in the same words, so a count asked for here has to
 * be asked for inside the popover or it matches twice.
 */
function confirmation(): HTMLElement {
  const heading = screen.getByText(/^Remove .+\?$/);
  const content = heading.closest("[data-slot='popover-content']");
  if (!content) throw new Error("the confirmation is not open");
  return content as HTMLElement;
}

describe("removing a campaign mission", () => {
  it("asks first, and says what the mission holds", () => {
    show([mission()]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));

    expect(screen.getByText("Remove Beachhead?")).toBeTruthy();
    expect(screen.getByText("its briefing")).toBeTruthy();
    expect(within(confirmation()).getByText("1 objective")).toBeTruthy();
    expect(within(confirmation()).getByText("1 unit restriction")).toBeTruthy();
    expect(screen.getByText("its panorama, deleted from disk")).toBeTruthy();
    expect(screen.getByText(/copy of the scenario "Beachhead"/)).toBeTruthy();
    // Nothing has happened yet: the mission is still in the list, and the
    // panorama is still on disk.
    expect(screen.getByText("1. Beachhead")).toBeTruthy();
    expect(campaignSave).not.toHaveBeenCalled();
    expect(campaignMediaDelete).not.toHaveBeenCalled();
  });

  it("leaves the mission and its panorama alone when the answer is no", () => {
    show([mission()]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Remove Beachhead?")).toBeNull();
    expect(screen.getByText("1. Beachhead")).toBeTruthy();
    expect(campaignMediaDelete).not.toHaveBeenCalled();
    expect(campaignSave).not.toHaveBeenCalled();
  });

  it("removes the mission and deletes its panorama once confirmed", async () => {
    show([mission()]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    // The panorama goes once the document that stops naming it is on disk, so
    // the delete is what there is to wait for (issue #2232).
    await vi.waitFor(() =>
      expect(campaignMediaDelete).toHaveBeenCalledWith({
        campaignId: "c1",
        file: "shore.jpg",
      }),
    );

    expect(savedMissions()).toEqual([]);
    expect(screen.queryByText("1. Beachhead")).toBeNull();
  });

  /**
   * The panorama was the only slot the removal ever cleaned up, and the command
   * it used could not reach the folder audio and video go into, so a voiceover
   * or a cutscene stayed on disk with nothing left naming it (issue #2210).
   */
  it("takes the side graphic, voiceover and cutscene with it", async () => {
    show([
      {
        ...mission(),
        sideGraphic: { kind: "file", file: "emblem.png" },
        voiceover: { kind: "file", file: "brief.ogg" },
        cutscene: { kind: "file", file: "intro.mp4" },
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));
    // The confirmation has to name them, or it is quietly deleting more than
    // it said it would.
    expect(
      screen.getByText(
        "its panorama, side graphic, briefing voiceover and intro cutscene, deleted from disk",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await vi.waitFor(() =>
      expect(campaignMediaDelete).toHaveBeenCalledTimes(4),
    );

    expect(campaignMediaDelete.mock.calls.map(([a]) => a.file)).toEqual([
      "shore.jpg",
      "emblem.png",
      "brief.ogg",
      "intro.mp4",
    ]);
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

/**
 * Copying a mission (issue #2196). A variant of a mission, an easier one or one
 * on another map, used to mean going back to the picker and re-typing the
 * briefing, the objectives and the restrictions.
 *
 * Three things decide whether the copy is any use. Where it lands, because
 * array order is play order. What it shares with the original, because the two
 * sit in one campaign and so in one media folder. And what it does not share,
 * because a scenario document held by two missions at once is one in-place edit
 * away from changing a mission nobody was editing.
 */
describe("duplicating a campaign mission", () => {
  it("puts the copy directly after the original, not at the end", async () => {
    show([plain("m1", "Beachhead"), plain("m2", "Ridge"), plain("m3", "Dam")]);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate Ridge" }));
    await vi.waitFor(() => expect(campaignSave).toHaveBeenCalled());

    expect(savedMissions().map((m) => m.title)).toEqual([
      "Beachhead",
      "Ridge",
      "Copy of Ridge",
      "Dam",
    ]);
    // And the list on screen agrees about the numbering, which is what an
    // author reads the play order off.
    expect(screen.getByText("3. Copy of Ridge")).toBeTruthy();
    expect(screen.getByText("4. Dam")).toBeTruthy();
  });

  it("counts up rather than making two rows read the same", async () => {
    show([plain("m1", "Ridge")]);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate Ridge" }));
    await vi.waitFor(() => expect(campaignSave).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Ridge" }));
    await vi.waitFor(() => expect(savedMissions()).toHaveLength(3));

    expect(savedMissions().map((m) => m.title)).toEqual([
      "Ridge",
      "Copy of Ridge (2)",
      "Copy of Ridge",
    ]);
  });

  it("carries the authoring over and leaves the original alone", async () => {
    show([mission()]);

    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate Beachhead" }),
    );
    await vi.waitFor(() => expect(campaignSave).toHaveBeenCalled());

    const [original, copy] = savedMissions();
    expect(original).toEqual(mission());
    expect(copy.briefing).toBe("Take the shore before dawn.");
    expect(copy.objectives).toEqual(["Hold the beach"]);
    expect(copy.disabledUnits).toEqual(["armbrtha"]);
    expect(copy.scenario?.id).toBe("beachhead");
    // A fresh id, or the document will not parse back off disk at all.
    expect(copy.id).not.toBe(original.id);
  });

  /**
   * Both missions live in one campaign, so both read one `images/<id>/` folder.
   * Sharing the file is what makes the copy show the original's panorama
   * without a second set of bytes, and removing either mission afterwards is
   * safe because the delete asks what the whole document still names.
   */
  it("shares the original's stored files rather than writing them again", async () => {
    show([mission()]);

    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate Beachhead" }),
    );
    await vi.waitFor(() => expect(campaignSave).toHaveBeenCalled());

    expect(savedMissions().map((m) => m.panorama)).toEqual([
      { kind: "file", file: "shore.jpg" },
      { kind: "file", file: "shore.jpg" },
    ]);
    expect(campaignMediaDelete).not.toHaveBeenCalled();
  });

  it("says a shared file stays when one of the two is removed", async () => {
    show([mission()]);

    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate Beachhead" }),
    );
    await vi.waitFor(() => expect(campaignSave).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));

    // The old wording promised the panorama went off disk, which the copy makes
    // untrue: it still plays the same file.
    expect(
      screen.getByText(
        "its panorama, kept on disk because another mission uses the same file",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("its panorama, deleted from disk")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await vi.waitFor(() => expect(savedMissions()).toHaveLength(1));
    expect(campaignMediaDelete).not.toHaveBeenCalled();
  });

  it("stops calling an orphaned scenario the only copy once it is not", async () => {
    // Nothing in the scenario builder, so the mission's own copy is the last
    // one there is, until a second mission carries it too.
    show([scenarioMission(asAttached)], []);

    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));
    expect(screen.getByText(/the only copy of the scenario/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate Beachhead" }),
    );
    await vi.waitFor(() => expect(campaignSave).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));

    expect(screen.queryByText(/the only copy of the scenario/)).toBeNull();
    expect(screen.getByText(/which another mission also carries/)).toBeTruthy();
  });

  /**
   * The scenario is the one thing that must not be shared. It is a whole
   * document, and two missions holding the same object means an edit made in
   * place on one lands on both.
   */
  it("gives the copy a scenario of its own", () => {
    const original = mission();
    const copy = duplicateMission(original, [original.title]);

    expect(copy.scenario).toEqual(original.scenario);
    expect(copy.scenario).not.toBe(original.scenario);
    expect(copy.snapshot).not.toBe(original.snapshot);
    expect(copy.objectives).not.toBe(original.objectives);
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

  it("reports the save, not the list refresh that failed after it", async () => {
    // The campaign list is a separate read. Failing it leaves other views
    // stale, and telling the author their edit did not save would be a lie
    // that sends them to retry a write that worked.
    refreshCampaigns.mockRejectedValueOnce(new Error("list read failed"));
    show([]);

    fireEvent.blur(titleBox());

    expect(await screen.findByText(SAVED)).toBeTruthy();
    expect(screen.queryByText(NOT_SAVED)).toBeNull();
  });

  it("reports a mission change too, not only the text boxes", async () => {
    show([mission()]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(SAVED)).toBeTruthy();
  });
});

/**
 * Which comes first, the delete or the write (issue #2232).
 *
 * The page used to take the file off disk and then write the document that
 * stops naming it. A refused write left the campaign on disk still pointing at
 * a panorama, voiceover or cutscene that was already gone, and reopening it
 * showed a mission that had lost its media with nothing to say why. Writing
 * first leaves the opposite failure: a file nothing names, which costs disk
 * space and no authoring.
 */
describe("dropping media an edit stops naming", () => {
  /** Confirm the removal of the only mission, which drops its panorama. */
  function removeTheMission() {
    fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  }

  it("keeps the file while the write is still in flight", async () => {
    let finish: (() => void) | undefined;
    campaignSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({});
        }),
    );
    show([mission()]);

    removeTheMission();

    // The document that stops naming the panorama has not landed, so the
    // panorama is the only copy of itself and stays where it is.
    expect(await screen.findByText("Saving…")).toBeTruthy();
    expect(campaignMediaDelete).not.toHaveBeenCalled();

    finish?.();
    await screen.findByText(SAVED);
    await waitFor(() =>
      expect(campaignMediaDelete).toHaveBeenCalledWith({
        campaignId: "c1",
        file: "shore.jpg",
      }),
    );
  });

  it("keeps the file when the write is refused", async () => {
    campaignSave.mockRejectedValueOnce(new Error(REFUSED));
    show([mission()]);

    removeTheMission();
    await screen.findByText(NOT_SAVED);

    // The campaign on disk is the one that still has the mission in it, and
    // that mission's panorama has to still be there to be shown.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(campaignMediaDelete).not.toHaveBeenCalled();
  });

  it("takes the file once a retry lands", async () => {
    campaignSave.mockRejectedValueOnce(new Error(REFUSED));
    show([mission()]);

    removeTheMission();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(campaignMediaDelete).not.toHaveBeenCalled();

    fireEvent.click(retry);
    await screen.findByText(SAVED);

    // The delete the failed write held back is owed by whichever write lands,
    // or the file is left behind for good.
    await waitFor(() =>
      expect(campaignMediaDelete.mock.calls.map(([a]) => a.file)).toEqual([
        "shore.jpg",
      ]),
    );
  });
});

/**
 * Record the documents in the order they land, which is the order that decides
 * what the file keeps, and hold one of the two writes open until `release`.
 * Holding the first is what a page without a queue trips over: it starts the
 * second write anyway, and the two land the wrong way round.
 */
function twoWrites(hold: 1 | 2): { onDisk: Campaign[]; release: () => void } {
  const onDisk: Campaign[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const record = async ({ json }: { json: string }) => {
    onDisk.push(JSON.parse(json));
    return {};
  };
  const wait = async (args: { json: string }) => {
    await held;
    return record(args);
  };
  campaignSave.mockImplementationOnce(hold === 1 ? wait : record);
  campaignSave.mockImplementationOnce(hold === 2 ? wait : record);
  return { onDisk, release: () => release() };
}

/**
 * Rename the campaign and then remove its only mission, without waiting in
 * between. This is the click the issue describes: leaving a text box writes,
 * and the button that took the focus writes again on top of it.
 */
async function renameThenRemove() {
  fireEvent.change(titleBox(), { target: { value: "Landfall II" } });
  fireEvent.blur(titleBox());
  fireEvent.click(screen.getByRole("button", { name: "Remove Beachhead" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  // Both writes have been asked for once the row is off the page. The panorama
  // is still on disk: it goes when the write that stops naming it lands.
  await waitFor(() => expect(screen.queryByText("1. Beachhead")).toBeNull());
}

describe("two edits made close together", () => {
  it("leaves the document the author asked for last on disk", async () => {
    const { onDisk, release } = twoWrites(1);
    show([mission()]);

    await renameThenRemove();
    release();
    await waitFor(() => expect(onDisk).toHaveLength(2));

    // The removal was asked for second, so it is written second and is what
    // the file is left holding. The other way round and the mission is back on
    // disk while the author is looking at a page without it.
    expect(onDisk.map((c) => c.missions.length)).toEqual([1, 0]);
    expect(onDisk.at(-1)?.title).toBe("Landfall II");
  });

  it("does not call the campaign saved while an older write is still to land", async () => {
    const { onDisk, release } = twoWrites(1);
    show([mission()]);

    await renameThenRemove();
    // Long enough for anything already finished to have said so. The first
    // write is still open, so nothing has reached disk yet and the removal is
    // not on it, which makes "Saved" a lie the author would act on.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(SAVED)).toBeNull();
    expect(screen.getByText("Saving…")).toBeTruthy();

    release();
    await waitFor(() => expect(onDisk).toHaveLength(2));

    expect(await screen.findByText(SAVED)).toBeTruthy();
  });

  it("does not call the campaign saved on a write another has superseded", async () => {
    const { onDisk, release } = twoWrites(2);
    show([mission()]);

    await renameThenRemove();
    // The rename is on disk and the removal is not. The rename is the older of
    // the two documents, so its landing says nothing about where the campaign
    // has got to, and reporting it would leave a tick over a page whose last
    // edit is still unwritten.
    await waitFor(() => expect(onDisk).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(SAVED)).toBeNull();
    expect(screen.getByText("Saving…")).toBeTruthy();

    release();
    await waitFor(() => expect(onDisk).toHaveLength(2));

    expect(await screen.findByText(SAVED)).toBeTruthy();
  });
});

/**
 * What a mission row says about the mission (issue #2195).
 *
 * It used to say all of it in one string joined by dots, subtitle first and
 * skippable last, on a line that truncates. So on a narrow window the row lost
 * the end of itself, and what it lost was the part nothing else on the page
 * says: whether a scenario is attached and whether the mission can be skipped.
 *
 * What is pinned here is the split: each fact keeps its own kind, the counts
 * hold their place whether or not there is anything to count, and none of it
 * is a sentence any more. Issue #2263 then merged the split facts back onto
 * one muted row beneath the title, so scanning a list reads bold titles first
 * and drops into a fact only when the title alone is not enough.
 */
describe("what a mission row says", () => {
  /** The column of lines beside a row's move buttons: the title, then the
   * one metadata row every fact below it shares. */
  const columnOf = (title: string) =>
    screen.getByText(title).parentElement as HTMLElement;

  /** The single muted row a row's subtitle, setup and facts share. */
  const metadataRowOf = (title: string) =>
    columnOf(title).children[1] as HTMLElement;

  /** Every chip in a row, by the phrase it carries. */
  const chipsOf = (title: string) =>
    [...columnOf(title).querySelectorAll("span[title]")].map((el) =>
      el.getAttribute("title"),
    );

  it("puts the subtitle, the setup and the facts on one metadata row", () => {
    show([{ ...plain("m1", "Ridge"), subtitle: "Northern Isles" }]);

    // One row beside the title, not one each: subtitle, setup and facts all
    // land inside it rather than as siblings of their own.
    expect(columnOf("1. Ridge").children).toHaveLength(2);
    const row = metadataRowOf("1. Ridge");
    expect(row.textContent).toContain("Northern Isles");
    expect(row.textContent).toContain("No game · No map");
    expect(row.querySelector("svg")).toBeTruthy();
  });

  it("gives a mission with no subtitle the same row, minus the subtitle", () => {
    show([plain("m1", "Ridge")]);

    expect(columnOf("1. Ridge").children).toHaveLength(2);
    const row = metadataRowOf("1. Ridge");
    expect(row.textContent).not.toContain("Northern Isles");
    expect(row.textContent).toContain("No game · No map");
    expect(row.querySelector("svg")).toBeTruthy();
  });

  it("stops packing the facts into one line joined by dots", () => {
    show([{ ...mission(), subtitle: "Northern Isles", skippable: true }]);

    expect(screen.queryByText(/Northern Isles ·/)).toBeNull();
    expect(screen.queryByText(/· scenario:/)).toBeNull();
    expect(screen.queryByText(/· skippable/)).toBeNull();
  });

  it("draws what the author wrote into the mission as chips", () => {
    show([mission()]);

    expect(chipsOf("1. Beachhead")).toEqual([
      "Briefing written",
      "1 objective",
      "1 unit restriction",
    ]);
  });

  /**
   * A count of nothing is dimmed, not dropped. Dropping one slides the rest
   * along, so no kind sits in the same place twice down the list, and a gap
   * makes no claim where "0 objectives" does.
   */
  it("keeps a chip for what the mission has none of, dimmed", () => {
    show([plain("m1", "Ridge")]);

    expect(chipsOf("1. Ridge")).toEqual([
      "No briefing",
      "0 objectives",
      "0 unit restrictions",
    ]);
    expect(screen.getByTitle("0 objectives").className).toMatch(/opacity-40/);
    expect(screen.getByTitle("No briefing").className).toMatch(/opacity-40/);
  });

  it("leaves a chip that has something to say undimmed", () => {
    show([mission()]);

    expect(screen.getByTitle("1 objective").className).not.toMatch(
      /opacity-40/,
    );
    expect(screen.getByTitle("Briefing written").className).not.toMatch(
      /opacity-40/,
    );
  });

  // An icon beside a digit says nothing to a screen reader, so the phrase is
  // the only text the chip is given and the drawing is hidden from it.
  it("gives every chip its phrase in text, and hides the drawing", () => {
    show([mission()]);

    const objectives = screen.getByTitle("1 objective");
    expect(objectives.querySelector("span.sr-only")?.textContent).toBe(
      "1 objective",
    );
    expect(
      objectives.querySelector("span[aria-hidden='true']")?.textContent,
    ).toBe("1");
    expect(objectives.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  // A briefing is written or it is not, so its chip is the icon alone. "1
  // briefing" would be a count of something nobody counts.
  it("gives the briefing chip no digit to read", () => {
    show([mission()]);

    const briefing = screen.getByTitle("Briefing written");
    expect(briefing.querySelector("span[aria-hidden='true']")).toBeNull();
    expect(briefing.querySelector("span.sr-only")?.textContent).toBe(
      "Briefing written",
    );
  });

  // The mission is titled after the scenario when it is built from one, but it
  // can be renamed afterwards, and then this badge is the only thing naming the
  // document the mission actually plays.
  it("names the attached scenario in a badge", () => {
    show([{ ...mission(), title: "Landing" }]);

    expect(screen.getByText("Scenario: Beachhead")).toBeTruthy();
  });

  it("gives a preset-only mission no scenario badge", () => {
    show([plain("m1", "Ridge")]);

    expect(screen.queryByText(/^Scenario:/)).toBeNull();
  });

  it("badges only the mission that can be skipped", () => {
    show([{ ...plain("m1", "Ridge"), skippable: true }, plain("m2", "Dam")]);

    expect(columnOf("1. Ridge").textContent).toContain("Skippable");
    expect(columnOf("2. Dam").textContent).not.toContain("Skippable");
  });

  /**
   * A mission naming no game or no map cannot launch, and play order is array
   * order, so it blocks every mission after it (`campaignUnplayableReason`). It
   * used to read exactly like a game name, at the end of the line that
   * truncates.
   */
  it("marks a missing game or map rather than printing it like a name", () => {
    show([plain("m1", "Ridge")]);

    expect(screen.getByText("No game").className).toMatch(/amber/);
    expect(screen.getByText("No map").className).toMatch(/amber/);
  });

  it("leaves a game and a map the mission has as plain text", () => {
    show([scenarioMission(asAttached)], [asAttached]);

    expect(screen.getByText("BAR 1.0").className).not.toMatch(/amber/);
    expect(screen.getByText("Comet Catcher").className).not.toMatch(/amber/);
  });
});

/**
 * A mission with no panorama used to reserve the same full-width 80px strip
 * as one that had art, just to caption the absence with "No panorama" (issue
 * #2266). The map thumbnail is the mission's real identity in that case, so
 * it now fills a slimmer band instead, and the strip disappears entirely when
 * there is no thumbnail either rather than sitting empty.
 */
describe("a mission card's header strip with no panorama", () => {
  it("skips the strip entirely when there is neither panorama nor thumbnail", () => {
    show([plain("m1", "Ridge")]);

    expect(screen.queryByText("No panorama")).toBeNull();
    const li = screen.getByText("1. Ridge").closest("li") as HTMLElement;
    expect(li.querySelector("img")).toBeNull();
    // Nothing precedes the row content: the strip contributes no element.
    expect(li.firstElementChild?.className).toContain("p-3");
  });

  it("promotes the map thumbnail to a slim full-width band", () => {
    useUnitsyncThumbnails.mockReturnValue({
      thumbs: new Map([["Comet Catcher", { url: "thumb://comet-catcher" }]]),
    });
    show([
      {
        ...plain("m1", "Ridge"),
        snapshot: { ...source.setup, mapName: "Comet Catcher" },
      },
    ]);

    expect(screen.queryByText("No panorama")).toBeNull();
    const li = screen.getByText("1. Ridge").closest("li") as HTMLElement;
    const img = li.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe("thumb://comet-catcher");
    expect(img.className).toContain("h-10");
    expect(img.className).toContain("w-full");
    expect(img.className).toContain("object-cover");
    // Slimmer than the 80px band a panorama gets, and not the small cornered
    // overlay that band uses to show the same thumbnail alongside art.
    expect(img.className).not.toContain("size-16");
    expect(img.className).not.toContain("absolute");
  });
});

/**
 * Where the icon and background pickers sit (issue #2194).
 *
 * They were the first thing under the title, so opening a campaign with three
 * missions put one and a bit of them on screen at the default window size and
 * the rest below the fold. The art is set once and the missions are edited
 * constantly, so the section is now a disclosure that starts shut.
 *
 * The thing a disclosure can get wrong is discovery: a shut section that shows
 * nothing leaves a new author never learning there is an icon to set. So the
 * cases worth pinning are what the shut row says, and that a campaign with
 * nothing in it yet gets the section open without asking.
 */
describe("the campaign editor's presentation section", () => {
  const trigger = () => screen.getByRole("button", { name: /Presentation/ });

  it("starts shut on a campaign that has missions", () => {
    show([mission()]);

    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Icon picker")).toBeNull();
    expect(screen.queryByText("Background picker")).toBeNull();
  });

  it("starts open on a campaign with no missions", () => {
    // Nothing below it to be in the way of, and a campaign with no missions is
    // still being set up (issue #2190 calls it a Draft).
    show([]);

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Icon picker")).toBeTruthy();
    expect(screen.getByText("Background picker")).toBeTruthy();
  });

  it("says nothing is set yet, so a shut section is still an invitation", () => {
    show([mission()]);

    expect(screen.getByText("No icon or background yet")).toBeTruthy();
  });

  it("says which of the two is set", () => {
    show([mission()], [], { icon: { kind: "file", file: "emblem.png" } });

    expect(screen.getByText("Icon set, no background")).toBeTruthy();
  });

  it("opens on click, putting the pickers back", () => {
    show([mission()]);

    fireEvent.click(trigger());

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Icon picker")).toBeTruthy();
  });

  it("remembers being opened, so the next campaign opened is open too", () => {
    show([mission()]);
    fireEvent.click(trigger());
    cleanup();

    // A different campaign, with missions, so nothing but the remembered
    // choice can be holding it open.
    show([plain("m9", "Second")]);

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("remembers being shut, even where it would have opened itself", () => {
    show([]);
    fireEvent.click(trigger());
    cleanup();

    show([]);

    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  /**
   * Opening a disclosure is a view preference, not an edit. Storing it on the
   * campaign would queue a write and stamp `updatedAt`, so a click that changed
   * nothing would move the campaign to the top of a list sorted by when it was
   * last touched.
   */
  it("never writes the campaign document", () => {
    show([mission()]);

    fireEvent.click(trigger());
    fireEvent.click(trigger());

    expect(campaignSave).not.toHaveBeenCalled();
  });
});

/** Stands in for the mission briefing, naming the mission it was asked for. */
function PlayerBriefing() {
  const { missionId } = useParams();
  return <div>{`the briefing for ${missionId}`}</div>;
}

/**
 * The editor with the two player-facing routes mounted alongside it, so a
 * Preview click can be read as the navigation it is. The real pages are not
 * rendered: what is being asserted is which page the author is sent to, and
 * both of those pages have their own tests.
 */
function showWithPlayerPages(missions: CampaignMission[]) {
  useCampaigns.mockReturnValue({
    campaigns: [{ campaign: campaign(missions), source: "local" }],
    loading: false,
    error: null,
  });
  useScenarios.mockReturnValue({ scenarios: [], loading: false });
  render(
    <MemoryRouter initialEntries={["/campaign-builder/c1"]}>
      <Routes>
        <Route path="/campaign-builder/:id" element={<CampaignEditPage />} />
        <Route
          path="/campaign/:id"
          element={<div>the campaign as a player sees it</div>}
        />
        <Route path="/campaign/:id/:missionId" element={<PlayerBriefing />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Looking at what the player will see (issue #2197).
 *
 * The editor sends the author to the player's own pages rather than drawing a
 * copy of them, so most of what could go wrong is not reachable from here. Two
 * things are, and both would show the author something untrue.
 *
 * The first is timing. The title and description write on blur, so the click
 * that opens the preview is racing the write its own blur asked for, and
 * arriving a keystroke early shows a page built from the previous document.
 *
 * The second is a campaign with no missions. The play list drops that
 * campaign's link outright (issue #2219), so offering the author a page no
 * player can open would be the preview lying about the one thing it is for.
 */
describe("previewing a campaign as a player", () => {
  const previewButton = () => screen.getByRole("button", { name: "Preview" });

  it("opens the campaign's own player-facing page", async () => {
    showWithPlayerPages([mission()]);

    fireEvent.click(previewButton());

    expect(
      await screen.findByText("the campaign as a player sees it"),
    ).toBeTruthy();
  });

  it("opens a mission's briefing straight from its row", async () => {
    // The detail page locks every mission the player has not reached, so
    // going through it would not get the author to a later briefing at all.
    showWithPlayerPages([plain("m1", "First"), plain("m2", "Second")]);

    fireEvent.click(screen.getByRole("button", { name: "Preview Second" }));

    expect(await screen.findByText("the briefing for m2")).toBeTruthy();
  });

  it("offers nothing to preview on a campaign with no missions, and says why", () => {
    showWithPlayerPages([]);

    expect(previewButton().hasAttribute("disabled")).toBe(true);
    // The play list's own words for this campaign, so an author who read them
    // there reads the same ones here.
    expect(screen.getByText("No missions yet")).toBeTruthy();
  });

  it("waits for a pending write, so the page opened is not a keystroke behind", async () => {
    let finish: (() => void) | undefined;
    campaignSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({});
        }),
    );
    showWithPlayerPages([mission()]);

    fireEvent.change(titleBox(), { target: { value: "Landfall II" } });
    fireEvent.blur(titleBox());
    fireEvent.click(previewButton());

    // The write is still in flight, so the author is still in the editor.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("the campaign as a player sees it")).toBeNull();

    finish?.();
    expect(
      await screen.findByText("the campaign as a player sees it"),
    ).toBeTruthy();
    expect(
      JSON.parse(campaignSave.mock.calls.at(-1)?.[0].json ?? "{}").title,
    ).toBe("Landfall II");
  });

  it("stays put when the write was refused, keeping the retry on screen", async () => {
    campaignSave.mockRejectedValueOnce(new Error(REFUSED));
    showWithPlayerPages([mission()]);

    fireEvent.change(titleBox(), { target: { value: "Landfall II" } });
    fireEvent.blur(titleBox());
    fireEvent.click(previewButton());

    expect(await screen.findByText(NOT_SAVED)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy(),
    );
    expect(screen.queryByText("the campaign as a player sees it")).toBeNull();
  });
});

/**
 * How the top of the page reads (issue #2193).
 *
 * It opened on two bare bordered boxes with no labels on them, and a lone
 * bordered box across the top of a page is the shape of a search field, so the
 * campaign's own name read as something to type a query into.
 *
 * The title is the page's heading now and is edited where it sits, so what has
 * to hold is that it is still only a text box underneath: reachable and
 * writable without a mouse, and writing through the same queued save as
 * everything else on the page. An editable heading that needs a click to enter
 * an edit mode would have taken renaming away from the keyboard entirely.
 */
describe("the top of the campaign editor", () => {
  it("draws the campaign's title as the page's heading", () => {
    show([]);

    // The heading is the box, not a copy of the title printed beside one.
    const heading = titleBox().closest("h1");
    expect(heading).not.toBeNull();
    expect(within(heading as HTMLElement).getByRole("textbox")).toBe(
      titleBox(),
    );
    expect((titleBox() as HTMLInputElement).value).toBe("Landfall");
  });

  it("says on the page what the description box is for", () => {
    show([]);

    // A visible label, rather than an aria-label only a screen reader reaches.
    expect(screen.getByText("Description").tagName).toBe("LABEL");
    expect(screen.getByLabelText("Description").tagName).toBe("TEXTAREA");
  });

  it("renames the campaign from the keyboard alone", async () => {
    show([]);

    // No click anywhere. The box takes focus by itself, which is what being an
    // input rather than a click-to-edit heading buys, and Enter leaves it.
    titleBox().focus();
    expect(document.activeElement).toBe(titleBox());
    fireEvent.change(titleBox(), { target: { value: "Landfall II" } });
    fireEvent.keyDown(titleBox(), { key: "Enter" });

    expect(await screen.findByText(SAVED)).toBeTruthy();
    expect(
      JSON.parse(campaignSave.mock.calls.at(-1)?.[0].json ?? "{}").title,
    ).toBe("Landfall II");
  });

  it("keeps a rename committed with Enter when the author leaves at once", async () => {
    // The same race the Preview button already waits out for a click-away
    // blur (issue #2197). Enter is a second way to reach it, and an author who
    // presses Enter and then goes straight to Preview must not be shown a page
    // built from the name they just replaced.
    let finish: (() => void) | undefined;
    campaignSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({});
        }),
    );
    showWithPlayerPages([mission()]);

    titleBox().focus();
    fireEvent.change(titleBox(), { target: { value: "Landfall II" } });
    fireEvent.keyDown(titleBox(), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("the campaign as a player sees it")).toBeNull();

    finish?.();
    expect(
      await screen.findByText("the campaign as a player sees it"),
    ).toBeTruthy();
    expect(
      JSON.parse(campaignSave.mock.calls.at(-1)?.[0].json ?? "{}").title,
    ).toBe("Landfall II");
  });
});
