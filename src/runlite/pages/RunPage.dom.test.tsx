// @vitest-environment happy-dom
/**
 * The warpath run page when the run file could not be read. It has to give the
 * reason and say nothing was changed, not "No active warpath", which reads as if
 * the run were gone.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  error: null as string | null,
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useHideSidebar: () => {},
  useDrawer: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));
// Records live in the frame's settings store, which this page is rendered without.
vi.mock("../../challenge/useChallengeRecords", () => ({
  useRecordChallengeRun: vi.fn(),
}));
vi.mock("../../challenge/ChallengeRecordLine", () => ({
  ChallengeRecordLine: () => null,
}));
vi.mock("../../content/config", () => ({
  useUnitsyncScan: () => ({ data: null, error: null, run: vi.fn() }),
  useUnitsyncUnitDataset: () => ({ dataset: null }),
  useScanEpoch: () => 0,
}));
vi.mock("../../content/mapEligibility", () => ({
  useMapEligibility: () => ({ isExcluded: () => false }),
}));
vi.mock("../../play/config", () => ({
  usePreferredTarget: () => ({
    target: null,
    loading: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../RunMapView", () => ({ RunMapView: () => null }));
vi.mock("../useAwardFinishedRuns", () => ({
  useAwardFinishedRuns: vi.fn(),
}));
vi.mock("../runs", () => ({
  useRun: () => ({
    run: null,
    loading: false,
    error: h.error,
    refresh: vi.fn(),
    save: vi.fn(),
  }),
}));

import RunPage from "./RunPage";

afterEach(() => {
  cleanup();
  h.error = null;
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/warpath/r1"]}>
      <RunPage />
    </MemoryRouter>,
  );
}

describe("RunPage with no run", () => {
  it("gives the reason and says nothing was changed when the file could not be read", () => {
    h.error = "run.json is not valid JSON";
    renderPage();
    expect(
      screen.getByText(
        "Your warpath runs could not be read. Nothing has been changed. run.json is not valid JSON",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No active warpath/)).toBeNull();
  });

  it("says there is no active warpath when the file read and has no such run", () => {
    renderPage();
    expect(screen.getByText(/No active warpath/)).toBeTruthy();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });
});
