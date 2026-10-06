// @vitest-environment happy-dom
/**
 * The Warpath hub when the scan failed (unitsync's Init failed, issue #3423).
 * The readiness hook then reports "unreadable" with the reason, and the page has
 * to show it and not spin.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const readiness = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  runsError: null as string | null,
  unreadableCount: 0,
  runs: {} as Record<string, unknown>,
  deleteRun: vi.fn(),
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
    runs: readiness.runs,
    loading: false,
    error: readiness.runsError,
    unreadableCount: readiness.unreadableCount,
    deleteRun: readiness.deleteRun,
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
  readiness.unreadableCount = 0;
  readiness.runs = {};
  readiness.deleteRun.mockReset();
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

describe("RunListPage with runs kept in the file that could not be read", () => {
  function renderReady() {
    readiness.current = {
      hasGames: true,
      state: "ready",
      scanErrors: [],
      scanFailure: null,
    };
    render(
      <MemoryRouter>
        <RunListPage />
      </MemoryRouter>,
    );
  }

  it("says how many, and that they are kept and unchanged", () => {
    readiness.unreadableCount = 2;
    renderReady();
    expect(
      screen.getByText(
        "2 warpath runs could not be read. They are kept in the file and have not been changed.",
      ),
    ).toBeTruthy();
  });

  it("uses the singular for one", () => {
    readiness.unreadableCount = 1;
    renderReady();
    expect(
      screen.getByText(
        "1 warpath run could not be read. It is kept in the file and has not been changed.",
      ),
    ).toBeTruthy();
  });

  it("shows nothing when there are none", () => {
    renderReady();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });
});

describe("RunListPage while the engine is still being found", () => {
  it("shows a loading line and never the install message", () => {
    readiness.current = {
      hasGames: false,
      state: "finding-engine",
      scanErrors: [],
      scanFailure: null,
    };
    render(
      <MemoryRouter>
        <RunListPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Looking for an engine…")).toBeTruthy();
    expect(screen.queryByText(/Install an engine/)).toBeNull();
  });

  it("shows the install message once none was found", () => {
    readiness.current = {
      hasGames: false,
      state: "no-engine",
      scanErrors: [],
      scanFailure: null,
    };
    render(
      <MemoryRouter>
        <RunListPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Install an engine first/)).toBeTruthy();
  });
});

describe("Abandon on a warpath run", () => {
  const RUN = {
    name: "Cinder Reach",
    settings: { game: { shortname: "BA" }, side: "Armada" },
    progress: { status: "active", hull: 12, maxHull: 20 },
    updatedAt: "2026-01-01T00:00:00Z",
  };

  function renderRun(run: unknown = RUN) {
    readiness.current = {
      hasGames: true,
      state: "ready",
      scanErrors: [],
      scanFailure: null,
    };
    readiness.runs = { "run-1": run };
    render(
      <MemoryRouter>
        <RunListPage />
      </MemoryRouter>,
    );
  }

  it("does not abandon on one click, and says what is lost", () => {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: "Abandon" }));
    expect(readiness.deleteRun).not.toHaveBeenCalled();
    expect(screen.getByText("Abandon Cinder Reach?")).toBeTruthy();
    expect(
      screen.getByText(/deletes the warpath for good.*health 12\/20/),
    ).toBeTruthy();
  });

  it("does not abandon when cancelled", () => {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: "Abandon" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(readiness.deleteRun).not.toHaveBeenCalled();
  });

  it("abandons when confirmed", async () => {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: "Abandon" }));
    fireEvent.click(screen.getByRole("button", { name: "Abandon warpath" }));
    await waitFor(() =>
      expect(readiness.deleteRun).toHaveBeenCalledWith("run-1"),
    );
  });

  const onMap = (map: Record<string, unknown>) => ({
    ...RUN,
    settings: { ...RUN.settings, map },
  });
  const LAND = {
    source: "generated",
    style: "cities",
    seed: 1,
    nodeCount: 12,
  };

  it("names the planet of a run across generated land", () => {
    renderRun(onMap({ ...LAND, planet: "volcanic" }));
    expect(screen.getByText(/· Volcanic$/)).toBeTruthy();
  });

  it("calls a land run from before planets Temperate", () => {
    renderRun(onMap(LAND));
    expect(screen.getByText(/· Temperate$/)).toBeTruthy();
  });

  it("names no planet for a column run or a hand-made map", () => {
    renderRun();
    expect(screen.queryByText(/Temperate/)).toBeNull();
    cleanup();
    renderRun(onMap({ source: "handmade", id: "m" }));
    expect(screen.queryByText(/Temperate/)).toBeNull();
  });
});
