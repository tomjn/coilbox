// @vitest-environment happy-dom
/**
 * The Conquest "Generate a map" form opens on the style, shape, size and other
 * choices it was last used with, as long as the form still offers them for
 * the game (issue #3638). The seed is not remembered. With nothing remembered
 * it opens on the defaults, as it always did.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "conquest.generate.choices";

const h = vi.hoisted(() => ({
  drawerContent: null as unknown,
  installed: [] as string[],
  onlyOwnMaps: [] as string[],
  maps: [] as { id: string; game: { shortname: string } }[],
  preset: null as string | null,
  factsLoading: false,
  unlocks: {} as Record<string, { threatLevel: number }>,
}));

const ALL_GAMES: Record<string, { shortname: string }> = {
  "Alpha Game v1": { shortname: "AG" },
  "Cool Game v1": { shortname: "CG" },
  "Zed Game v1": { shortname: "ZG" },
};

// The frame's `useSetting` is stood in for by the installed storage, so a
// value written by one form is read by the next, as in the app.
vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({
    open: (o: { content: unknown }) => {
      h.drawerContent = o.content;
    },
    close: vi.fn(),
  }),
  useSetting: (key: string, fallback: unknown) => [
    readStoredSetting(key, fallback),
    (next: unknown) => storage.set(key, JSON.stringify(next)),
  ],
}));
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
// The shared game picker, as a button that names the game and a panel that lists
// them. Its own layout is tested with it.
vi.mock("../../play/pages/components/GamePickerButton", () => ({
  GamePickerButton: ({
    value,
    onClick,
  }: {
    value: string;
    onClick: () => void;
  }) => (
    <button type="button" data-testid="game-picker" onClick={onClick}>
      {value}
    </button>
  ),
}));
vi.mock("../../play/pages/components/GamePickerPanel", () => ({
  GamePickerPanel: ({
    games,
    onSelect,
    onBack,
  }: {
    games: { name: string }[];
    onSelect: (name: string) => void;
    onBack: () => void;
  }) => (
    <div>
      {games.map((g) => (
        <button
          key={g.name}
          type="button"
          onClick={() => {
            onSelect(g.name);
            onBack();
          }}
        >
          Pick {g.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../../content/config", () => ({
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useUnitsyncScan: () => ({
    data: {
      games: h.installed.map((name) => ({
        name,
        info: { shortname: ALL_GAMES[name].shortname, version: "v1" },
        primaryArchive: { name },
      })),
      maps: [{ name: "Comet Catcher Remake", width: 16, height: 16 }],
      errors: [],
    },
    error: null,
    loading: false,
    cancelled: false,
    unvouched: null,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("../../content/branding", () => ({
  resolveBranding: () => null,
  useBrandingCatalog: () => [],
}));
vi.mock("../../content/mapEligibility", () => {
  const eligible = (m: unknown[]) => m;
  return { useMapEligibility: () => ({ eligible }) };
});
vi.mock("../../content/useGamePresetParam", () => ({
  useGamePresetParam: () => h.preset,
}));
vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: null, hubItemId: null }),
}));
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../../play/config", () => ({
  usePlayReadiness: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
    state: "ready",
    scanErrors: [],
    scanFailure: null,
    refresh: vi.fn(),
  }),
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
  }),
  useSkirmishAis: () => ({
    ais: [{ shortName: "NullAI", version: "1", name: "NullAI" }],
    loading: false,
    loaded: true,
  }),
}));
vi.mock("../mapStyle", async (orig) => {
  const actual = await orig<typeof import("../mapStyle")>();
  return { ...actual, generateMap: vi.fn(actual.generateMap) };
});
vi.mock("../conquests", () => ({
  refreshGalaxies: vi.fn(),
  useGalaxies: () => ({ galaxies: [], loading: false, error: null }),
  useConquestState: () => ({ file: { conquests: {} }, saveFor: vi.fn() }),
}));
vi.mock("../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../profile/profile")>()),
  getProfile: () => ({}),
}));
vi.mock("../handmade/useHandmadeMaps", () => ({
  refreshHandmadeMaps: vi.fn(),
  useHandmadeMaps: () => ({
    maps: h.maps,
    unreadable: [],
    onlyOwnMaps: h.onlyOwnMaps,
    loading: false,
    savedLoading: false,
    error: null,
  }),
  useGameMapFacts: () => ({
    loading: h.factsLoading,
    facts: { maps: h.maps, onlyOwnMaps: h.onlyOwnMaps },
    error: undefined,
  }),
}));
vi.mock("../bindings", () => ({
  conquestDelete: vi.fn(),
  conquestSave: vi.fn(async () => {}),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));
vi.mock("../useUnlocks", () => {
  return {
    useConquestUnlocks: () => ({ unlocks: h.unlocks, award: vi.fn() }),
    useAwardFinishedConquest: () => {},
  };
});

import {
  installSettingsStorage,
  memorySettingsStorage,
  readStoredSetting,
} from "../../lib/storedSetting";
import { conquestSave } from "../bindings";
import { generateMap } from "../mapStyle";
import ConquestListPage from "./ConquestListPage";

let storage = memorySettingsStorage();

/** Open the drawer from the page's button, then mount what it holds. */
function openForm() {
  h.drawerContent = null;
  render(
    <MemoryRouter>
      <ConquestListPage />
    </MemoryRouter>,
  );
  if (!h.drawerContent) {
    fireEvent.click(screen.getByRole("button", { name: /Generate a map/ }));
  }
  cleanup();
  render(<MemoryRouter>{h.drawerContent as ReactNode}</MemoryRouter>);
}

/** The select that offers a value, the form's own way of naming a field. */
function selectOffering(value: string): HTMLSelectElement {
  const found = [...document.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.value === value),
  );
  if (!found) throw new Error(`no select offers ${value}`);
  return found;
}

const choose = (offering: string, value: string) =>
  fireEvent.change(selectOffering(offering), { target: { value } });
const shown = (offering: string) => selectOffering(offering).value;
const pressed = (name: RegExp) =>
  screen.getByRole("radio", { name }).getAttribute("aria-checked") === "true";
const fogOn = () =>
  screen.getByRole("switch").getAttribute("aria-checked") === "true";

/** Press Create map and read the document it saved. */
async function create() {
  vi.mocked(conquestSave).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Create map" }));
  await waitFor(() => expect(conquestSave).toHaveBeenCalled());
  const json = vi.mocked(conquestSave).mock.calls[0][0].json;
  return JSON.parse(json).generated as Record<string, unknown>;
}

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
  h.installed = ["Alpha Game v1", "Cool Game v1"];
  h.onlyOwnMaps = [];
  h.maps = [];
  h.preset = null;
  h.factsLoading = false;
  h.unlocks = {};
});
afterEach(cleanup);

/** Every choice changed from its default, so a reopened form shows them all. */
const CHANGED = {
  style: "territories",
  layout: "continent",
  size: "56",
  factions: "3",
  starting: "3",
};

describe("Conquest generate form: the other choices", () => {
  it("opens on the defaults and saves nothing when nothing is remembered", async () => {
    openForm();
    expect(shown("galaxy")).toBe("galaxy");
    expect(shown("random")).toBe("random");
    expect(shown("18")).toBe("18");
    expect(shown("3")).toBe("2");
    expect(shown("auto")).toBe("auto");
    expect(fogOn()).toBe(false);
    expect(pressed(/Level 0/)).toBe(true);
    expect(pressed(/Edge/)).toBe(true);
    expect(storage.get(KEY)).toBeNull();
    expect(await create()).toMatchObject({
      skin: "galaxy",
      layout: "random",
      nodeCount: 18,
      factionCount: 2,
    });
  });

  it("remembers each choice the player makes and opens on them next time", () => {
    h.unlocks = { ag: { threatLevel: 1 } };
    openForm();
    choose("territories", CHANGED.style);
    choose("continent", CHANGED.layout);
    choose("56", CHANGED.size);
    choose("3", CHANGED.factions);
    choose("auto", CHANGED.starting);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("radio", { name: /Level 1/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Centre/ }));
    expect(JSON.parse(storage.get(KEY) ?? "null")).toEqual({
      ...CHANGED,
      fog: true,
      threat: 1,
      start: "centre",
    });
    openForm();
    expect(shown("territories")).toBe("territories");
    expect(shown("continent")).toBe("continent");
    expect(shown("56")).toBe("56");
    expect(shown("3")).toBe("3");
    expect(shown("auto")).toBe("3");
    expect(fogOn()).toBe(true);
    expect(pressed(/Level 1/)).toBe(true);
    expect(pressed(/Centre/)).toBe(true);
  });

  it("never remembers the seed", async () => {
    openForm();
    await create();
    expect(JSON.parse(storage.get(KEY) ?? "null")).not.toHaveProperty("seed");
  });

  it("remembers what a map was created with, even when nothing was changed", async () => {
    storage.set(KEY, JSON.stringify({ size: "28" }));
    openForm();
    await create();
    expect(JSON.parse(storage.get(KEY) ?? "null")).toEqual({
      style: "galaxy",
      layout: "random",
      planet: "random",
      size: "28",
      radius: expect.any(String),
      factions: "2",
      starting: "auto",
      fog: false,
      threat: 0,
      start: "edge",
    });
  });

  it("makes the map with the remembered choices", async () => {
    storage.set(KEY, JSON.stringify({ ...CHANGED, fog: true }));
    openForm();
    expect(await create()).toMatchObject({
      skin: "territories",
      layout: "continent",
      nodeCount: 56,
      factionCount: 3,
      startingSystems: 3,
      fogOfWar: true,
    });
  });

  it("goes back to the default for a size or level this game has not unlocked", async () => {
    storage.set(
      KEY,
      JSON.stringify({ size: "120", threat: 2, start: "centre" }),
    );
    h.unlocks = { ag: { threatLevel: 1 } };
    openForm();
    expect(shown("18")).toBe("18");
    expect(pressed(/Level 0/)).toBe(true);
    // The centre start is open at level 1, so that one is kept.
    expect(pressed(/Centre/)).toBe(true);
    h.unlocks = {};
    openForm();
    expect(pressed(/Edge/)).toBe(true);
    const made = await create();
    expect(made.nodeCount).toBe(18);
    expect(made.threatLevel ?? 0).toBe(0);
  });

  it("keeps a size and level the game has unlocked", async () => {
    storage.set(KEY, JSON.stringify({ size: "120", threat: 2 }));
    h.unlocks = { ag: { threatLevel: 2 } };
    openForm();
    expect(shown("120")).toBe("120");
    expect(await create()).toMatchObject({ nodeCount: 120, threatLevel: 2 });
  });

  it("goes back to the default shape when the remembered style does not offer it", () => {
    storage.set(KEY, JSON.stringify({ style: "territories", layout: "ring" }));
    openForm();
    expect(shown("territories")).toBe("territories");
    expect(shown("continent")).toBe("random");
  });

  it("offers a planet for a land style and not for a galaxy", () => {
    openForm();
    expect(screen.queryByText("Planet")).toBeNull();
    expect(() => selectOffering("volcanic")).toThrow();
    choose("territories", "territories");
    expect(screen.getByText("Planet")).toBeTruthy();
    const planets = [...selectOffering("volcanic").options];
    expect(planets.map((o) => o.value)).toEqual([
      "random",
      "temperate",
      "desert",
      "ice",
      "red",
      "moon",
      "volcanic",
      "acid",
    ]);
    expect(planets).toHaveLength(8);
  });

  it("narrows the shapes for Volcanic", () => {
    openForm();
    choose("territories", "territories");
    choose("volcanic", "volcanic");
    const shapes = [...selectOffering("landlocked").options];
    expect(shapes.map((o) => o.textContent)).toEqual([
      "Surprise me",
      "One continent",
      "Coast",
      "Inland sea",
      "Landlocked",
    ]);
  });

  it("drops a remembered shape Volcanic does not offer", async () => {
    storage.set(
      KEY,
      JSON.stringify({
        style: "territories",
        layout: "continents",
        planet: "volcanic",
      }),
    );
    openForm();
    const shape = selectOffering("landlocked");
    expect(shape.value).toBe("random");
    expect(shape.selectedOptions[0].textContent).toBe("Surprise me");
    vi.mocked(generateMap).mockClear();
    await create();
    expect(vi.mocked(generateMap)).toHaveBeenCalledWith(
      expect.objectContaining({ layout: "random", planet: "volcanic" }),
    );
  });

  it("falls back to Surprise me for a stored planet nobody defined", () => {
    storage.set(KEY, JSON.stringify({ style: "territories", planet: "pluto" }));
    openForm();
    const planet = selectOffering("volcanic");
    expect(planet.value).toBe("random");
    expect(planet.selectedOptions[0].textContent).toBe("Surprise me");
  });

  it("ignores a stored value that is not a set of choices", () => {
    for (const stored of [
      "nonsense",
      "[1,2]",
      JSON.stringify({ style: "nebula", size: 7, fog: "yes", threat: -1 }),
    ]) {
      storage.set(KEY, stored);
      openForm();
      expect(shown("galaxy")).toBe("galaxy");
      expect(shown("18")).toBe("18");
      expect(fogOn()).toBe(false);
      expect(pressed(/Level 0/)).toBe(true);
    }
  });
});
