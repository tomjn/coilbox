// @vitest-environment happy-dom
/**
 * What the mission editor leaves on disk, while it is open (issue #2210) and
 * when it closes (issue #2231).
 *
 * Picking a file imports it there and then, because the plugin needs a real
 * file before anything can play it. So the drawer holds imports the saved
 * campaign has never heard of, and the page behind it cannot clean those up:
 * its diff works from the stored document, which never named them.
 *
 * The panorama already dealt with replacement. The other three slots did not, so
 * choosing a voiceover twice before pressing Apply left the first one on disk
 * with nothing that could ever name it again. Nothing dealt with closing at all:
 * a 200 MB cutscene the author picked and then cancelled stayed until the whole
 * campaign was deleted.
 *
 * The other half is what must survive: a file the campaign has already saved is
 * not this drawer's to delete, because Cancel has to leave the stored mission
 * playable, and neither is one Apply has just persisted.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Picking a file is an OS dialog and importing it writes to app-data, so both
// stand in. What is asserted is which file the drawer then asks to delete.
const { open, campaignMediaImport, campaignImageImport, campaignMediaDelete } =
  vi.hoisted(() => ({
    open: vi.fn(async () => "/Users/somebody/retake.ogg"),
    campaignMediaImport: vi.fn(async () => ({ file: "imported-2.ogg" })),
    campaignImageImport: vi.fn(async () => ({ file: "imported.jpg" })),
    // Typed like the real binding so a test can assert which file was asked
    // for, and can hand back the `deleted: false` the plugin reports when
    // neither folder held it.
    campaignMediaDelete: vi.fn(
      async (_args: {
        campaignId: string;
        file: string;
      }): Promise<{ deleted: boolean; from: "images" | "media" | null }> => ({
        deleted: true,
        from: "media",
      }),
    ),
  }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
vi.mock("../../bindings", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../bindings")),
  campaignMediaImport,
  campaignImageImport,
  campaignMediaDelete,
}));

// Everything that reaches for stored media over the coilbox:// protocol, or
// for a game's units through unitsync, stands in: a test has no business
// standing either up, and neither decides what is left on disk.
vi.mock("../../panorama", () => ({ useCampaignImage: () => null }));
vi.mock("@/content/useGameUnits", () => ({
  useGameUnits: () => ({ units: [], factions: [], loading: false }),
}));
vi.mock("../../../content/pages/components/UnitPicker", () => ({
  UnitGameProvider: ({ children }: { children: React.ReactNode }) => children,
  UnitPickerButton: () => null,
}));
vi.mock("./MissionMapPreview", () => ({
  MissionMapBackground: () => null,
  MissionMapSideGraphic: () => null,
}));
vi.mock("./MissionUnitPreview", () => ({
  MissionUnitBackground: () => null,
  MissionUnitSideGraphic: () => null,
}));
vi.mock("./PanoramaScroller", () => ({ PanoramaScroller: () => null }));
vi.mock("./MissionScenarioField", () => ({ MissionScenarioField: () => null }));
vi.mock("./ArchiveMediaImportButton", () => ({
  ArchiveMediaImportButton: () => null,
}));
vi.mock("./UnitRestrictions", () => ({ UnitRestrictions: () => null }));
vi.mock("./useMissionUnit", () => ({ useMissionUnit: () => ({}) }));

import { DrawerHost, DrawerProvider, useDrawer } from "@picoframe/frame";
import { StrictMode, useEffect } from "react";
import { newScenario } from "@/scenario/create";
import type { CampaignMission } from "../../model";
import { MissionEditorDrawer } from "./MissionEditorDrawer";

/** A mission whose voiceover the campaign has already saved. */
function mission(over: Partial<CampaignMission> = {}): CampaignMission {
  return {
    id: "m1",
    title: "Beachhead",
    briefing: "",
    objectives: [],
    snapshot: newScenario("Beachhead").setup,
    disabledUnits: [],
    skippable: false,
    ...over,
  };
}

/**
 * Open the editor the way the page opens it: as the content of the frame's own
 * drawer.
 *
 * Rendering the body on its own would test one cancel path, the button, and the
 * button is the path least likely to break. Escape and a click on the backdrop
 * go through Radix without ever reaching the drawer body, and they are cancels
 * too. Driving the real drawer is what makes them testable at all.
 */
function openDrawer(
  m: CampaignMission,
  onApply: (mission: CampaignMission) => Promise<void> = async () => {},
  strict = false,
) {
  function Opener() {
    const { open } = useDrawer();
    useEffect(() => {
      open({
        title: `Edit mission: ${m.title}`,
        content: (
          <MissionEditorDrawer campaignId="c1" mission={m} onApply={onApply} />
        ),
      });
    }, [open]);
    return null;
  }

  const tree = (
    <DrawerProvider>
      <Opener />
      <DrawerHost />
    </DrawerProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** The three ways an author gets out of the drawer without applying. */
const CANCELS = {
  "the Cancel button": () =>
    screen.getByRole("button", { name: "Cancel" }).click(),
  Escape: () => fireEvent.keyDown(document, { key: "Escape" }),
  "a click on the backdrop": () => {
    const overlay = [...document.querySelectorAll<HTMLElement>("[data-state]")]
      // The drawer's own backdrop, the only element painted over everything.
      .find((e) => e.className.includes("bg-black/50"));
    if (!overlay) throw new Error("no drawer backdrop");
    // Radix defers a left-button dismissal to the click, so the press alone
    // leaves the drawer open. Both halves of the click, then.
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
  },
} as const;

/** Wait for the drawer to have gone, so its unmount cleanup has run. */
async function drawerClosed() {
  await waitFor(() =>
    expect(screen.queryByText("Briefing voiceover")).toBeNull(),
  );
}

/** Choose or replace one media slot, through the OS file dialog. */
async function pickMedia(label: string, choose: string) {
  const field = screen.getByText(label).parentElement;
  if (!field) throw new Error(`no ${label} field`);
  const button = [...field.querySelectorAll("button")].find((b) =>
    [choose, "Replace"].includes(b.textContent?.trim() ?? ""),
  );
  if (!button) throw new Error(`no ${label} pick button`);
  const before = campaignMediaImport.mock.calls.length;
  button.click();
  await waitFor(() =>
    expect(campaignMediaImport.mock.calls.length).toBeGreaterThan(before),
  );
}

const pickVoiceover = () => pickMedia("Briefing voiceover", "Choose audio");
const pickCutscene = () => pickMedia("Intro cutscene", "Choose video");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  campaignMediaDelete.mockClear();
  campaignMediaImport.mockClear();
  campaignMediaImport.mockResolvedValue({ file: "imported-1.ogg" });
});

describe("an import the drawer made and then replaced", () => {
  it("takes the replaced voiceover off disk", async () => {
    openDrawer(mission());

    await pickVoiceover();
    campaignMediaImport.mockResolvedValue({ file: "imported-2.ogg" });
    await pickVoiceover();

    await waitFor(() =>
      expect(campaignMediaDelete).toHaveBeenCalledWith({
        campaignId: "c1",
        file: "imported-1.ogg",
      }),
    );
    expect(campaignMediaDelete).toHaveBeenCalledTimes(1);
  });

  it("takes it off disk when the slot is emptied instead", async () => {
    openDrawer(mission());

    await pickVoiceover();
    screen.getByRole("button", { name: "Remove" }).click();

    await waitFor(() =>
      expect(campaignMediaDelete).toHaveBeenCalledWith({
        campaignId: "c1",
        file: "imported-1.ogg",
      }),
    );
  });
});

describe("a file the campaign has already saved", () => {
  it("survives being replaced, because Cancel must leave it playable", async () => {
    openDrawer(mission({ voiceover: { kind: "file", file: "saved.ogg" } }));

    await pickVoiceover();

    // The page behind the drawer deletes this one, and only once the edit it
    // belongs to has been saved.
    await new Promise((r) => setTimeout(r, 0));
    expect(campaignMediaDelete).not.toHaveBeenCalled();
  });
});

describe("an import the drawer made and then cancelled (issue #2231)", () => {
  // Cancel throws the edit away, so nothing will ever name the file it
  // imported: no slot holds it, the stored campaign never heard of it, and the
  // page behind diffs against that stored campaign so it cannot see it either.
  // A 200 MB cutscene the author decided against stays until the whole
  // campaign is deleted.
  for (const [how, cancel] of Object.entries(CANCELS)) {
    it(`takes the import off disk when closed by ${how}`, async () => {
      openDrawer(mission());

      await pickVoiceover();
      cancel();
      await drawerClosed();

      await waitFor(() =>
        expect(campaignMediaDelete).toHaveBeenCalledWith({
          campaignId: "c1",
          file: "imported-1.ogg",
        }),
      );
    });
  }

  it("takes every slot's import, not just the last one", async () => {
    openDrawer(mission());

    await pickVoiceover();
    campaignMediaImport.mockResolvedValue({ file: "imported-2.mp4" });
    await pickCutscene();
    CANCELS["the Cancel button"]();
    await drawerClosed();

    await waitFor(() =>
      expect(
        campaignMediaDelete.mock.calls.map((c) => c[0].file).sort(),
      ).toEqual(["imported-1.ogg", "imported-2.mp4"]),
    );
  });

  it("says so when the delete does not remove anything", async () => {
    // `deleted: false` is the plugin saying neither folder held the file. It is
    // not an error, but it is not a removal either, and issue #2210 was exactly
    // a delete that removed nothing while reporting success.
    campaignMediaDelete.mockResolvedValueOnce({ deleted: false, from: null });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openDrawer(mission());

    await pickVoiceover();
    CANCELS["the Cancel button"]();
    await drawerClosed();

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "campaign media was already gone",
        "imported-1.ogg",
      ),
    );
  });
});

describe("an import the drawer is still using", () => {
  it("survives StrictMode running the closing cleanup on mount", async () => {
    // The app renders under StrictMode, which mounts, tears down and mounts
    // again. A cleanup that deletes on the way out therefore runs once with the
    // drawer still on screen, and the file picked afterwards has to outlive it.
    openDrawer(mission(), async () => {}, true);

    await pickVoiceover();

    await new Promise((r) => setTimeout(r, 0));
    expect(campaignMediaDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Briefing voiceover")).toBeTruthy();
  });
});

describe("an import the drawer made and then applied", () => {
  it("stays on disk, because the saved mission now names it", async () => {
    // The one that must not regress. Apply persists the mission naming this
    // file, so a cleanup that deleted every session import on the way out
    // would leave the campaign pointing at nothing.
    const applied: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      applied.push(m);
    });

    await pickVoiceover();
    screen.getByRole("button", { name: "Apply" }).click();
    await drawerClosed();

    expect(applied.at(-1)?.voiceover).toEqual({
      kind: "file",
      file: "imported-1.ogg",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(campaignMediaDelete).not.toHaveBeenCalled();
  });

  it("goes when Apply failed, because nothing saved it", async () => {
    openDrawer(mission(), async () => {
      throw new Error("disk full");
    });

    await pickVoiceover();
    screen.getByRole("button", { name: "Apply" }).click();
    // A refused save keeps the drawer open with the error, so the author can
    // retry. Cancelling from there is still a cancel.
    await screen.findByText("disk full");
    CANCELS["the Cancel button"]();
    await drawerClosed();

    await waitFor(() =>
      expect(campaignMediaDelete).toHaveBeenCalledWith({
        campaignId: "c1",
        file: "imported-1.ogg",
      }),
    );
  });
});
