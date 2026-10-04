// @vitest-environment happy-dom

/**
 * What the battle launch gate says when the content scan's unitsync `Init`
 * failed (issue #3398). The run has no missing game or map to name, because the
 * scan could not say, so the gate says the scan failed and offers no download.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { BattleLaunchGate } from "./BattleOverlayParts";

afterEach(cleanup);

const base = {
  noEngine: false,
  missing: null,
  canStart: false,
  running: false,
  scanLoading: false,
  aisAvailable: true,
  onStart: () => {},
  mapName: "Some Map",
  onRecheck: () => {},
};

describe("BattleLaunchGate when the scan failed", () => {
  it("says the scan failed, with the reason, instead of preparing forever", () => {
    render(
      <MemoryRouter>
        <BattleLaunchGate {...base} scanFailure="no space left" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no space left/)).toBeTruthy();
    expect(screen.queryByText("Preparing…")).toBeNull();
  });

  it("keeps the preparing button when the scan did not fail", () => {
    render(
      <MemoryRouter>
        <BattleLaunchGate {...base} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Preparing…")).toBeTruthy();
  });
});
