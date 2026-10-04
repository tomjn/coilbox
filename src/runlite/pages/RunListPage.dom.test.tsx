// @vitest-environment happy-dom
/**
 * The Warpath hub when the scan failed (unitsync's Init failed, issue #3423).
 * The readiness hook then reports "unreadable" with the reason, and the page has
 * to show it and not spin.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const readiness = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  runsError: null as string | null,
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock("../../play/config", () => ({
  usePlayReadiness: () => readiness.current,
  usePreferredTarget: () => ({ target: null }),
}));
vi.mock("../../content/config", () => ({
  useUnitsyncScan: () => ({ data: null }),
}));
vi.mock("../../content/useGamePresetParam", () => ({
  useGamePresetParam: () => null,
}));
vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: null, hubItemId: null }),
}));
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("../runs", () => ({
  useRuns: () => ({
    runs: {},
    loading: false,
    error: readiness.runsError,
    deleteRun: vi.fn(),
  }),
}));
vi.mock("../useAwardFinishedRuns", () => ({
  useAwardFinishedRuns: vi.fn(),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));

import RunListPage from "./RunListPage";

afterEach(() => {
  cleanup();
  readiness.runsError = null;
});

describe("RunListPage with a failed scan", () => {
  it("shows the reason and no scanning spinner", () => {
    readiness.current = {
      hasGames: false,
      state: "unreadable",
      scanErrors: [],
      scanFailure: "no space left on device",
    };
    render(
      <MemoryRouter>
        <RunListPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no space left on device/)).toBeTruthy();
    expect(screen.queryByText(/Scanning installed games/)).toBeNull();
  });
});

describe("RunListPage with a run file that could not be read", () => {
  it("says so, that nothing was changed, and gives the reason", () => {
    readiness.current = {
      hasGames: true,
      state: "ready",
      scanErrors: [],
      scanFailure: null,
    };
    readiness.runsError = "run.json is not valid JSON";
    render(
      <MemoryRouter>
        <RunListPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        "Your warpath runs could not be read. Nothing has been changed. run.json is not valid JSON",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No warpath in progress/)).toBeNull();
  });
});
