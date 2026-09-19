// @vitest-environment happy-dom

/**
 * The picker that turns "apply this preset" into "apply these parts of it".
 * The cases worth holding down are the ones where a row must not be tickable:
 * a part the preset carries nothing for, and a part this surface cannot change.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkirmishDraft } from "./drafts";
import { PresetPartsPicker } from "./PresetPartsPicker";
import type { Participant } from "./participants";
import { ALL_PARTS, type PresetSelection } from "./presetParts";

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

const preset: SkirmishDraft = {
  participants: [you],
  gameName: "Preset Game",
  mapName: "Preset Map",
  startPosType: 2,
  startRects: { "0": { left: 0, top: 0, right: 100, bottom: 200 } },
  modOptionValues: { maxunits: "8000", tweakdefs: "PRESET" },
  restrictions: undefined,
};

function renderPicker(
  over: Partial<Parameters<typeof PresetPartsPicker>[0]> = {},
) {
  const onChange = vi.fn();
  render(
    <PresetPartsPicker
      preset={preset}
      selection={ALL_PARTS}
      onChange={onChange}
      {...over}
    />,
  );
  return { onChange };
}

/** The checkbox in the row whose label starts with `label`. */
const row = (label: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`^${label}`) });

describe("PresetPartsPicker", () => {
  it("shows a row per part with what the preset holds for it", () => {
    renderPicker();
    expect(screen.getByText("Preset Map")).toBeTruthy();
    expect(screen.getByText("1 option")).toBeTruthy();
    expect(screen.getByText("1 tweak slot")).toBeTruthy();
    expect(screen.getByText("Choose in-game, 1 box")).toBeTruthy();
  });

  it("disables a part the preset carries nothing for, saying so", () => {
    renderPicker();
    expect(
      row("Unit restrictions").getAttribute("data-disabled"),
    ).not.toBeNull();
    expect(screen.getByText("Not in this preset")).toBeTruthy();
  });

  it("leaves out a part this surface never offers", () => {
    renderPicker({ omit: ["game"] });
    expect(screen.queryByRole("checkbox", { name: /^Game/ })).toBeNull();
  });

  it("disables a part with the reason the caller gave", () => {
    renderPicker({
      disabledReasons: { teams: "Only the host can move players" },
    });
    expect(row("Teams and bots").getAttribute("data-disabled")).not.toBeNull();
    expect(screen.getByText("Only the host can move players")).toBeTruthy();
  });

  it("drops a part from the selection when it is unticked", () => {
    const { onChange } = renderPicker();
    fireEvent.click(row("Map"));
    const next = onChange.mock.calls[0][0] as PresetSelection;
    expect(next.parts).not.toContain("map");
    expect(next.parts).toContain("modOptions");
  });

  it("adds a part back when it is ticked again", () => {
    const { onChange } = renderPicker({
      selection: { ...ALL_PARTS, parts: ["modOptions"] },
    });
    fireEvent.click(row("Map"));
    const next = onChange.mock.calls[0][0] as PresetSelection;
    expect(next.parts).toContain("map");
    expect(next.parts).toContain("modOptions");
  });

  it("switches mod options to overlay through the keep checkbox", () => {
    const { onChange } = renderPicker();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Keep options this preset does not set/,
      }),
    );
    const next = onChange.mock.calls[0][0] as PresetSelection;
    expect(next.modOptions).toBe("overlay");
    expect(next.tweakSlots).toBe("replace");
  });

  it("hides the keep checkbox for a part that is not being taken", () => {
    renderPicker({ selection: { ...ALL_PARTS, parts: ["map"] } });
    expect(
      screen.queryByRole("checkbox", {
        name: /Keep options this preset does not set/,
      }),
    ).toBeNull();
  });

  it("shows a caution under a part the caller flagged", () => {
    renderPicker({
      warnings: { startPositions: "Boxes were drawn for Preset Map" },
    });
    expect(screen.getByText("Boxes were drawn for Preset Map")).toBeTruthy();
  });
});
