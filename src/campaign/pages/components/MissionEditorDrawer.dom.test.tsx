// @vitest-environment happy-dom
/**
 * What the mission editor leaves on disk while it is open (issue #2210).
 *
 * Picking a file imports it there and then, because the plugin needs a real
 * file before anything can play it. So the drawer holds imports the saved
 * campaign has never heard of, and the page behind it cannot clean those up:
 * its diff works from the stored document, which never named them.
 *
 * The panorama already dealt with that. The other three slots did not, so
 * choosing a voiceover twice before pressing Apply left the first one on disk
 * with nothing that could ever name it again.
 *
 * The other half is what must survive: a file the campaign has already saved is
 * not this drawer's to delete, because Cancel has to leave the stored mission
 * playable.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Picking a file is an OS dialog and importing it writes to app-data, so both
// stand in. What is asserted is which file the drawer then asks to delete.
const { open, campaignMediaImport, campaignImageImport, campaignMediaDelete } =
  vi.hoisted(() => ({
    open: vi.fn(async () => "/Users/somebody/retake.ogg"),
    campaignMediaImport: vi.fn(async () => ({ file: "imported-2.ogg" })),
    campaignImageImport: vi.fn(async () => ({ file: "imported.jpg" })),
    campaignMediaDelete: vi.fn(async () => ({
      deleted: true,
      from: "media" as const,
    })),
  }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
vi.mock("../../bindings", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../bindings")),
  campaignMediaImport,
  campaignImageImport,
  campaignMediaDelete,
}));

// The drawer is the app shell's, and nothing it does bears on the imports.
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
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

function openDrawer(m: CampaignMission) {
  render(
    <MissionEditorDrawer
      campaignId="c1"
      mission={m}
      onApply={async () => {}}
    />,
  );
}

/** Choose or replace the briefing voiceover, through the OS file dialog. */
async function pickVoiceover() {
  const field = screen.getByText("Briefing voiceover").parentElement;
  if (!field) throw new Error("no briefing voiceover field");
  const button = [...field.querySelectorAll("button")].find((b) =>
    ["Choose audio", "Replace"].includes(b.textContent?.trim() ?? ""),
  );
  if (!button) throw new Error("no voiceover pick button");
  button.click();
  await waitFor(() => expect(campaignMediaImport).toHaveBeenCalled());
}

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
