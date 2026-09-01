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
} from "@testing-library/react";
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
  campaignMediaDelete,
  useCampaigns,
  useScenarios,
  refreshCampaigns,
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
  campaignMediaDelete.mockClear();
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
    await vi.waitFor(() => expect(campaignSave).toHaveBeenCalled());

    expect(campaignMediaDelete).toHaveBeenCalledWith({
      campaignId: "c1",
      file: "shore.jpg",
    });
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
    await vi.waitFor(() => expect(campaignSave).toHaveBeenCalled());

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
  // The removal deletes the mission's panorama before it writes.
  await waitFor(() => expect(campaignMediaDelete).toHaveBeenCalled());
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
