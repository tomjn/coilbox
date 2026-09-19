// @vitest-environment happy-dom

/**
 * Loading part of a preset into the Singleplayer setup. The cases that matter
 * are the ones where what loads has to match what the picker showed ticked: a
 * part blocked for belonging to another game must not ride along in the
 * selection just because it was ticked before the block appeared.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "../../participants";
import type { PresetSelection } from "../../presetParts";
import type { SkirmishPreset } from "../../presets";
import { LoadPartsPopover } from "./LoadPartsPopover";

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

function open(currentGameName = "Preset Game") {
  const onLoad = vi.fn();
  render(
    <LoadPartsPopover
      preset={preset}
      currentGameName={currentGameName}
      onLoad={onLoad}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Load parts of preset 8v8 ruleset" }),
  );
  return { onLoad };
}

const partsOf = (onLoad: ReturnType<typeof vi.fn>) =>
  (onLoad.mock.calls[0][1] as PresetSelection).parts;

const checkbox = (label: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`^${label}`) });

describe("LoadPartsPopover", () => {
  it("offers every part of the preset and loads them all", () => {
    const { onLoad } = open();
    fireEvent.click(screen.getByRole("button", { name: /^Load 7 parts/ }));
    expect(partsOf(onLoad)).toEqual([
      "game",
      "map",
      "startPositions",
      "modOptions",
      "tweakSlots",
      "teams",
      "restrictions",
    ]);
  });

  it("leaves out a part that was unticked", () => {
    const { onLoad } = open();
    fireEvent.click(checkbox("Map"));
    fireEvent.click(checkbox("Teams and bots"));
    fireEvent.click(screen.getByRole("button", { name: /^Load 5 parts/ }));
    expect(partsOf(onLoad)).not.toContain("map");
    expect(partsOf(onLoad)).not.toContain("teams");
    expect(partsOf(onLoad)).toContain("startPositions");
  });

  it("blocks the game-keyed parts when the game is left behind", () => {
    const { onLoad } = open("A Different Game");
    fireEvent.click(checkbox("Game"));
    expect(
      screen.getAllByText(
        "Belongs to Preset Game. Take the game as well, or leave this out.",
      ).length,
    ).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: /^Load 3 parts/ }));
    // Ticked before the block appeared, and must not ride along regardless.
    expect(partsOf(onLoad)).toEqual(["map", "startPositions", "teams"]);
  });

  it("cautions that the boxes were drawn for another map", () => {
    open();
    fireEvent.click(checkbox("Map"));
    expect(
      screen.getByText(
        "These boxes were drawn for Preset Map, not the map you are on.",
      ),
    ).toBeTruthy();
  });

  it("will not load nothing", () => {
    open();
    for (const label of [
      "Game",
      "Map",
      "Start positions",
      "Mod options",
      "Unit tweaks",
      "Teams and bots",
      "Unit restrictions",
    ])
      fireEvent.click(checkbox(label));
    const load = screen.getByRole("button", { name: "Nothing selected" });
    expect(load.hasAttribute("disabled")).toBe(true);
  });
});
