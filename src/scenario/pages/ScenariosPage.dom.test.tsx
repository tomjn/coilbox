// @vitest-environment happy-dom

/**
 * The Scenarios page offers a download for a row it cannot play because the
 * game or map is missing (issue #3367), reads its own scan again once the shared
 * launch check says everything is installed, and leaves a reason a download
 * cannot fix as text.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScenariosPage from "./ScenariosPage";

const mocks = vi.hoisted(() => ({
  scenarios: [] as unknown[],
  target: { enginePath: "/e", dataDir: "/d" } as unknown,
  refreshTarget: vi.fn(async () => {}),
  scan: {
    data: null as unknown,
    error: null as string | null,
    run: vi.fn(async () => null),
  },
  running: false,
  writeRoot: { loading: false, path: "/content" as string | undefined },
  ensureContent: vi.fn(),
}));

vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: mocks.target,
    loading: false,
    refresh: mocks.refreshTarget,
  }),
}));
vi.mock("@/content/config", () => ({ useUnitsyncScan: () => mocks.scan }));
vi.mock("@/play/PlayProvider", () => ({
  usePlay: () => ({ running: mocks.running }),
}));
vi.mock("@/play/LaunchContentProvider", () => ({
  useLaunchContent: () => ({ ensureContent: mocks.ensureContent }),
}));
vi.mock("@/downloads/config", () => ({ useWriteRoot: () => mocks.writeRoot }));
vi.mock("@/downloads/engineInstall", () => ({
  fetchNewestRecoil: async () => ({
    release: { version: "2025.06.12" },
    platform: "test",
  }),
}));
vi.mock("@picoframe/frame", async (importActual) => ({
  ...(await importActual<object>()),
  useDrawer: () => ({ open: vi.fn() }),
}));
vi.mock("@/deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: null, hubItemId: null }),
}));
vi.mock("@/deeplink/useOneShotParam", () => ({
  useOneShotParam: () => null,
}));
vi.mock("@/hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("@/notify/notify", () => ({ notify: vi.fn() }));
vi.mock("../scenarios", () => ({
  useScenarios: () => ({
    scenarios: mocks.scenarios,
    loading: false,
    error: null,
  }),
  scenarioRoute: () => "/",
}));
vi.mock("./components/ScenarioImportButton", () => ({
  ScenarioImportButton: () => null,
}));
vi.mock("./components/ScenarioTestDrawer", () => ({
  ScenarioTestDrawer: () => null,
}));

const scenario = {
  id: "s1",
  name: "Hold the line",
  description: "",
  actors: [],
  groups: [],
  zones: [],
  triggers: [],
  objectives: [],
  setup: {
    gameName: "Game 1.0",
    mapName: "Some Map",
    participants: [],
  },
};

const scanOf = (games: string[], maps: string[]) => ({
  games: games.map((name) => ({ name })),
  maps: maps.map((name) => ({ name })),
});

const play = () =>
  screen.getByRole("button", { name: /Play/ }) as HTMLButtonElement;

beforeEach(() => {
  mocks.scenarios = [{ scenario, source: "local" }];
  mocks.target = { enginePath: "/e", dataDir: "/d" };
  mocks.scan.data = scanOf([], ["Some Map"]);
  mocks.scan.error = null;
  mocks.scan.run.mockClear();
  mocks.refreshTarget.mockClear();
  mocks.running = false;
  mocks.writeRoot = { loading: false, path: "/content" };
  mocks.ensureContent.mockReset();
});
afterEach(cleanup);

describe("ScenariosPage download offer", () => {
  it("offers the missing game and asks for the game, never the generated archive", async () => {
    mocks.ensureContent.mockResolvedValue({ ready: true, target: {} });
    render(<ScenariosPage />);

    expect(play().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Download game" }));

    await waitFor(() => expect(mocks.ensureContent).toHaveBeenCalledTimes(1));
    const request = mocks.ensureContent.mock.calls[0][0];
    expect(
      request.requirements.map((r: { kind: string; label: string }) => [
        r.kind,
        r.label,
      ]),
    ).toEqual([["game", "Game 1.0"]]);
  });

  it("reads the engines and the scan again once the check says it is ready", async () => {
    mocks.ensureContent.mockResolvedValue({ ready: true, target: {} });
    render(<ScenariosPage />);

    fireEvent.click(screen.getByRole("button", { name: "Download game" }));

    await waitFor(() => expect(mocks.scan.run).toHaveBeenCalledWith(true));
    expect(mocks.refreshTarget).toHaveBeenCalledTimes(1);
  });

  it("reads nothing again when the player cancels", async () => {
    mocks.ensureContent.mockResolvedValue({
      ready: false,
      reason: "cancelled",
    });
    render(<ScenariosPage />);

    fireEvent.click(screen.getByRole("button", { name: "Download game" }));

    await waitFor(() => expect(mocks.ensureContent).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Download game",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(mocks.scan.run).not.toHaveBeenCalled();
  });

  it("offers the map when only the map is missing", () => {
    mocks.scan.data = scanOf(["Game 1.0"], []);
    render(<ScenariosPage />);

    expect(screen.getByRole("button", { name: "Download map" })).toBeTruthy();
  });

  it("offers an engine when none is installed", async () => {
    mocks.target = null;
    mocks.scan.data = null;
    mocks.ensureContent.mockResolvedValue({ ready: true, target: {} });
    render(<ScenariosPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Download engine" }),
    );

    await waitFor(() => expect(mocks.ensureContent).toHaveBeenCalled());
    const request = mocks.ensureContent.mock.calls[0][0];
    expect(
      request.requirements.map((r: { kind: string; label: string }) => [
        r.kind,
        r.label,
      ]),
    ).toEqual([["engine", "2025.06.12"]]);
  });

  it("offers nothing for a game that is already running", () => {
    mocks.scan.data = scanOf(["Game 1.0"], ["Some Map"]);
    mocks.running = true;
    render(<ScenariosPage />);

    expect(screen.getByText("A game is already running.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("offers nothing after a failed content scan", () => {
    mocks.scan.data = null;
    mocks.scan.error = "Init failed";
    render(<ScenariosPage />);

    expect(
      screen.getByText("The content scan failed: Init failed"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("keeps Play off and claims nothing is missing after a failed content scan", () => {
    mocks.scan.data = null;
    mocks.scan.error = "no space left on device";
    render(<ScenariosPage />);

    expect(play().disabled).toBe(true);
    expect(
      screen.getByText("The content scan failed: no space left on device"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /not installed|No game is installed|Download/,
    );
  });
});
