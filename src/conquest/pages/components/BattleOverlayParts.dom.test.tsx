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

describe("BattleLaunchGate while the run's unit limit is not known", () => {
  it("says the unit data is loading instead of preparing", () => {
    render(
      <MemoryRouter>
        <BattleLaunchGate
          {...base}
          hold={{ label: "Loading unit data…", busy: true }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Loading unit data…")).toBeTruthy();
    expect(screen.queryByText("Preparing…")).toBeNull();
    expect(screen.queryByText("Launch battle")).toBeNull();
  });

  it("has no launch button when the unit data failed to load", () => {
    render(
      <MemoryRouter>
        <BattleLaunchGate
          {...base}
          hold={{ label: "Cannot launch without unit data", busy: false }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Cannot launch without unit data")).toBeTruthy();
    expect(screen.queryByText("Launch battle")).toBeNull();
  });

  it("offers the launch button once the limit is known", () => {
    render(
      <MemoryRouter>
        <BattleLaunchGate {...base} canStart />
      </MemoryRouter>,
    );
    expect(screen.getByText("Launch battle")).toBeTruthy();
  });
});
