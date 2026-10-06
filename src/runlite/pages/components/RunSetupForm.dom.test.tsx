// @vitest-environment happy-dom

/**
 * The Warpath setup form offers the loadouts and ascension tiers of the game
 * selected in it: the legacy record's unlocks plus that game's own.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
  readStoredSetting,
} from "../../../lib/storedSetting";
import { LAND_RUN_SIZES, resolveRunMap } from "../../mapRun";
import {
  emptyMeta,
  emptyRecord,
  type RogueliteMeta,
  type RogueliteRun,
} from "../../model";

const hoisted = vi.hoisted(() => ({
  meta: null as unknown,
  loading: false,
  error: null as string | null,
  maps: [] as { name: string; width: number; height: number }[],
  saved: [] as { id: string; run: unknown }[],
  /** Games that are not installed, by name. */
  uninstalled: [] as string[],
  /** A distribution profile's game filter, or null for none. */
  matcher: null as ((name: string) => boolean) | null,
  /** The sides every game lists. */
  sides: [] as { name: string }[],
  /** Hand-made maps with a Warpath start and goal, all for Zero-K. */
  handmadeMaps: [] as { id: string; title: string }[],
}));

// The frame's `useSetting` is stood in for by the installed storage, so a value
// written by one form is read by the next, as in the app.
vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useSetting: (key: string, fallback: unknown) => [
    readStoredSetting(key, fallback),
    (next: unknown) => storage.set(key, JSON.stringify(next)),
  ],
}));

const GAMES: {
  name: string;
  info: { shortname: string };
  primaryArchive: { name: string };
  missingDependencies?: string[];
}[] = [
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
  useRunMeta: () => ({
    meta: hoisted.meta,
    loading: hoisted.loading,
    error: hoisted.error,
  }),
  useRuns: () => ({
    saveRun: async (id: string, run: unknown) => {
      hoisted.saved.push({ id, run });
    },
  }),
}));
// The registry select opens a popover, which is more than these tests need to
// drive. A native one takes the same props.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (v: string) => void;
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
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
  }),
  useSkirmishAis: () => ({ ais: [] }),
}));
vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: {
      games: GAMES.filter((g) => !hoisted.uninstalled.includes(g.name)),
      maps: hoisted.maps,
    },
    loading: false,
  }),
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useUnitsyncGameInfo: () => ({
    info: { sides: hoisted.sides },
    loading: false,
  }),
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
  getGameMatcher: () => hoisted.matcher,
  getProfile: () => ({}),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogos: () => ({}) }));
vi.mock("../../../conquest/handmade/useHandmadeMaps", () => ({
  useHandmadeMaps: () => ({ maps: [], unreadable: [], error: null }),
  useGameMapFacts: () => ({
    loading: false,
    facts: {
      maps: hoisted.handmadeMaps.map((m) => ({
        ...m,
        game: { shortname: "ZK" },
        source: "imported",
        warpath: true,
      })),
      onlyOwnMaps: [],
    },
    error: undefined,
  }),
}));
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

let storage = memorySettingsStorage();

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
  hoisted.uninstalled = [];
  hoisted.matcher = null;
  hoisted.sides = [];
  hoisted.handmadeMaps = [];
  hoisted.loading = false;
  hoisted.error = null;
  hoisted.saved = [];
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

describe("RunSetupForm and a missing dependency archive", () => {
  const BA = "Balanced Annihilation V15.9.8";
  beforeEach(() => {
    hoisted.maps = [{ name: "Comet Catcher Remake", width: 16, height: 16 }];
  });
  // The banner links to the game downloads, so it needs a router.
  const show = (meta: RogueliteMeta) => {
    hoisted.meta = meta;
    return render(
      <MemoryRouter>
        <RunSetupForm onStarted={() => {}} />
      </MemoryRouter>,
    );
  };
  afterEach(() => {
    delete GAMES[0].missingDependencies;
    hoisted.maps = [];
  });

  it("names the missing archive and still lets the player begin", () => {
    GAMES[0].missingDependencies = ["base-content"];
    show(emptyMeta);
    expect(
      screen.getByText(/Archive not installed: base-content\. Balanced/),
    ).toBeTruthy();
    // Beginning a run is not a launch, so the form is not blocked.
    const begin = screen.getByRole("button", { name: /Begin warpath/ });
    expect((begin as HTMLButtonElement).disabled).toBe(false);
  });

  it("says nothing for a game with nothing missing", () => {
    show(emptyMeta);
    expect(screen.queryByText(/Archive not installed/)).toBeNull();
  });

  it("follows the selected game", () => {
    GAMES[0].missingDependencies = ["base-content"];
    show(emptyMeta);
    pick("Zero-K v1.14.10.1");
    expect(screen.queryByText(/Archive not installed/)).toBeNull();
    pick(BA);
    expect(screen.getByText(/Archive not installed/)).toBeTruthy();
  });
});

describe("RunSetupForm and a Warpath record that failed to load", () => {
  const NOTICE = /Warpath records could not be read/;
  const begin = () =>
    screen.getByRole("button", { name: /Begin warpath/ }) as HTMLButtonElement;

  it("says the record could not be read and that the file is unchanged", () => {
    hoisted.error = "meta.json is not valid JSON";
    show(emptyMeta);
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(
      screen.getByText(/only the standard options are offered/i),
    ).toBeTruthy();
    expect(screen.getByText(/file has not been changed/i)).toBeTruthy();
    expect(screen.getByText(/meta\.json is not valid JSON/)).toBeTruthy();
  });

  it("says nothing while the record is still loading", () => {
    hoisted.loading = true;
    hoisted.error = "an old failure";
    show(emptyMeta);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("says nothing when the record loaded", () => {
    show(emptyMeta);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("still lets the player begin", () => {
    hoisted.error = "meta.json is not valid JSON";
    hoisted.maps = [{ name: "Comet Catcher Remake", width: 16, height: 16 }];
    show(emptyMeta);
    expect(begin().disabled).toBe(false);
    hoisted.maps = [];
  });
});

describe("RunSetupForm and the four map styles (issue #3507)", () => {
  beforeEach(() => {
    hoisted.maps = [{ name: "Comet Catcher Remake", width: 16, height: 16 }];
  });
  afterEach(() => {
    hoisted.maps = [];
  });

  const styleSelect = () => {
    const found = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "territories"),
    );
    if (!found) throw new Error("no map style select");
    return found;
  };
  const begin = async (): Promise<RogueliteRun> => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Begin warpath/ }));
    });
    expect(hoisted.saved).toHaveLength(1);
    return hoisted.saved[0].run as RogueliteRun;
  };

  it("offers the four styles Conquest offers, under the same names", () => {
    show(emptyMeta);
    expect([...styleSelect().options].map((o) => o.textContent)).toEqual([
      "Galaxy (starfield)",
      "Theatre (flat chart)",
      "Cities (roads across generated land)",
      "Territories (provinces on generated land)",
    ]);
    expect(document.body.textContent).not.toMatch(/galaxy of|star system/i);
  });

  for (const style of ["galaxy", "theatre"] as const) {
    it(`begins a ${style} run in columns, with no map`, async () => {
      show(emptyMeta);
      fireEvent.change(styleSelect(), { target: { value: style } });
      expect(screen.queryByText(/The map decides how long/)).toBeNull();
      const run = await begin();
      expect(run.settings.skin).toBe(style);
      expect(run.settings.map).toBeUndefined();
    });
  }

  const planetSelect = () =>
    [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "volcanic"),
    );

  it("offers a planet for the two land styles only, and begins on it", async () => {
    show(emptyMeta);
    expect(planetSelect()).toBeUndefined();
    fireEvent.change(styleSelect(), { target: { value: "territories" } });
    const select = planetSelect();
    if (!select) throw new Error("no planet select");
    expect(select.value).toBe("random");
    fireEvent.change(select, { target: { value: "moon" } });
    fireEvent.click(screen.getByRole("radio", { name: "quick" }));
    const run = await begin();
    expect(run.settings.map).toMatchObject({ planet: "moon" });
  });

  for (const [style, many] of [
    ["cities", "cities"],
    ["territories", "provinces"],
  ] as const) {
    it(`begins a ${style} run across a generated map of the chosen length`, async () => {
      show(emptyMeta);
      fireEvent.change(styleSelect(), { target: { value: style } });
      expect(
        screen.getByText(
          `The map decides how long this warpath is. This length crosses a map of ${LAND_RUN_SIZES[style].standard} ${many}.`,
        ),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("radio", { name: "quick" }));
      expect(
        screen.getByText(
          new RegExp(`a map of ${LAND_RUN_SIZES[style].quick} ${many}\\.`),
        ),
      ).toBeTruthy();

      const run = await begin();
      expect(run.settings.skin).toBe(style);
      // The map's seed is not checked. The form draws a random seed, and a
      // run whose first map offers no choice of route moves to a later map.
      expect(run.settings.map).toMatchObject({
        source: "generated",
        style,
        nodeCount: LAND_RUN_SIZES[style].quick,
      });
      // The saved run opens on the map it was made on.
      const ref = run.settings.map;
      if (!ref) throw new Error("expected a map reference");
      const map = resolveRunMap(ref, run.settings.game)?.map;
      const locations = new Set(map?.nodes.map((n) => n.id));
      expect(run.nodes.length).toBeGreaterThan(1);
      for (const node of run.nodes) {
        expect(locations.has(node.location ?? "")).toBe(true);
      }
    });
  }
});

describe("RunSetupForm and the last game (issue #3637)", () => {
  const KEY = "warpath.setup.lastGame";
  const ZK = "Zero-K v1.14.10.1";
  const BA = "Balanced Annihilation V15.9.8";
  // The loadouts differ per game, so they say which game the form is on.
  const meta = {
    ...emptyMeta,
    games: {
      ba: { ...emptyRecord, loadouts: ["vanguard"] },
      zk: { ...emptyRecord, loadouts: ["air"] },
    },
  };
  const onGame = () => (loadouts().includes("Air superiority") ? ZK : BA);

  it("opens on the first game when nothing is remembered", () => {
    show(meta);
    expect(onGame()).toBe(BA);
    expect(storage.get(KEY)).toBeNull();
  });

  it("remembers the game the player picks and opens on it next time", () => {
    show(meta);
    pick(ZK);
    expect(storage.get(KEY)).toBe(JSON.stringify(ZK));
    cleanup();
    show(meta);
    expect(onGame()).toBe(ZK);
  });

  it("falls back to the first game when the remembered one is not installed", () => {
    storage.set(KEY, JSON.stringify(ZK));
    hoisted.uninstalled = [ZK];
    show(meta);
    expect(onGame()).toBe(BA);
  });

  it("falls back to the first game when a profile filter hides the remembered one", () => {
    storage.set(KEY, JSON.stringify(ZK));
    hoisted.matcher = (name) => name !== ZK;
    show(meta);
    expect(onGame()).toBe(BA);
  });

  it("prefers a game named by the caller over the remembered one", () => {
    storage.set(KEY, JSON.stringify(ZK));
    hoisted.meta = meta;
    render(<RunSetupForm onStarted={() => {}} initialGameName={BA} />);
    expect(onGame()).toBe(BA);
  });

  it("remembers the game a run was begun in, even when it was never picked", async () => {
    hoisted.meta = meta;
    hoisted.maps = [{ name: "Comet Catcher Remake", width: 16, height: 16 }];
    render(<RunSetupForm onStarted={() => {}} initialGameName={ZK} />);
    expect(storage.get(KEY)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Begin warpath/ }));
    });
    expect(storage.get(KEY)).toBe(JSON.stringify(ZK));
    hoisted.maps = [];
  });
});

describe("RunSetupForm and the other choices (issue #3638)", () => {
  const KEY = "warpath.setup.choices";
  const ZK = "Zero-K v1.14.10.1";
  const meta = {
    ...emptyMeta,
    games: {
      zk: { ...emptyRecord, loadouts: ["air"], ascensionTier: 2 },
      ba: { ...emptyRecord },
    },
  };
  const styleSelect = () => {
    const found = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "territories"),
    );
    if (!found) throw new Error("no map style select");
    return found;
  };
  const ascensionSelect = () => {
    const found = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "2" && o.textContent === "Tier 2"),
    );
    if (!found) throw new Error("no ascension select");
    return found;
  };
  const isOn = (name: string | RegExp) =>
    screen.getByRole("radio", { name }).getAttribute("aria-checked") === "true";
  const stored = () => JSON.parse(storage.get(KEY) ?? "null");
  const begin = async (): Promise<RogueliteRun> => {
    hoisted.saved = [];
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Begin warpath/ }));
    });
    return hoisted.saved[0].run as RogueliteRun;
  };

  beforeEach(() => {
    hoisted.maps = [{ name: "Comet Catcher Remake", width: 16, height: 16 }];
  });
  afterEach(() => {
    hoisted.maps = [];
  });

  it("opens on the defaults and saves nothing when nothing is remembered", () => {
    hoisted.sides = [{ name: "Arm" }, { name: "Core" }];
    show(meta);
    expect(styleSelect().value).toBe("galaxy");
    expect(isOn("Arm")).toBe(true);
    expect(isOn("standard")).toBe(true);
    expect(screen.getByText("Difficulty — level 2")).toBeTruthy();
    expect(storage.get(KEY)).toBeNull();
  });

  it("remembers the choices the player makes and opens on them next time", () => {
    hoisted.sides = [{ name: "Arm" }, { name: "Core" }];
    show(meta);
    pick(ZK);
    fireEvent.change(styleSelect(), { target: { value: "territories" } });
    fireEvent.click(screen.getByRole("radio", { name: "long" }));
    fireEvent.click(screen.getByRole("radio", { name: "Core" }));
    fireEvent.click(screen.getByRole("radio", { name: "Air superiority" }));
    fireEvent.change(ascensionSelect(), { target: { value: "2" } });
    expect(stored()).toEqual({
      skin: "territories",
      mapId: null,
      length: "long",
      side: "Core",
      loadout: "air",
      ascension: 2,
    });
    cleanup();
    show(meta);
    expect(styleSelect().value).toBe("territories");
    expect(isOn("long")).toBe(true);
    expect(isOn("Core")).toBe(true);
    expect(isOn("Air superiority")).toBe(true);
    expect(ascensionSelect().value).toBe("2");
  });

  it("remembers what a run was begun with, even when nothing was changed", async () => {
    show(meta);
    await begin();
    expect(stored()).toEqual({
      skin: "galaxy",
      planet: "random",
      mapId: null,
      length: "standard",
      difficulty: 2,
      ascension: 0,
      loadout: "standard",
    });
  });

  it("begins the run with the remembered choices", async () => {
    storage.set(KEY, JSON.stringify({ skin: "theatre", length: "long" }));
    show(meta);
    const run = await begin();
    expect(run.settings.skin).toBe("theatre");
    expect(run.settings.length).toBe("long");
  });

  it("goes back to the default for a loadout, tier or side the game does not have", () => {
    storage.set(
      KEY,
      JSON.stringify({ loadout: "air", ascension: 2, side: "Core" }),
    );
    hoisted.sides = [{ name: "Arm" }];
    // Balanced Annihilation has no unlocks, and no side called Core.
    show(meta);
    expect(screen.queryByText("Loadout")).toBeNull();
    expect(screen.queryByText("Ascension")).toBeNull();
    expect(isOn("Arm")).toBe(true);
    // Zero-K has the loadout and tier, and the stored values return.
    pick(ZK);
    expect(isOn("Air superiority")).toBe(true);
    expect(ascensionSelect().value).toBe("2");
  });

  it("goes back to the generated styles for a hand-made map the game does not have", () => {
    storage.set(KEY, JSON.stringify({ mapId: "two-shores" }));
    show(meta);
    expect(styleSelect().value).toBe("galaxy");
    hoisted.handmadeMaps = [{ id: "two-shores", title: "Two Shores" }];
    cleanup();
    show(meta);
    pick(ZK);
    expect(styleSelect().value).toBe("handmade:two-shores");
  });

  it("ignores a stored value that is not a set of choices", () => {
    for (const bad of [
      "nonsense",
      "[1]",
      JSON.stringify({ skin: "nebula", length: "forever", difficulty: 9 }),
    ]) {
      storage.set(KEY, bad);
      cleanup();
      show(meta);
      expect(styleSelect().value).toBe("galaxy");
      expect(isOn("standard")).toBe(true);
    }
  });
});
