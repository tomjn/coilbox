// @vitest-environment happy-dom
/**
 * The Conquest "Generate a map" form and its four map styles (issue #3507):
 * the order of the fields, which of them belong to the Galaxy style alone, the
 * wording for a map that is not a galaxy, and the land preview.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  drawerContent: null as unknown,
  drawerTitle: "",
  generated: [] as { id?: string; skin?: string; seed: number }[],
  saved: [] as { id: string; json: string }[],
  onlyOwnMaps: [] as string[],
  maps: [] as { id: string; game: { shortname: string } }[],
  profile: {} as Record<string, unknown>,
  /** The game archives are still being searched for maps they carry. */
  searching: false,
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({
    open: (o: { content: unknown; title: string }) => {
      h.drawerContent = o.content;
      h.drawerTitle = o.title;
    },
    close: vi.fn(),
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
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: {
      games: [
        {
          name: "Cool Game v1",
          info: { shortname: "CG", version: "v1" },
          primaryArchive: { name: "Cool Game v1" },
        },
      ],
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
  useGamePresetParam: () => "Cool Game v1",
}));
vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: null, hubItemId: null }),
}));
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../../play/config", () => {
  const ais = [{ shortName: "NullAI", version: "1", name: "NullAI" }];
  return {
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
    useSkirmishAis: () => ({ ais, loading: false, loaded: true }),
  };
});
vi.mock("../conquests", () => ({
  refreshGalaxies: vi.fn(),
  useGalaxies: () => ({ galaxies: [], loading: false, error: null }),
  useConquestState: () => ({ file: { conquests: {} }, saveFor: vi.fn() }),
}));
vi.mock("../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../profile/profile")>()),
  getProfile: () => h.profile,
}));
vi.mock("../handmade/useHandmadeMaps", () => ({
  refreshHandmadeMaps: vi.fn(),
  useHandmadeMaps: () => ({
    maps: h.maps,
    unreadable: [],
    onlyOwnMaps: h.onlyOwnMaps,
    loading: h.searching,
    savedLoading: false,
    error: null,
  }),
}));
vi.mock("../bindings", () => ({
  conquestDelete: vi.fn(),
  conquestSave: vi.fn(async (args: { id: string; json: string }) => {
    h.saved.push(args);
  }),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));
vi.mock("../useUnlocks", () => {
  const unlocks = {};
  return {
    useConquestUnlocks: () => ({ unlocks, award: vi.fn() }),
    useAwardFinishedConquest: () => {},
  };
});
// The real generator, with every call written down.
vi.mock("../mapStyle", async (orig) => {
  const actual = await orig<typeof import("../mapStyle")>();
  return {
    ...actual,
    generateMap: (...args: Parameters<typeof actual.generateMap>) => {
      const [{ id, skin, seed }] = args;
      h.generated.push({ id, skin, seed });
      return actual.generateMap(...args);
    },
  };
});

import ConquestListPage from "./ConquestListPage";

function openForm() {
  render(
    <MemoryRouter>
      <ConquestListPage />
    </MemoryRouter>,
  );
  cleanup();
  render(<MemoryRouter>{h.drawerContent as ReactNode}</MemoryRouter>);
}

/** The select that offers `value` as one of its choices. */
function selectOffering(value: string): HTMLSelectElement {
  const found = [...document.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.value === value),
  );
  if (!found) throw new Error(`no select offers ${value}`);
  return found;
}

const choose = (select: HTMLSelectElement, value: string) =>
  fireEvent.change(select, { target: { value } });

const optionLabels = (select: HTMLSelectElement) =>
  [...select.options].map((o) => o.textContent);

/** The form's field headings, top to bottom. */
const headings = () =>
  [...document.querySelectorAll("span.font-medium")].map((e) =>
    e.textContent?.trim(),
  );

/** Let the wait before a land preview run out. */
const settle = () => act(() => vi.advanceTimersByTime(1000));

const previewBuilds = () => h.generated.filter((g) => g.id === "preview");

beforeEach(() => {
  h.drawerContent = null;
  h.generated = [];
  h.saved = [];
  h.onlyOwnMaps = [];
  h.maps = [];
  h.profile = {};
  h.searching = false;
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Conquest generate form: order and wording", () => {
  it("says map on the page, the button and the drawer", () => {
    render(
      <MemoryRouter>
        <ConquestListPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        /^Wage a campaign across a map of territory you take one battle at a time\. Win skirmishes/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate a map/ })).toBeTruthy();
    expect(h.drawerTitle).toBe("Generate a map");
    expect(
      screen.getByText(/^No conquest maps yet\. Generate one/),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/galax/i);
  });

  it("puts the map style first and the seed last", () => {
    openForm();
    expect(headings()).toEqual([
      "Map style",
      "Shape",
      "Map size",
      "Opposition",
      "Threat level",
      "Start position",
      "Starting territory",
      "Fog of war",
      "Seed",
      "Preview",
    ]);
    expect(optionLabels(selectOffering("territories"))).toEqual([
      "Galaxy (starfield)",
      "Theatre (flat chart)",
      "Cities (roads across generated land)",
      "Territories (provinces on generated land)",
    ]);
    expect(screen.getByLabelText("Map seed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create map" })).toBeTruthy();
  });

  it("offers real stars and the radius for the Galaxy style only", () => {
    openForm();
    choose(selectOffering("realstars"), "realstars");
    expect(headings()).toContain("Radius from Sol");
    expect(headings()).not.toContain("Map size");

    for (const style of ["theatre", "cities", "territories"]) {
      choose(selectOffering("territories"), style);
      const shape = selectOffering("random");
      expect(optionLabels(shape)).not.toContain(
        "Real stars (the solar neighbourhood)",
      );
      // Leaving Galaxy with real stars chosen puts the shape back.
      expect(shape.value).toBe("random");
      expect(headings()).toContain("Map size");
      expect(headings()).not.toContain("Radius from Sol");

      choose(selectOffering("territories"), "galaxy");
      choose(selectOffering("realstars"), "realstars");
    }
  });

  it("offers land shapes for the land styles and puts a galaxy shape back", () => {
    openForm();
    choose(selectOffering("spiral"), "spiral");
    choose(selectOffering("territories"), "cities");
    const shape = selectOffering("random");
    expect(optionLabels(shape)).toEqual([
      "Surprise me",
      "One continent",
      "Coast",
      "Two continents",
      "Archipelago",
      "Inland sea",
      "Landlocked",
    ]);
    // Spiral is not a land shape, so the shape goes back to the default.
    expect(shape.value).toBe("random");
    // A land shape carries over between the two land styles.
    choose(shape, "archipelago");
    choose(selectOffering("territories"), "territories");
    expect(selectOffering("archipelago").value).toBe("archipelago");
    // And a land shape is not a Theatre shape.
    choose(selectOffering("territories"), "theatre");
    expect(selectOffering("random").value).toBe("random");
    expect(optionLabels(selectOffering("random"))).toContain("Spiral");
  });

  it("counts a map in the chosen style's own locations", () => {
    openForm();
    const cases = [
      ["galaxy", "systems", "system", "jumps"],
      ["theatre", "locations", "location", "moves"],
      ["cities", "cities", "city", "moves"],
      ["territories", "provinces", "province", "moves"],
    ];
    for (const [style, many, one, step] of cases) {
      choose(selectOffering("territories"), style);
      expect(optionLabels(selectOffering("18"))).toContain(
        `Medium (18 ${many})`,
      );
      expect(optionLabels(selectOffering("auto"))).toEqual([
        "Full frontier (default)",
        "Capital only",
        `Capital + 1 ${one}`,
        `Capital + 2 ${many}`,
        `Capital + 3 ${many}`,
      ]);
      expect(
        screen.getByText(
          `Hide ${many} more than two ${step} from your territory.`,
        ),
      ).toBeTruthy();
      expect(
        screen.getByText("The same seed always builds the same map."),
      ).toBeTruthy();
    }
  });
});

describe("Conquest generate form: a game that wants its own maps", () => {
  it("offers no generated style and points at the game's maps", () => {
    h.onlyOwnMaps = ["Cool Game v1"];
    h.maps = [{ id: "m", game: { shortname: "CG" } }];
    openForm();
    expect(
      screen.getByText(
        "Cool Game v1 plays Conquest only on the maps the game carries. Pick one from the Conquest list.",
      ),
    ).toBeTruthy();
    expect(headings()).not.toContain("Map style");
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });

  it("leaves the styles alone when another game asks for it", () => {
    h.onlyOwnMaps = ["Some Other Game v3"];
    openForm();
    expect(optionLabels(selectOffering("galaxy"))).toEqual([
      "Galaxy (starfield)",
      "Theatre (flat chart)",
      "Cities (roads across generated land)",
      "Territories (provinces on generated land)",
    ]);
  });
});

describe("Conquest generate form: before the games are searched", () => {
  it("offers no game until it knows which hide the generated styles", () => {
    h.searching = true;
    openForm();
    expect(
      screen.getByText("Checking which of your games carry their own maps."),
    ).toBeTruthy();
    expect(headings()).not.toContain("Map style");
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
});

describe("Conquest generate form: a profile that wants hand-made maps only", () => {
  const STYLES = [
    "Galaxy (starfield)",
    "Theatre (flat chart)",
    "Cities (roads across generated land)",
    "Territories (provinces on generated land)",
  ];

  it("offers no generated style once the game has a hand-made map", () => {
    h.profile = { onlyOwnMaps: true };
    h.maps = [{ id: "m", game: { shortname: "CG" } }];
    openForm();
    expect(
      screen.getByText(
        "Cool Game v1 plays Conquest only on the maps the game carries. Pick one from the Conquest list.",
      ),
    ).toBeTruthy();
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });

  it("keeps the styles when the game has no hand-made map", () => {
    h.profile = { onlyOwnMaps: true };
    openForm();
    expect(optionLabels(selectOffering("galaxy"))).toEqual(STYLES);
  });

  it("keeps the styles when the only map is for another game", () => {
    h.profile = { onlyOwnMaps: true };
    h.maps = [{ id: "m", game: { shortname: "OTHER" } }];
    openForm();
    expect(optionLabels(selectOffering("galaxy"))).toEqual(STYLES);
  });

  it("changes nothing when the key is absent, false or not a boolean", () => {
    h.maps = [{ id: "m", game: { shortname: "CG" } }];
    for (const profile of [
      {},
      { onlyOwnMaps: false },
      { onlyOwnMaps: "yes" },
    ]) {
      h.profile = profile;
      openForm();
      expect(optionLabels(selectOffering("galaxy"))).toEqual(STYLES);
      cleanup();
    }
  });
});

describe("Conquest generate form: the preview", () => {
  it("draws a galaxy as soon as the form renders", () => {
    openForm();
    const svg = screen.getByRole("img", { name: "Galaxy layout preview" });
    expect(svg.querySelectorAll("circle")).toHaveLength(18);
    expect(svg.querySelectorAll("polygon")).toHaveLength(0);
  });

  it("builds a land preview once the form has been still, not per keystroke", () => {
    openForm();
    choose(selectOffering("territories"), "territories");
    h.generated = [];
    expect(screen.getByRole("status").textContent).toBe(
      "Building the preview…",
    );
    expect(screen.queryByRole("img")).toBeNull();

    // Five digits typed one after another, each inside the wait.
    const seed = screen.getByLabelText("Map seed");
    for (const value of ["4", "42", "424", "4242", "42421"]) {
      fireEvent.change(seed, { target: { value } });
      act(() => vi.advanceTimersByTime(100));
    }
    expect(previewBuilds()).toHaveLength(0);

    settle();
    expect(previewBuilds()).toEqual([
      { id: "preview", skin: "territories", seed: 42421 },
    ]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("draws a Territories map as provinces on its own land", () => {
    openForm();
    choose(selectOffering("territories"), "territories");
    settle();
    const svg = screen.getByRole("img", { name: "Map preview" });
    expect(svg.getAttribute("viewBox")).toBe("0 0 1024 1024");
    // One outline per province, and a marker on each of the three capitals.
    expect(svg.querySelectorAll("polygon")).toHaveLength(18);
    expect(svg.querySelectorAll("circle")).toHaveLength(3);
    // The land is the generator's own picture, at its own size.
    const canvas = document.querySelector("canvas");
    expect(canvas?.getAttribute("width")).toBe("512");
    expect(canvas?.getAttribute("height")).toBe("512");
  });

  it("draws a Cities map as cities and roads, with no outlines", () => {
    openForm();
    choose(selectOffering("territories"), "cities");
    settle();
    const svg = screen.getByRole("img", { name: "Map preview" });
    expect(svg.querySelectorAll("polygon")).toHaveLength(0);
    expect(svg.querySelectorAll("circle")).toHaveLength(18);
    expect(svg.querySelectorAll("line").length).toBeGreaterThan(0);
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("keeps the last land preview up, dimmed, while the next one waits", () => {
    openForm();
    choose(selectOffering("territories"), "territories");
    settle();
    const frame = () =>
      screen.getByRole("img", { name: "Map preview" }).parentElement
        ?.parentElement;
    expect(frame()?.className).not.toContain("opacity-50");

    fireEvent.change(screen.getByLabelText("Map seed"), {
      target: { value: "7" },
    });
    expect(frame()?.className).toContain("opacity-50");
    expect(screen.getByRole("status")).toBeTruthy();

    settle();
    expect(frame()?.className).not.toContain("opacity-50");
  });
});

describe("Conquest generate form: creating a map", () => {
  for (const style of ["galaxy", "theatre", "cities", "territories"]) {
    it(`saves a ${style} map as the map the preview showed`, async () => {
      openForm();
      choose(selectOffering("territories"), style);
      fireEvent.change(screen.getByLabelText("Map seed"), {
        target: { value: "31" },
      });
      settle();
      vi.useRealTimers();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create map" }));
      });

      expect(h.saved).toHaveLength(1);
      const doc = JSON.parse(h.saved[0].json);
      expect(doc.generated.skin).toBe(style);
      expect(doc.generated.seed).toBe(31);
      expect(doc.theme?.skin).toBe(style === "galaxy" ? undefined : style);
      expect(Boolean(doc.terrain)).toBe(
        style === "cities" || style === "territories",
      );
      expect(doc.nodes).toHaveLength(18);
      // Same style and seed as the last preview, under the saved id.
      const created = h.generated.filter((g) => g.id === h.saved[0].id);
      expect(created).toEqual([{ id: h.saved[0].id, skin: style, seed: 31 }]);
      expect(previewBuilds().at(-1)).toEqual({
        id: "preview",
        skin: style,
        seed: 31,
      });
    });
  }
});
