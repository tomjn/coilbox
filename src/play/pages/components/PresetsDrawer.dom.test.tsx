// @vitest-environment happy-dom

/**
 * The presets sheet, now that clicking a preset opens its own panel instead of
 * loading it outright. Two things worth holding down: the row no longer carries
 * the whole-preset actions, and a part blocked for belonging to another game
 * must not ride along in what loads just because it was ticked before.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "../../participants";
import type { PresetSelection } from "../../presetParts";
import type { SkirmishPreset } from "../../presets";
import { PresetsDrawer } from "./PresetsDrawer";

afterEach(cleanup);

const you: Participant = {
  id: "p0",
  kind: "you",
  name: "You",
  side: "arm",
  color: [0.5, 0.5, 0.5],
  allyTeam: 0,
  spectator: false,
};

const preset: SkirmishPreset = {
  id: "preset-1",
  name: "8v8 ruleset",
  createdAt: "",
  lastUsedAt: "",
  participants: [you],
  gameName: "Preset Game",
  mapName: "Preset Map",
  startPosType: 2,
  startRects: { "0": { left: 0, top: 0, right: 100, bottom: 200 } },
  modOptionValues: { maxunits: "8000", tweakdefs: "PRESET" },
  restrictions: { disabledUnits: ["armcom"] },
};

function renderDrawer(over: Partial<Parameters<typeof PresetsDrawer>[0]> = {}) {
  const handlers = {
    onLoad: vi.fn(),
    onDelete: vi.fn(),
    onExportPreset: vi.fn(),
    onCopyPresetLink: vi.fn(),
    onHostAsBattle: vi.fn(),
  };
  render(
    <PresetsDrawer
      open={true}
      onOpenChange={vi.fn()}
      presets={[preset]}
      thumbs={new Map()}
      currentGameName="Preset Game"
      onSave={vi.fn()}
      onImport={vi.fn()}
      onSaveFromReplay={vi.fn()}
      onBrowseHub={vi.fn()}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

const openPanel = () => fireEvent.click(screen.getByText("8v8 ruleset"));

// Exact, because "Map" and "Map options" are both rows.
const checkbox = (label: string) =>
  screen.getByRole("checkbox", { name: label });

describe("the preset list", () => {
  it("carries no per-preset actions at all, just the row", () => {
    renderDrawer();
    for (const gone of [
      /^Host /,
      /^Export/,
      /^Copy a link/,
      /^Copy link/,
      /^Delete/,
    ])
      expect(screen.queryByRole("button", { name: gone })).toBeNull();
  });

  it("opens the preset's panel rather than loading it", () => {
    const { onLoad } = renderDrawer();
    openPanel();
    expect(onLoad).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Back to presets" }),
    ).toBeTruthy();
  });

  it("goes back to the list", () => {
    renderDrawer();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Back to presets" }));
    expect(screen.getByText("8v8 ruleset")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Map" })).toBeNull();
  });

  it("offers creating a preset from a replay", () => {
    renderDrawer();
    expect(
      screen.getByRole("button", { name: "Create from replay" }),
    ).toBeTruthy();
  });

  it("sends you to the hub for presets you have not made yourself", () => {
    const onBrowseHub = vi.fn();
    renderDrawer({ onBrowseHub });
    fireEvent.click(screen.getByRole("button", { name: "Browse the hub" }));
    expect(onBrowseHub).toHaveBeenCalled();
  });
});

describe("a preset's panel", () => {
  it("names the full load rather than leaving it implied", () => {
    renderDrawer();
    openPanel();
    expect(
      screen.getByRole("button", { name: "Load all 7 parts" }),
    ).toBeTruthy();
  });

  it("loads every part", () => {
    const { onLoad } = renderDrawer();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Load all 7 parts" }));
    expect((onLoad.mock.calls[0][1] as PresetSelection).parts).toHaveLength(7);
  });

  it("loads only what is ticked", () => {
    const { onLoad } = renderDrawer();
    openPanel();
    fireEvent.click(checkbox("Teams and bots"));
    fireEvent.click(checkbox("Mod options"));
    fireEvent.click(screen.getByRole("button", { name: "Load 5 parts" }));
    const parts = (onLoad.mock.calls[0][1] as PresetSelection).parts;
    expect(parts).not.toContain("teams");
    expect(parts).not.toContain("modOptions");
  });

  it("offers select all only once something is unticked", () => {
    renderDrawer();
    openPanel();
    expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
    fireEvent.click(checkbox("Map"));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(
      screen.getByRole("button", { name: "Load all 7 parts" }),
    ).toBeTruthy();
  });

  it("blocks the game-keyed parts when the game is left behind", () => {
    const { onLoad } = renderDrawer({ currentGameName: "A Different Game" });
    openPanel();
    fireEvent.click(checkbox("Game"));
    expect(
      screen.getAllByText(
        "Belongs to Preset Game. Take the game as well, or leave this out.",
      ).length,
    ).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Load 3 parts" }));
    expect((onLoad.mock.calls[0][1] as PresetSelection).parts).toEqual([
      "map",
      "startPositions",
      "teams",
    ]);
  });

  it("cautions that the boxes were drawn for another map", () => {
    renderDrawer();
    openPanel();
    fireEvent.click(checkbox("Map"));
    expect(
      screen.getByText(
        "These boxes were drawn for Preset Map, not the map you are on.",
      ),
    ).toBeTruthy();
  });

  it("carries the whole-preset actions moved off the row", () => {
    const { onExportPreset, onCopyPresetLink, onHostAsBattle } = renderDrawer();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Host as battle" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(onHostAsBattle).toHaveBeenCalledWith(preset);
    expect(onExportPreset).toHaveBeenCalledWith(preset);
    expect(onCopyPresetLink).toHaveBeenCalledWith(preset);
  });

  it("hides hosting where it is impossible", () => {
    renderDrawer({ onHostAsBattle: undefined });
    openPanel();
    expect(screen.queryByRole("button", { name: "Host as battle" })).toBeNull();
  });

  it("deletes the preset and returns to the list", () => {
    const { onDelete } = renderDrawer();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Delete preset" }));
    expect(onDelete).toHaveBeenCalledWith("preset-1");
    // The panel was about a preset that no longer exists, so it cannot stay.
    expect(
      screen.queryByRole("button", { name: "Back to presets" }),
    ).toBeNull();
  });
});
