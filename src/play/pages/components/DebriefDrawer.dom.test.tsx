// @vitest-environment happy-dom

/** The debrief says what a game did to the preset's record, and only then. */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@picoframe/frame", async () => {
  const { forwardRef } = await import("react");
  return {
    useSetting: vi.fn(),
    Button: forwardRef<HTMLButtonElement, Record<string, unknown>>(
      ({ variant: _v, size: _s, ...props }, ref) => (
        <button ref={ref} type="button" {...props} />
      ),
    ),
  };
});
vi.mock("./SaveAsPresetButton", () => ({ SaveAsPresetButton: () => null }));
vi.mock("@/components/OptionSelect", () => ({ OptionSelect: () => null }));

import type { SkirmishDebrief } from "@/play/useSkirmishDebrief";
import { DebriefDrawer } from "./DebriefDrawer";

afterEach(cleanup);

const base: SkirmishDebrief = {
  outcome: "victory",
  headline: "Victory!",
  durationSec: 540,
  replayFilename: "a.sdfz",
  presetLine: null,
};

function renderDebrief(debrief: SkirmishDebrief) {
  render(
    <MemoryRouter>
      <DebriefDrawer
        open
        onOpenChange={vi.fn()}
        debrief={debrief}
        onRematch={vi.fn()}
        onRematchWithTweak={vi.fn()}
        getDraft={() => null}
        defaultPresetName="Rematch"
      />
    </MemoryRouter>,
  );
}

describe("DebriefDrawer preset line", () => {
  it("says how the game compares with the best", () => {
    renderDebrief({
      ...base,
      presetLine: 'New best on "Hard one": 1:00 faster than before.',
    });
    expect(
      screen.getByText('New best on "Hard one": 1:00 faster than before.'),
    ).toBeTruthy();
  });

  it("says nothing about a preset when the game did not count", () => {
    renderDebrief(base);
    expect(screen.queryByText(/Hard one/)).toBeNull();
    expect(screen.queryByText(/best/i)).toBeNull();
  });
});
