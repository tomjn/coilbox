// @vitest-environment happy-dom

/**
 * Applying parts of a skirmish preset to a live room, in the same sheet shape
 * Singleplayer uses.
 *
 * Two things worth holding down. The map gate: reading a map's checksum used to
 * block the whole apply, so a preset's options could not be applied without
 * owning its map, which is exactly when taking only the options is worth doing.
 * And the list: presets for other games belong in it, because the panel blocks
 * the game-keyed parts by itself and an exact game-name match left the list
 * empty for anyone whose game had moved a version.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "@/play/participants";
import type { PresetSelection } from "@/play/presetParts";
import type { SkirmishPreset } from "@/play/presets";
import { ApplySkirmishPresetDrawer } from "./ApplySkirmishPresetDrawer";

const mapStatus = vi.hoisted(() => ({ value: "ready" as string }));

vi.mock("@/content/config", () => ({
  useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
  useUnitsyncMapInfo: () => ({
    status: mapStatus.value,
    info: mapStatus.value === "ready" ? { checksum: "0x1234" } : undefined,
  }),
}));

afterEach(() => {
  cleanup();
  mapStatus.value = "ready";
});

const you: Participant = {
  id: "p0",
  kind: "you",
  name: "You",
  side: "arm",
  color: [0.5, 0.5, 0.5],
  allyTeam: 0,
  spectator: false,
};

const preset = (over: Partial<SkirmishPreset> = {}): SkirmishPreset => ({
  id: "preset-1",
  name: "Ruleset",
  createdAt: "",
  lastUsedAt: "",
  participants: [you],
  gameName: "A Game",
  mapName: "Preset Map",
  startPosType: 2,
  startRects: { "0": { left: 0, top: 0, right: 100, bottom: 200 } },
  modOptionValues: { maxunits: "8000", tweakdefs: "PRESET" },
  restrictions: { disabledUnits: ["armcom"] },
  ...over,
});

function renderDrawer(
  over: Partial<Parameters<typeof ApplySkirmishPresetDrawer>[0]> = {},
) {
  const onApply = vi.fn();
  render(
    <ApplySkirmishPresetDrawer
      open={true}
      onOpenChange={vi.fn()}
      presets={[preset()]}
      gameName="A Game"
      onApply={onApply}
      saveLabel="Save this battle"
      onSave={vi.fn()}
      onImport={vi.fn()}
      onSaveFromReplay={vi.fn()}
      onBrowseHub={vi.fn()}
      {...over}
    />,
  );
  return { onApply };
}

const openPanel = (name = "Ruleset") => fireEvent.click(screen.getByText(name));

const checkbox = (label: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`^${label}`) });

const selectionOf = (onApply: ReturnType<typeof vi.fn>) =>
  (onApply.mock.calls[0][2] as PresetSelection).parts;

describe("the room's preset library", () => {
  it("offers the same four ways in that Singleplayer does", () => {
    renderDrawer();
    for (const label of [
      "Save this battle",
      "Import",
      "Create from replay",
      "Browse the hub",
    ])
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });

  it("names the preset before saving, the way the sheet always has", () => {
    const onSave = vi.fn();
    renderDrawer({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Save this battle" }));
    const field = screen.getByPlaceholderText("Preset name");
    fireEvent.change(field, { target: { value: "Simian Simmers" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(onSave).toHaveBeenCalledWith("Simian Simmers");
  });
});

describe("the room's preset list", () => {
  it("reads the same as Singleplayer's, a row that opens a panel", () => {
    renderDrawer();
    openPanel();
    expect(
      screen.getByRole("button", { name: "Back to presets" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Apply all/ })).toBeTruthy();
  });

  it("lists a preset saved under another game", () => {
    renderDrawer({ presets: [preset({ gameName: "Some Other Game 9.9" })] });
    expect(screen.getByText("Ruleset")).toBeTruthy();
  });
});

describe("the room's preset panel", () => {
  it("never offers the game, because the room cannot change it", () => {
    renderDrawer();
    openPanel();
    expect(screen.queryByRole("checkbox", { name: /^Game/ })).toBeNull();
  });

  it("applies every part it offers", () => {
    const { onApply } = renderDrawer();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Apply all 6 parts" }));
    expect(selectionOf(onApply)).toEqual([
      "map",
      "startPositions",
      "modOptions",
      "tweakSlots",
      "teams",
      "restrictions",
    ]);
  });

  it("blocks the game-keyed parts of a preset from another game, saying why", () => {
    const { onApply } = renderDrawer({
      presets: [preset({ gameName: "Some Other Game 9.9" })],
    });
    openPanel();
    expect(
      screen.getAllByText(
        "Belongs to Some Other Game 9.9, and this room is running A Game.",
      ).length,
    ).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Apply all 3 parts" }));
    expect(selectionOf(onApply)).toEqual(["map", "startPositions", "teams"]);
  });

  it("waits on the map checksum when we run the game ourselves", () => {
    mapStatus.value = "loading";
    renderDrawer({ mapNeedsChecksum: true });
    openPanel();
    expect(
      screen
        .getByRole("button", { name: "Reading map…" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("does not wait on a checksum a bot-hosted room never needs", () => {
    // The map goes out as `!map <name>` there, which names the map rather than
    // hashing it, so waiting on unitsync would block an apply for nothing.
    mapStatus.value = "loading";
    const { onApply } = renderDrawer({ mapNeedsChecksum: false });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Apply all 6 parts" }));
    expect(onApply).toHaveBeenCalled();
  });

  it("says who owns the restrictions when they cannot be sent here", () => {
    const { onApply } = renderDrawer({ canEditRestrictions: false });
    openPanel();
    expect(
      screen.getByText("The host owns these. There is no autohost command."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply all 5 parts" }));
    expect(selectionOf(onApply)).not.toContain("restrictions");
  });

  it("applies the options without the map or the teams", () => {
    const { onApply } = renderDrawer();
    openPanel();
    fireEvent.click(checkbox("Map"));
    fireEvent.click(checkbox("Start positions"));
    fireEvent.click(checkbox("Teams and bots"));
    fireEvent.click(checkbox("Unit restrictions"));
    fireEvent.click(screen.getByRole("button", { name: "Apply 2 parts" }));
    expect(selectionOf(onApply)).toEqual(["modOptions", "tweakSlots"]);
  });
});
