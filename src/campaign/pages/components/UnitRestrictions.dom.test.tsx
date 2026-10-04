// @vitest-environment happy-dom
/**
 * A scan whose unitsync Init failed has not said what is installed (issue
 * #3423), so the editor shows the failure with a retry and does not say the
 * game was not found.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());

vi.mock("@/content/config", () => ({
  invalidateGameInfo: () => {},
  useUnitsyncScan: () => ({
    data: null,
    error: "no space left on device",
    loading: false,
    cancelled: false,
    run,
  }),
  useUnitsyncGameInfo: () => ({ info: null, loading: false, reload: () => {} }),
  useUnitsyncUnitDataset: () => ({
    dataset: null,
    loading: false,
    reload: () => {},
  }),
}));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({ target: {} }),
}));

import { UnitRestrictions } from "./UnitRestrictions";

afterEach(cleanup);

describe("UnitRestrictions", () => {
  it("shows the failure with a retry and not a missing game", () => {
    render(
      <UnitRestrictions
        gameName="Splinter Faction"
        disabledUnits={[]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/no space left on device/)).toBeTruthy();
    expect(screen.queryByText(/wasn't found/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry scan" }));
    expect(run).toHaveBeenCalledWith(true);
  });
});
