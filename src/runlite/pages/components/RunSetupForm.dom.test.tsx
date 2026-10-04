// @vitest-environment happy-dom

/**
 * The Warpath setup form offers the loadouts and ascension tiers of the game
 * selected in it: the legacy record's unlocks plus that game's own.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyMeta, emptyRecord, type RogueliteMeta } from "../../model";

const hoisted = vi.hoisted(() => ({ meta: null as unknown }));

const GAMES = [
  {
    name: "Balanced Annihilation V15.9.8",
    info: { shortname: "BA" },
    primaryArchive: { name: "Balanced Annihilation V15.9.8" },
  },
  {
    name: "Zero-K v1.14.10.1",
    info: { shortname: "ZK" },
    primaryArchive: { name: "Zero-K v1.14.10.1" },
  },
];

vi.mock("../../runs", () => ({
  useRunMeta: () => ({ meta: hoisted.meta }),
  useRuns: () => ({ saveRun: vi.fn() }),
}));
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
  }),
  useSkirmishAis: () => ({ ais: [] }),
}));
vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: { games: GAMES, maps: [] },
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
  getProfile: () => ({}),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogos: () => ({}) }));
// The real card reads the frame. A button per game stands in for its picker.
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

import { RunSetupForm } from "./RunSetupForm";

const show = (meta: RogueliteMeta) => {
  hoisted.meta = meta;
  return render(<RunSetupForm onStarted={() => {}} />);
};
const pick = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Pick ${name}` }));
// The length choice is a radio group too, so keep only the loadout names.
const LENGTHS = ["quick", "standard", "long"];
const loadouts = () =>
  screen
    .queryAllByRole("radio")
    .map((r) => r.textContent ?? "")
    .filter((t) => !LENGTHS.includes(t));

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("RunSetupForm unlocks", () => {
  it("offers different loadouts for two games with their own records", () => {
    show({
      ...emptyMeta,
      games: {
        ba: { ...emptyRecord, loadouts: ["vanguard"] },
        zk: { ...emptyRecord, loadouts: ["air", "recon"] },
      },
    });
    // Balanced Annihilation is selected first.
    expect(loadouts()).toContain("Armoured vanguard");
    expect(loadouts()).not.toContain("Air superiority");
    pick("Zero-K v1.14.10.1");
    expect(loadouts()).toContain("Air superiority");
    expect(loadouts()).toContain("Recon doctrine");
    expect(loadouts()).not.toContain("Armoured vanguard");
    pick("Balanced Annihilation V15.9.8");
    expect(loadouts()).toContain("Armoured vanguard");
    expect(loadouts()).not.toContain("Air superiority");
  });

  it("offers no loadout choice in a game with no unlocks, and the Ascension choice only where a tier is unlocked", () => {
    show({
      ...emptyMeta,
      games: {
        zk: { ...emptyRecord, loadouts: ["vanguard"], ascensionTier: 1 },
      },
    });
    expect(screen.queryByText("Loadout")).toBeNull();
    expect(screen.queryByText("Ascension")).toBeNull();
    pick("Zero-K v1.14.10.1");
    expect(screen.getByText("Loadout")).toBeTruthy();
    expect(screen.getByText("Ascension")).toBeTruthy();
  });

  it("offers the legacy unlocks in every game", () => {
    show({
      ...emptyMeta,
      legacy: {
        ...emptyRecord,
        loadouts: ["vanguard"],
        ascensionTier: 1,
        stats: { runs: 1, wins: 1, deepest: 8 },
      },
    });
    for (const name of ["Balanced Annihilation V15.9.8", "Zero-K v1.14.10.1"]) {
      pick(name);
      expect(loadouts()).toEqual(["Standard deployment", "Armoured vanguard"]);
      expect(screen.getByText("Ascension")).toBeTruthy();
    }
  });

  it("falls back to the default loadout when the new game does not offer the one chosen", () => {
    show({
      ...emptyMeta,
      games: {
        ba: { ...emptyRecord, loadouts: ["vanguard"] },
      },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Armoured vanguard" }));
    expect(
      screen
        .getByRole("radio", { name: "Armoured vanguard" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    pick("Zero-K v1.14.10.1");
    // ZK has no unlocks, so the field is gone and the default applies.
    expect(screen.queryByText("Loadout")).toBeNull();
  });
});
