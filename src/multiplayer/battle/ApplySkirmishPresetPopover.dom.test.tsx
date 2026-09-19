// @vitest-environment happy-dom

/**
 * Applying part of a skirmish preset to a live room.
 *
 * The case worth holding down is the map gate. Reading a map's checksum used to
 * block the whole apply, so a preset's options could not be applied without
 * owning its map, which is exactly when taking only the options is worth doing.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "@/play/participants";
import type { PresetSelection } from "@/play/presetParts";
import type { SkirmishPreset } from "@/play/presets";
import { ApplySkirmishPresetPopover } from "./ApplySkirmishPresetPopover";

const mapStatus = vi.hoisted(() => ({ value: "ready" as string }));

vi.mock("@/content/config", () => ({
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

const preset: SkirmishPreset = {
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
};

function openWithPreset(
  over: Partial<Parameters<typeof ApplySkirmishPresetPopover>[0]> = {},
) {
  const onApply = vi.fn();
  render(
    <ApplySkirmishPresetPopover
      presets={[preset]}
      onApply={onApply}
      {...over}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Apply skirmish preset" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Ruleset/ }));
  return { onApply };
}

const checkbox = (label: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`^${label}`) });

const applyButton = () =>
  screen.getByRole("button", { name: /Apply to this room|Reading map/ });

describe("ApplySkirmishPresetPopover", () => {
  it("never offers the game, because the room is already on one", () => {
    openWithPreset();
    expect(screen.queryByRole("checkbox", { name: /^Game/ })).toBeNull();
  });

  it("applies every part it offers", () => {
    const { onApply } = openWithPreset();
    fireEvent.click(applyButton());
    const selection = onApply.mock.calls[0][2] as PresetSelection;
    expect(selection.parts).toEqual([
      "map",
      "startPositions",
      "modOptions",
      "tweakSlots",
      "teams",
      "restrictions",
    ]);
  });

  it("applies the options without the map or the teams", () => {
    const { onApply } = openWithPreset();
    fireEvent.click(checkbox("Map"));
    fireEvent.click(checkbox("Start positions"));
    fireEvent.click(checkbox("Teams and bots"));
    fireEvent.click(checkbox("Unit restrictions"));
    fireEvent.click(applyButton());
    expect((onApply.mock.calls[0][2] as PresetSelection).parts).toEqual([
      "modOptions",
      "tweakSlots",
    ]);
  });

  it("waits on the map checksum only when the map is being taken", () => {
    mapStatus.value = "loading";
    openWithPreset();
    expect(applyButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(checkbox("Map"));
    expect(applyButton().hasAttribute("disabled")).toBe(false);
  });

  it("says who owns the restrictions when they cannot be sent here", () => {
    const { onApply } = openWithPreset({ canEditRestrictions: false });
    expect(
      screen.getByText("The host owns these. There is no autohost command."),
    ).toBeTruthy();
    fireEvent.click(applyButton());
    expect((onApply.mock.calls[0][2] as PresetSelection).parts).not.toContain(
      "restrictions",
    );
  });

  it("will not apply nothing", () => {
    openWithPreset();
    for (const label of [
      "Map",
      "Start positions",
      "Mod options",
      "Unit tweaks",
      "Teams and bots",
      "Unit restrictions",
    ])
      fireEvent.click(checkbox(label));
    expect(applyButton().hasAttribute("disabled")).toBe(true);
  });
});
