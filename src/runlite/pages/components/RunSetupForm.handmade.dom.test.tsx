// @vitest-environment happy-dom

/**
 * The Warpath setup form offers a hand-made map beside the generated styles
 * when the map is for the selected game and its author marked a start and a
 * goal (issue #3514). Beginning on one reads the map and generates the run
 * across it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandmadeMapSummary } from "../../../conquest/handmade/library";
import { emptyMeta } from "../../model";

const hoisted = vi.hoisted(() => ({
  maps: [] as unknown[],
  onlyOwnMaps: [] as string[],
  profile: {} as Record<string, unknown>,
  listError: null as string | null,
  loadMap: vi.fn(),
  generateMapRun: vi.fn(),
  generateRun: vi.fn(),
  saveRun: vi.fn(),
  onStarted: vi.fn(),
}));

const GAMES = [
  {
    name: "Test Game 1",
    info: { shortname: "TG" },
    primaryArchive: { name: "Test Game 1" },
  },
  {
    name: "Zero-K v1.14.10.1",
    info: { shortname: "ZK" },
    primaryArchive: { name: "Zero-K v1.14.10.1" },
  },
];

// The frame's settings need its provider. These tests never set a last game.
vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
vi.mock("../../runs", () => ({
  useRunMeta: () => ({ meta: emptyMeta, loading: false, error: null }),
  useRuns: () => ({ saveRun: hoisted.saveRun }),
}));
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
  }),
  useSkirmishAis: () => ({ ais: [] }),
}));
vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: {
      games: GAMES,
      maps: [{ name: "Comet Catcher Remake", width: 16, height: 16 }],
    },
    loading: false,
  }),
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useUnitsyncGameInfo: () => ({ info: { sides: [] }, loading: false }),
  useUnitsyncUnitDataset: () => ({
    dataset: null,
    status: "ready",
    loading: false,
  }),
}));
vi.mock("../../../content/branding", () => ({
  resolveBranding: () => null,
  useBrandingCatalog: () => [],
}));
vi.mock("../../../content/mapEligibility", () => ({
  useMapEligibility: () => ({ eligible: (maps: unknown[]) => maps }),
}));
vi.mock("../../../profile/profile", () => ({
  getGameMatcher: () => null,
  getProfile: () => hoisted.profile,
}));
vi.mock("@/factions/logos", () => ({ useFactionLogos: () => ({}) }));
vi.mock("../../../play/pages/components/GameSelectCard", () => ({
  GameSelectCard: ({
    games,
    onSelectGame,
  }: {
    games: { name: string }[];
    onSelectGame: (name: string) => void;
  }) => (
    <div>
      {games.map((g) => (
        <button key={g.name} type="button" onClick={() => onSelectGame(g.name)}>
          Pick {g.name}
        </button>
      ))}
    </div>
  ),
}));
// A native select stands in for the registry one, which needs a real layout.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("../../../conquest/handmade/useHandmadeMaps", () => ({
  useHandmadeMaps: () => ({
    maps: hoisted.maps,
    unreadable: [],
    onlyOwnMaps: hoisted.onlyOwnMaps,
    error: hoisted.listError,
  }),
}));
vi.mock("../../handmadeMap", () => ({ loadHandmadeRunMap: hoisted.loadMap }));
// A generated style goes through `generateStyledRun`, which is the column run
// for Galaxy and Theatre.
vi.mock("../../mapRun", async (orig) => ({
  ...(await orig<typeof import("../../mapRun")>()),
  generateMapRun: hoisted.generateMapRun,
  generateStyledRun: hoisted.generateRun,
}));

import { RunSetupForm } from "./RunSetupForm";

/** The four generated styles, which every game is offered. */
const GENERATED_STYLES = [
  "Galaxy (starfield)",
  "Theatre (flat chart)",
  "Cities (roads across generated land)",
  "Territories (provinces on generated land)",
];

const map = (change: Partial<HandmadeMapSummary>): HandmadeMapSummary => ({
  id: "two-shores",
  title: "Two Shores",
  game: { shortname: "TG" },
  source: "imported",
  warpath: true,
  ...change,
});

const show = () => render(<RunSetupForm onStarted={hoisted.onStarted} />);
const styles = () =>
  [...screen.getByRole("combobox").querySelectorAll("option")].map(
    (o) => o.textContent,
  );
const pickStyle = (value: string) =>
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
const begin = () =>
  fireEvent.click(screen.getByRole("button", { name: /Begin warpath/ }));

beforeEach(() => {
  localStorage.clear();
  hoisted.maps = [];
  hoisted.onlyOwnMaps = [];
  hoisted.profile = {};
  hoisted.listError = null;
  hoisted.saveRun.mockResolvedValue(undefined);
  hoisted.generateRun.mockReturnValue({ kind: "column run" });
  hoisted.generateMapRun.mockReturnValue({ kind: "map run" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RunSetupForm and hand-made maps", () => {
  it("offers a map with markings for the selected game beside the styles", () => {
    hoisted.maps = [map({})];
    show();
    expect(styles()).toEqual([
      ...GENERATED_STYLES,
      "Two Shores (hand-made map)",
    ]);
  });

  it("does not offer a map with no start and goal", () => {
    hoisted.maps = [map({ warpath: false })];
    show();
    expect(styles()).toEqual(GENERATED_STYLES);
  });

  it("does not offer a map made for another game", () => {
    hoisted.maps = [map({ game: { shortname: "BA" } })];
    show();
    expect(styles()).toEqual(GENERATED_STYLES);
  });

  it("follows the selected game, and drops a map picked for the last one", () => {
    hoisted.maps = [map({})];
    show();
    pickStyle("handmade:two-shores");
    expect(screen.queryByText("Length")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Pick Zero-K v1.14.10.1" }),
    );
    expect(styles()).toEqual(GENERATED_STYLES);
    expect(screen.getByText("Length")).toBeTruthy();
  });

  it("generates the run across the map it reads when one is picked", async () => {
    hoisted.maps = [map({})];
    const source = { map: { id: "two-shores" }, startId: "a", goalId: "b" };
    hoisted.loadMap.mockResolvedValue({ ok: true, source });
    show();
    pickStyle("handmade:two-shores");
    begin();

    await vi.waitFor(() => expect(hoisted.onStarted).toHaveBeenCalledTimes(1));
    expect(hoisted.loadMap).toHaveBeenCalledWith("two-shores");
    expect(hoisted.generateMapRun.mock.calls[0][0]).toMatchObject({
      ...source,
      game: { shortname: "TG", pinnedName: "Test Game 1" },
      skin: "theatre",
    });
    expect(hoisted.saveRun.mock.calls[0][1]).toEqual({ kind: "map run" });
    expect(hoisted.generateRun).not.toHaveBeenCalled();
  });

  it("starts nothing and gives the reason when the map cannot be read", async () => {
    hoisted.maps = [map({})];
    hoisted.loadMap.mockResolvedValue({
      ok: false,
      message: 'No hand-made map with the id "two-shores" is installed.',
    });
    show();
    pickStyle("handmade:two-shores");
    begin();

    await screen.findByText(
      /The warpath was not started\. No hand-made map with the id "two-shores" is installed\./,
    );
    expect(hoisted.saveRun).not.toHaveBeenCalled();
    expect(hoisted.onStarted).not.toHaveBeenCalled();
  });

  it("still generates a column run for a generated style", async () => {
    hoisted.maps = [map({})];
    show();
    begin();

    await vi.waitFor(() => expect(hoisted.onStarted).toHaveBeenCalledTimes(1));
    expect(hoisted.saveRun.mock.calls[0][1]).toEqual({ kind: "column run" });
    expect(hoisted.loadMap).not.toHaveBeenCalled();
  });

  it("offers only the game's own maps when the game asks for that", () => {
    hoisted.maps = [map({ source: "game", carriedBy: "Test Game 1" })];
    hoisted.onlyOwnMaps = ["Test Game 1"];
    show();
    expect(styles()).toEqual(["Two Shores (hand-made map)"]);
    // A hand-made map decides the length, so it is the one picked.
    expect(screen.queryByText("Length")).toBeNull();
  });

  it("still offers the styles to every other game", () => {
    hoisted.maps = [map({ source: "game", carriedBy: "Test Game 1" })];
    hoisted.onlyOwnMaps = ["Test Game 1"];
    show();
    fireEvent.click(
      screen.getByRole("button", { name: "Pick Zero-K v1.14.10.1" }),
    );
    expect(styles()).toEqual(GENERATED_STYLES);
  });

  it("offers the styles when the game has no map with Warpath markings", () => {
    hoisted.maps = [map({ source: "game", warpath: false })];
    hoisted.onlyOwnMaps = ["Test Game 1"];
    show();
    expect(styles()).toEqual(GENERATED_STYLES);
  });

  it("offers only hand-made maps when the profile asks for that", () => {
    hoisted.maps = [map({ source: "bundled" })];
    hoisted.profile = { onlyOwnMaps: true };
    show();
    expect(styles()).toEqual(["Two Shores (hand-made map)"]);
  });

  it("keeps the styles for a game with no map with markings, whatever the profile says", () => {
    hoisted.maps = [map({ source: "bundled", warpath: false })];
    hoisted.profile = { onlyOwnMaps: true };
    show();
    expect(styles()).toEqual(GENERATED_STYLES);
  });

  it("keeps the styles for a game the maps were not made for", () => {
    hoisted.maps = [map({ source: "bundled" })];
    hoisted.profile = { onlyOwnMaps: true };
    show();
    fireEvent.click(
      screen.getByRole("button", { name: "Pick Zero-K v1.14.10.1" }),
    );
    expect(styles()).toEqual(GENERATED_STYLES);
  });

  it("changes nothing when the profile key is absent, false or not a boolean", () => {
    hoisted.maps = [map({ source: "bundled" })];
    for (const profile of [
      {},
      { onlyOwnMaps: false },
      { onlyOwnMaps: "yes" },
    ]) {
      hoisted.profile = profile;
      show();
      expect(styles()).toContain("Galaxy (starfield)");
      cleanup();
    }
  });

  it("begins a run on the game's own map with nothing picked", async () => {
    hoisted.maps = [map({ source: "game", carriedBy: "Test Game 1" })];
    hoisted.onlyOwnMaps = ["Test Game 1"];
    hoisted.loadMap.mockResolvedValue({
      ok: true,
      source: { map: { id: "two-shores" }, startId: "a", goalId: "b" },
    });
    show();
    begin();
    await vi.waitFor(() => expect(hoisted.onStarted).toHaveBeenCalledTimes(1));
    expect(hoisted.loadMap).toHaveBeenCalledWith("two-shores");
    expect(hoisted.generateRun).not.toHaveBeenCalled();
  });

  it("says when the hand-made maps could not be listed", () => {
    hoisted.listError = "disk unplugged";
    show();
    expect(
      screen.getByText(/hand-made maps could not be listed.*disk unplugged/),
    ).toBeTruthy();
  });
});
