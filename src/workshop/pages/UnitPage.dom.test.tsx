// @vitest-environment happy-dom
/**
 * Drives the unit page under a real DOM, in the mocking shape
 * `GameUnitPage.dom.test.tsx` uses: the unitsync hooks answer with fixed data
 * so the test is about what the page does with a game's units rather than about
 * reading one.
 *
 * What it is here to prove is the loop issue #1271 describes end to end. A
 * field starts inherited, an edit marks it overridden and shows the value it
 * replaced, reset puts it back, and nothing the user only looked at is
 * recorded on the way. The override set itself is checked in
 * `overrides.test.ts`. This checks that the page's own wiring reaches it.
 *
 * Most tests open `/workshop/new?game=`, the editor with no project yet, which
 * is what a unit's encyclopedia page links to for a game nothing has been
 * tweaked in (issue #2696). The first edit starts the project, exactly as the
 * page did when it had a game picker instead of a route.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CustomParamsResult,
  UnitBuildpicsResult,
  UnitDefsResult,
} from "@/content/bindings";
import { LEGO_SCHEMA_VERSION, type LegoProject } from "@/lego/model";

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

const GAME = {
  name: "Test Game",
  primaryArchive: { name: "testgame.sdd", path: "/data/games/testgame.sdd" },
};

/** A second, unrelated game that happens to name a unit the same thing. */
const GAME_2 = {
  name: "Test Game 2",
  primaryArchive: { name: "testgame2.sdd", path: "/data/games/testgame2.sdd" },
};

let mockDefs: UnitDefsResult = {
  units: {},
  weaponDefs: {},
  unitErrors: [],
  errors: [],
  checksum: "abc",
};
let mockStatus = "ready";
/** The curated dataset the page joins for names, keyed by internal def key. */
let mockDataset: {
  name: string;
  fullName?: string;
  buildOptions?: string[];
}[] = [];
/** The game's sides, which the page reads to name a unit's faction. */
let mockSides: { name: string; startUnit: string }[] = [];
/** The build pictures unitsync resolved, null until the read lands (#2692). */
let mockBuildpics: UnitBuildpicsResult | null = null;
/** The game archive's member list, which the asset fields browse (issue #2648).
 *  Empty in most tests, where a field is a plain text box. */
let mockArchiveFiles: { path: string; size: number }[] = [];

vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => ({ selected: SELECTED }),
  useUnitsyncScan: () => ({
    data: { games: [GAME, GAME_2], maps: [] },
    loading: false,
    error: null,
    run: () => {},
  }),
  useUnitsyncUnitDataset: () => ({
    dataset: { units: mockDataset, errors: [] },
    status: "ready",
    reload: () => {},
    loading: false,
  }),
  // Both read by the unit picker the build menu panel adds through, and the
  // first by the panel itself, to say which faction a row belongs to.
  useUnitsyncGameInfo: () => ({ info: { sides: mockSides }, loading: false }),
  useUnitsyncUnitBuildpics: () => mockBuildpics,
  // The archive listing behind the Browse action on an asset field (#2648).
  useUnitsyncArchiveTree: () => ({
    tree: { files: mockArchiveFiles, errors: [] },
    loading: false,
  }),
  // Read by the picker's preview once a file in it is selected.
  useUnitsyncArchiveFile: () => ({ data: null, loading: false }),
  useUnitsyncUnitModel: () => ({ model: null, loading: false, failed: false }),
}));
vi.mock("@/play/config", () => ({ usePreferredTarget: () => ({}) }));

/** The custom parameter consumer index, which most tests leave empty. */
let mockConsumers: CustomParamsResult | null = null;
/**
 * A per-game answer, for the one test that needs `useCustomParams` to switch
 * with the game the same way the real hook does (issue #2664 and #2661
 * composing): empty everywhere else, so every other test's single flat
 * `mockConsumers` still answers for whichever game is open.
 */
let mockConsumersByArchive: Record<string, CustomParamsResult | null> = {};

vi.mock("../config", () => ({
  useUnitDefs: () => ({
    defs: mockDefs,
    status: mockStatus,
    error: null,
    reload: () => {},
    loading: mockStatus === "loading",
  }),
  useCustomParams: (
    _enginePath?: string,
    _dataDir?: string,
    gameArchive?: string,
  ) => ({
    consumers:
      gameArchive && Object.hasOwn(mockConsumersByArchive, gameArchive)
        ? mockConsumersByArchive[gameArchive]
        : mockConsumers,
    loading: false,
  }),
}));

// A plain <select>, the same stand-in `BrowsePage.dom.test.tsx` uses: the real
// picker is a Radix popover with pointer-capture behaviour happy-dom does not
// implement, and the movement class rows below need to drive it.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

/** The lego builder's saved units, which the page reads to find what has been
 *  exported into the open game's folder (issue #2651). */
let mockLegoProjects: LegoProject[] = [];
vi.mock("@/lego/projects", () => ({
  useLegoProjects: () => ({
    projects: mockLegoProjects,
    loading: false,
    error: null,
  }),
}));

const { default: UnitPage } = await import("./UnitPage");
const { PersistentStoreProvider } = await import("@picoframe/frame");
const { installSettingsStorage, memorySettingsStorage } = await import(
  "@/lib/storedSetting"
);
const { PROJECTS_KEY } = await import("../project");
const { resetEditHistory } = await import("../history");
const { readStoredSetting } = await import("@/lib/storedSetting");

/**
 * The settings store the projects are saved in, replaced per test so one test's
 * projects are not another's. Both the frame's `useSetting` and the
 * read-modify-write helpers in `storedSetting.ts` have to see the same one.
 */
let storage = memorySettingsStorage();

const ARMCOM: Record<string, unknown> = {
  name: "armcom",
  humanName: "Commander",
  health: 3000,
  metalCost: 1200,
  canFly: false,
  objectName: "armcom.s3o",
  collisionVolume: { type: "b", scales: [30, 40, 30] },
  weapons: [{ name: "disintegrator" }],
  somethingOnlyThisGameReads: "yes",
};

/**
 * A unit as Beyond All Reason writes it: no `name`, no `humanName` and no
 * `description` anywhere in the def, so the only thing that can name it is the
 * curated dataset.
 */
const ARMAAK: Record<string, unknown> = {
  health: 1000,
  metalcost: 300,
  objectname: "Units/ARMAAK.s3o",
};

/** A factory, which is the only kind of unit a build menu belongs to. */
const ARMLAB: Record<string, unknown> = {
  name: "armlab",
  humanName: "Bot Lab",
  builder: true,
  buildoptions: ["armpw", "armrock", "armham"],
};

function show(
  units: Record<string, Record<string, unknown>> = { armcom: ARMCOM },
  entry = `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armcom`,
  dataset: { name: string; fullName?: string; buildOptions?: string[] }[] = [
    { name: "armcom", fullName: "Commander" },
  ],
  unitErrors: string[] = [],
  /** Every `language/<code>/units.json` the game ships, for one that ships any. */
  language: Record<
    string,
    { names?: Record<string, string>; descriptions?: Record<string, string> }
  > = {},
  /** What unitsync makes of the game's archives, which a project records. */
  checksum = "abc",
) {
  mockDefs = {
    units,
    weaponDefs: {},
    unitErrors,
    errors: [],
    checksum,
    languageText: language,
  };
  mockDataset = dataset;
  return render(
    <PersistentStoreProvider storage={storage}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          {/* The list, which the editor's Projects button and its "no project"
              states link to. Only enough of it to be navigated to. */}
          <Route path="/workshop" element={<p>Tweak projects</p>} />
          <Route path="/workshop/:id" element={<UnitPage />} />
        </Routes>
      </MemoryRouter>
    </PersistentStoreProvider>,
  );
}

/** The editor on a game with no project yet, on `armcom`. */
const openNew = (
  game: string,
  units: Record<string, Record<string, unknown>> = { armcom: ARMCOM },
) => show(units, `/workshop/new?game=${encodeURIComponent(game)}&unit=armcom`);

/**
 * The editor on the project already saved for a game, on `armcom`. Opening a
 * project by its own id is what the list does, and what a link into a project
 * is. There is one project per game in the tests that use this.
 */
const openSaved = (
  game: string,
  units: Record<string, Record<string, unknown>> = { armcom: ARMCOM },
) => {
  const project = saved().find((p) => p.gameName === game);
  if (!project) throw new Error(`nothing saved for ${game}`);
  return show(units, `/workshop/${project.id}?unit=armcom`);
};

/** The health box, which most tests below drive. */
const healthBox = () => screen.getByLabelText("Health") as HTMLInputElement;

/** The saved projects, for a test that has to reopen one by its own id. */
const saved = () =>
  readStoredSetting<{ id: string; name: string; gameName: string }[]>(
    PROJECTS_KEY,
    [],
  );

const type = (input: HTMLInputElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

/**
 * Open the build menu card if it is shut.
 *
 * It starts shut on a builder whose menu the project has not touched (issue
 * #2700), so a test that drives the roster asks for it first. Found by the
 * heading rather than by accessible name, because the card's name carries its
 * summary and every row's remove button says "build menu" too. A no-op when it
 * is already open, so a test can call it after every navigation without
 * tracking which of them remounted the panel.
 */
/** The row of controls that act on the open unit, from the switch in it. */
const unitControls = () =>
  screen.getByLabelText(/^Disable /).closest("div") as HTMLElement;

/**
 * What decides where every control in the unit's row sits, and so what a test
 * of issue #2710's invariant has to pin: press a control and it must still be
 * under the mouse. Reading the rendered position instead would say nothing,
 * because happy-dom lays nothing out and answers 0 for every box.
 *
 * Two halves. `above` is everything laid out ahead of the row inside the header
 * block: the unit's name and key beside it, and any earlier row. A column only
 * moves what is under a change, so that is what can move the row down. `row` is
 * the text of each control in the row, in order, because a row moves what is
 * beside a control that changes width or comes and goes, whichever end the row
 * is anchored to. Neither changing means no control in the row moved.
 */
const rowPlacement = () => {
  const block = screen.getByRole("heading", { level: 2 }).parentElement
    ?.parentElement?.parentElement?.parentElement as HTMLElement;
  const above: string[] = [];
  for (
    let node: Element = unitControls();
    node !== block && node.parentElement;
  ) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node) break;
      above.push(sibling.textContent ?? "");
    }
    node = node.parentElement;
  }
  return {
    above: above.join("|"),
    row: [...unitControls().children].map((c) => c.textContent ?? "").join("|"),
  };
};

const openBuildMenu = () => {
  const trigger = screen
    .getAllByRole("button")
    .find((b) => b.querySelector("h3")?.textContent === "Build menu");
  if (trigger?.getAttribute("data-state") === "closed")
    fireEvent.click(trigger);
};

/**
 * Move a build menu row with the keyboard, which is what the drag handle is for
 * when there is no pointer (issue #2714).
 *
 * The keys are the unit list's own set next door: the arrows one place, Home
 * and End to either end. The whole point of putting them on the handle is that
 * a reorder is reachable without a mouse, so this is the path the tests drive.
 */
const reorder = (handle: RegExp, key: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name: handle }), { key });
};

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
  // Module state, shared by every mount since #2696, so one test's undo stack
  // would otherwise still be there for the next.
  resetEditHistory();
});

afterEach(() => {
  cleanup();
  mockStatus = "ready";
  mockDataset = [];
  mockSides = [];
  mockBuildpics = null;
  mockArchiveFiles = [];
  mockConsumers = null;
  mockConsumersByArchive = {};
  mockLegoProjects = [];
});

describe("UnitPage", () => {
  it("lists the game's units and shows the picked one's fields", () => {
    show();
    expect(screen.getAllByText("Commander").length).toBeGreaterThan(0);
    expect(healthBox().value).toBe("3000");
    expect(screen.getByLabelText("Metal cost")).toHaveProperty("value", "1200");
  });

  /**
   * The defect a screenshot of BAR caught: every row read `armaak` twice, once
   * as the title and once as the key beneath it. BAR writes no name of any kind
   * in a unit def, so the name has to come from the read that can answer for it.
   */
  describe("naming a unit whose def carries no name", () => {
    const entry = `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armaak`;

    it("takes the name from the curated dataset", () => {
      show({ armaak: ARMAAK }, entry, [
        { name: "armaak", fullName: "Archangel" },
      ]);
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "Archangel",
      );
      const row = screen
        .getAllByRole("button")
        .find((b) => b.textContent?.includes("armaak"));
      expect(row?.textContent).toBe("Archangelarmaak");
    });

    it("keeps the internal key on its own line rather than replacing it", () => {
      show({ armaak: ARMAAK }, entry, [
        { name: "armaak", fullName: "Archangel" },
      ]);
      // Both are on screen, and they are not the same line twice.
      expect(screen.getAllByText("armaak").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Archangel").length).toBeGreaterThan(0);
    });

    it("shows the key rather than inventing a name when nothing can name it", () => {
      show({ armaak: ARMAAK }, entry, []);
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "armaak",
      );
    });

    it("does not treat a dataset row that only repeats the key as a name", () => {
      show({ armaak: ARMAAK }, entry, [{ name: "armaak" }]);
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "armaak",
      );
    });

    it("falls back to the def for a game that does write a name there", () => {
      show({ armaak: { ...ARMAAK, humanname: "Archangel" } }, entry, []);
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "Archangel",
      );
    });
  });

  it("asks for a unit before showing any fields", () => {
    show(
      { armcom: ARMCOM },
      `/workshop/new?game=${encodeURIComponent(GAME.name)}`,
    );
    expect(screen.getByText("Pick a unit to see its fields.")).toBeTruthy();
  });

  /** `/workshop/new` with no game names nothing to edit. Since #2696 the way
   *  to pick one is to start a project, which happens on the list. */
  it("sends you to the list when the route names no game", () => {
    show({ armcom: ARMCOM }, "/workshop/new");
    expect(
      screen.getByText(
        "Start a project under Unit tweaks to edit a game's units.",
      ),
    ).toBeTruthy();
  });

  /** A link to a project that has been deleted, or one shared from a machine
   *  that has it and this one does not. Nothing is started in its place. */
  it("says so when the route names a project this machine has not got", () => {
    show({ armcom: ARMCOM }, "/workshop/2f0f5a2e-0000-4000-8000-000000000000");
    expect(
      screen.getByText(/That project is not on this machine/),
    ).toBeTruthy();
    expect(saved()).toEqual([]);
  });

  /** An imported project can name a game nobody here has installed. Its edits
   *  are kept, there is simply nothing to apply them against. */
  it("says when the project's game is not installed", () => {
    show(
      { armcom: ARMCOM },
      "/workshop/new?game=A+Game+Nobody+Has&unit=armcom",
    );
    expect(
      screen.getByText(/A Game Nobody Has is not installed here/),
    ).toBeTruthy();
  });

  it("says it is still reading while the defs load", () => {
    mockStatus = "loading";
    show();
    expect(screen.getByText(/Reading every unit definition/)).toBeTruthy();
  });

  /**
   * Issue #2667. These used to be an amber panel below the two panes, on a page
   * that gives those panes the whole window height, so it never scrolled away.
   * Now it is a button in the header, present in all three states the read can
   * be in for the reason the scenario editor's problems button is (issue #2272).
   */
  describe("the diagnostics button", () => {
    const errors = [
      "could not read units/armcom.lua",
      "unknown key in units/armaak.lua",
    ];

    it("is disabled and says Checking while the defs are still being read", () => {
      mockStatus = "loading";
      show();
      const button = screen.getByRole("button", { name: /Checking/ });
      expect(button.hasAttribute("disabled")).toBe(true);
    });

    it("says No problems, enabled, once the read lands with nothing to report", () => {
      show();
      const button = screen.getByRole("button", { name: /No problems/ });
      expect(button.hasAttribute("disabled")).toBe(false);
    });

    it("counts what unitsync said without putting any of it on the page", async () => {
      show({ armcom: ARMCOM }, undefined, undefined, errors);
      expect(screen.queryByText(errors[0])).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /2 diagnostics/ }));

      expect(await screen.findByText(errors[0])).toBeTruthy();
      expect(screen.getByText(errors[1])).toBeTruthy();
    });

    it("says nothing about a read that has not happened, with no game picked", () => {
      show({ armcom: ARMCOM }, "/workshop/new");
      expect(screen.queryByRole("button", { name: /No problems/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Checking/ })).toBeNull();
    });
  });

  it("groups a field under the heading its section belongs to", () => {
    show();
    expect(screen.getByText("Economy and durability")).toBeTruthy();
    expect(screen.getByText("Movement and sensors")).toBeTruthy();
    expect(screen.getByText("Durability")).toBeTruthy();
  });

  it("shows a key only the game declares as a raw row", () => {
    show();
    expect(screen.getByText("Fields only this game declares")).toBeTruthy();
    expect(screen.getByLabelText("somethingOnlyThisGameReads")).toHaveProperty(
      "value",
      "yes",
    );
  });

  /**
   * Issue #2661. The engine ignores a custom parameter completely, so a row
   * reading `canareaattack: true` says nothing at all on its own. The file that
   * reads it is the whole answer, and the page has to reach the scan for it.
   */
  describe("custom parameters", () => {
    const withParams = () =>
      show({
        armcom: { ...ARMCOM, customParams: { canareaattack: "1" } },
      });

    it("names the one file that reads a parameter", () => {
      mockConsumers = {
        params: {
          canareaattack: {
            sites: [
              {
                file: "luarules/gadgets/unit_areaattack.lua",
                reads: 1,
                writes: 0,
              },
            ],
            files: 1,
          },
        },
        wholeTableFiles: 9,
        filesScanned: 957,
        truncated: false,
        errors: [],
      };
      withParams();
      const custom = screen.getByText("Custom parameters").closest("div");
      expect(custom?.textContent).toContain("Read by");
      expect(custom?.textContent).toContain(
        "luarules/gadgets/unit_areaattack.lua",
      );
    });

    /// A parameter nothing names is not the same as one nothing uses, and the
    /// difference is the files that read the table whole.
    it("says how many files read the table whole when nothing names the key", () => {
      mockConsumers = {
        params: {},
        wholeTableFiles: 9,
        filesScanned: 957,
        truncated: false,
        errors: [],
      };
      withParams();
      const custom = screen.getByText("Custom parameters").closest("div");
      expect(custom?.textContent).toContain(
        "No file in this game names this parameter.",
      );
      expect(custom?.textContent).toContain("9 files read the whole");
    });

    /// The scan runs alongside the defs and the page never waits on it, so a
    /// row before it lands is a row with no note rather than a spinner.
    it("draws the row with no note before the scan lands", () => {
      mockConsumers = null;
      withParams();
      expect(screen.getByLabelText("canareaattack")).toHaveProperty(
        "value",
        "1",
      );
      expect(screen.queryByText(/Read by/)).toBeNull();
    });
  });

  it("marks an edited field, keeps the game's value in view, and resets it", () => {
    show();
    // Inherited: no reset button and nothing counted as changed.
    expect(screen.queryByLabelText(/^Reset Health/)).toBeNull();
    expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();

    type(healthBox(), "5000");

    // Overridden: the user's value, the game's value alongside it, and a count.
    expect(healthBox().value).toBe("5000");
    expect(screen.getByText(/Game value: 3000/)).toBeTruthy();
    expect(screen.getByText("1 change")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/^Reset Health/));

    // Reset: back to the game's value with the override gone, not the game's
    // value written in as the user's.
    expect(healthBox().value).toBe("3000");
    expect(screen.queryByText(/Game value: 3000/)).toBeNull();
    expect(screen.queryByLabelText(/^Reset Health/)).toBeNull();
    expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();
  });

  /**
   * Issue #2650. Renaming a unit and rewriting its tooltip are one control on
   * the page and two different edits underneath, because the two games this was
   * measured against keep those words in different files.
   */
  describe("the name and the description", () => {
    /** A Balanced Annihilation unit: both words are in the def. */
    const AJUNO: Record<string, unknown> = {
      name: "Arm Juno",
      description: "Anti Radar/Jammer/Minefield/ScoutSpam Weapon",
      maxdamage: 2120,
    };
    const ba = (entryUnit = "ajuno") =>
      show(
        { ajuno: AJUNO },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=${entryUnit}`,
        [{ name: "ajuno", fullName: "Arm Juno" }],
      );

    /** A Beyond All Reason unit: neither word is anywhere in the def. */
    const bar = () =>
      show(
        { armaak: ARMAAK },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armaak`,
        [{ name: "armaak", fullName: "Archangel" }],
        [],
        {
          en: {
            names: { armaak: "Archangel" },
            descriptions: { armaak: "Anti-Air Turret" },
          },
        },
      );

    /** The same game with the five translations it actually ships alongside. */
    const barTranslated = () =>
      show(
        { armaak: ARMAAK },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armaak`,
        [{ name: "armaak", fullName: "Archangel" }],
        [],
        {
          en: {
            names: { armaak: "Archangel" },
            descriptions: { armaak: "Anti-Air Turret" },
          },
          de: { names: { armaak: "Erzengel" } },
          es: { names: { armaak: "Arcangel" } },
          fr: { names: { armaak: "Archange" } },
          ru: { names: { armaak: "Arkhangel" } },
          zh: { names: { armaak: "Da Tian Shi" } },
        },
      );

    const nameBox = () => screen.getByLabelText("Name") as HTMLInputElement;
    const descriptionBox = () =>
      screen.getByLabelText("Description") as HTMLInputElement;

    it("shows the def's own words for a game that writes them there", () => {
      ba();
      expect(nameBox().value).toBe("Arm Juno");
      expect(descriptionBox().value).toBe(
        "Anti Radar/Jammer/Minefield/ScoutSpam Weapon",
      );
      expect(screen.getByText(/Kept in the unit definition/)).toBeTruthy();
    });

    it("shows the language file's words for a game that writes them there", () => {
      bar();
      expect(nameBox().value).toBe("Archangel");
      expect(descriptionBox().value).toBe("Anti-Air Turret");
      expect(
        screen.getByText(/Kept in this game's language\/en\/units\.json/),
      ).toBeTruthy();
    });

    /** The rest of the page has to agree, or the list and the heading go on
     *  calling the unit something its owner has renamed. */
    it("renames the unit everywhere on the page, in either game", () => {
      for (const [open, typed] of [
        [ba, "Big Juno"],
        [bar, "Seraph"],
      ] as const) {
        open();
        type(nameBox(), typed);

        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
          typed,
        );
        expect(
          screen
            .getAllByRole("button")
            .some((b) => b.textContent?.includes(typed)),
        ).toBe(true);
        expect(screen.getByText("1 change")).toBeTruthy();
        cleanup();
        // Both halves of the loop use the same game name, and edits are saved
        // now, so the second half would otherwise open the first half's project
        // and count two changes.
        storage = memorySettingsStorage();
        installSettingsStorage(storage);
      }
    });

    it("keeps the inherited words in view and resets to them", () => {
      bar();
      type(descriptionBox(), "Shoots things that fly");

      expect(screen.getByText(/Game value: Anti-Air Turret/)).toBeTruthy();

      fireEvent.click(screen.getByLabelText(/^Reset Description/));

      expect(descriptionBox().value).toBe("Anti-Air Turret");
      expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();
    });

    it("records nothing when the game's own name is typed back in", () => {
      bar();
      type(nameBox(), "Archangel");
      expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();
      expect(screen.queryByLabelText(/^Reset Name/)).toBeNull();
    });

    /**
     * Issue #2672. Beyond All Reason ships a `units.json` for six locales, and
     * a rename made against English alone leaves the other five saying the old
     * thing.
     */
    describe("a game that ships more than one translation", () => {
      const tabs = () => screen.getAllByRole("tab").map((t) => t.textContent);
      // Radix picks a tab on mouse down rather than on click, so a plain click
      // leaves the panel where it was.
      const pick = (code: string) =>
        fireEvent.mouseDown(screen.getByRole("tab", { name: code }));

      it("offers a tab per language, English first", () => {
        barTranslated();
        expect(tabs()).toEqual(["en", "de", "es", "fr", "ru", "zh"]);
      });

      /** A picker with one entry is a control that cannot be used. */
      it("offers no picker for a game that ships one", () => {
        bar();
        expect(screen.queryAllByRole("tab")).toEqual([]);
      });

      it("offers none at all for a game that names its units in the def", () => {
        ba();
        expect(screen.queryAllByRole("tab")).toEqual([]);
      });

      it("shows each language's own words", () => {
        barTranslated();
        pick("de");

        expect(nameBox().value).toBe("Erzengel");
        expect(
          screen.getByText(/Kept in this game's language\/de\/units\.json/),
        ).toBeTruthy();
      });

      /**
       * What the player reads. BAR's i18n module answers in English for a key
       * the chosen locale has no entry for, so an untranslated box shows the
       * English string and says where it came from.
       */
      it("shows the English value where a language says nothing", () => {
        barTranslated();
        pick("de");

        expect(descriptionBox().value).toBe("Anti-Air Turret");
        expect(screen.getByText(/falls back to English/)).toBeTruthy();
      });

      it("keeps one language's rename out of another's", () => {
        barTranslated();
        pick("de");
        type(nameBox(), "Racheengel");

        expect(screen.getByText("1 change")).toBeTruthy();

        pick("en");
        expect(nameBox().value).toBe("Archangel");

        pick("de");
        expect(nameBox().value).toBe("Racheengel");
      });

      /** Two languages of one field are two edits, and each resets on its own. */
      it("counts and resets each language apart", () => {
        barTranslated();
        type(nameBox(), "Seraph");
        pick("de");
        type(nameBox(), "Racheengel");

        expect(screen.getByText("2 changes")).toBeTruthy();

        fireEvent.click(screen.getByLabelText(/^Reset Name/));
        expect(screen.getByText("1 change")).toBeTruthy();
        // Back to the name the game ships in German, not to the English
        // rename: German has an entry of its own, so it never falls back.
        expect(nameBox().value).toBe("Erzengel");
      });
    });

    /** A def home writes an ordinary override, so the per-unit reset and the
     *  unit list mark it the same way they mark a changed number. */
    it("marks the unit in the list whichever store the edit landed in", () => {
      bar();
      type(nameBox(), "Seraph");
      const row = screen
        .getAllByRole("button")
        .find((b) => b.textContent?.includes("armaak"));
      expect(
        within(row as HTMLElement).getByTitle("1 field changed"),
      ).toBeTruthy();

      fireEvent.click(screen.getByText(/Reset 1 change/));
      expect(nameBox().value).toBe("Archangel");
    });

    /** Two boxes for one value is one too many, so the field list stops
     *  offering the keys the panel owns. */
    it("is the only place the page offers a name or a description", () => {
      ba();
      fireEvent.click(screen.getByText("All"));
      expect(screen.getAllByLabelText("Name")).toHaveLength(1);
      expect(screen.getAllByLabelText("Description")).toHaveLength(1);
      expect(screen.queryByLabelText("Human name")).toBeNull();
    });

    /** Nothing is recorded about a unit that was only looked at, which is the
     *  guarantee the whole override set rests on. */
    it("records nothing about a unit that is only opened", () => {
      bar();
      expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();
      expect(
        screen.queryAllByLabelText(/^Reset .* to the inherited value$/),
      ).toHaveLength(0);
    });
  });

  it("records nothing when a field is typed back to the value it already had", () => {
    show();
    type(healthBox(), "3000");
    expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();
    expect(screen.queryByLabelText(/^Reset Health/)).toBeNull();
  });

  it("counts one change per field the user touched, and no others", () => {
    show();
    type(healthBox(), "5000");
    type(screen.getByLabelText("Metal cost") as HTMLInputElement, "1");
    expect(screen.getByText("2 changes")).toBeTruthy();
    // Every other field on the page is still inherited, so only these two have
    // a reset button.
    expect(
      screen.getAllByLabelText(/^Reset .* to the inherited value$/),
    ).toHaveLength(2);
  });

  it("resets every change on a unit at once", () => {
    show();
    type(healthBox(), "5000");
    type(screen.getByLabelText("Metal cost") as HTMLInputElement, "1");
    fireEvent.click(screen.getByText(/Reset 2 changes/));
    expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();
    expect(healthBox().value).toBe("3000");
  });

  it("defaults to the fields the unit declares and offers the rest", () => {
    show();
    const relevant = screen.getByText(/shown, .* hidden/).textContent ?? "";
    const shown = Number(relevant.match(/(\d+) shown/)?.[1]);
    const hidden = Number(relevant.match(/(\d+) hidden/)?.[1]);
    expect(hidden).toBeGreaterThan(shown);

    // A field this unit does not declare is out of the relevant view.
    expect(screen.queryByLabelText("Radar range")).toBeNull();

    fireEvent.click(screen.getByText("All"));
    expect(screen.getByLabelText("Radar range")).toBeTruthy();
    expect(screen.getByText(`${shown + hidden} shown`)).toBeTruthy();
  });

  /**
   * Issue #2710 again, for the other control whose press changes something
   * beside it: the count is a different width in each view, so it sits after
   * the toggle rather than before it or opposite it.
   */
  it("leaves the view toggle where it is when it is pressed", () => {
    show();
    const before = rowPlacement();

    fireEvent.click(screen.getByText("All"));

    expect(rowPlacement()).toEqual(before);
  });

  it("keeps a field the user overrode visible when it goes back to relevant", () => {
    show();
    fireEvent.click(screen.getByText("All"));
    type(screen.getByLabelText("Radar range") as HTMLInputElement, "1000");
    fireEvent.click(screen.getByText("Relevant"));
    expect(screen.getByLabelText("Radar range")).toHaveProperty(
      "value",
      "1000",
    );
    expect(screen.getByText(/Engine default: 0/)).toBeTruthy();
  });

  it("marks in the unit list which units have been changed", () => {
    show({ armcom: ARMCOM, corcom: { ...ARMCOM, humanName: "Other" } });
    type(healthBox(), "5000");
    const row = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("armcom"));
    expect(
      within(row as HTMLElement).getByTitle("1 field changed"),
    ).toBeTruthy();
  });

  /**
   * Issue #2664: an edit is a patch against one game's own unit table, so it
   * must say nothing about another game's unit of the same name. Since #2696
   * that is the routing rather than a picker inside the page: each game's edits
   * are a project of their own, and opening one is opening its game.
   */
  describe("two games", () => {
    it("does not carry an edit from one game onto another game's unit of the same name", () => {
      openNew(GAME.name);
      type(healthBox(), "5000");
      expect(screen.getByText("1 change")).toBeTruthy();
      cleanup();

      openNew(GAME_2.name);
      expect(healthBox().value).toBe("3000");
      expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();
    });

    it("keeps the edit for when the first game's project is opened again", () => {
      openNew(GAME.name);
      type(healthBox(), "5000");
      cleanup();
      openNew(GAME_2.name);
      type(healthBox(), "1234");
      cleanup();

      openSaved(GAME.name);
      expect(healthBox().value).toBe("5000");
      expect(screen.getByText("1 change")).toBeTruthy();
    });

    /**
     * Issues #2664 and #2661 both scope a game's own read out of a flat map,
     * and neither could prove the other on its own: the consumer scan is keyed
     * per game the same way the edits are, so opening the other game's project
     * must move both rather than one lagging behind the other.
     */
    it("reads each project's own game for the custom parameter notes", () => {
      mockConsumersByArchive[GAME.primaryArchive.name] = {
        params: {
          canareaattack: {
            sites: [
              {
                file: "luarules/gadgets/unit_areaattack.lua",
                reads: 1,
                writes: 0,
              },
            ],
            files: 1,
          },
        },
        wholeTableFiles: 9,
        filesScanned: 957,
        truncated: false,
        errors: [],
      };
      mockConsumersByArchive[GAME_2.primaryArchive.name] = {
        params: {},
        wholeTableFiles: 3,
        filesScanned: 200,
        truncated: false,
        errors: [],
      };
      const withParam = {
        armcom: { ...ARMCOM, customParams: { canareaattack: "1" } },
      };
      openNew(GAME.name, withParam);
      type(healthBox(), "5000");
      expect(
        screen.getByText("Custom parameters").closest("div")?.textContent,
      ).toContain("luarules/gadgets/unit_areaattack.lua");
      cleanup();

      openNew(GAME_2.name, withParam);
      expect(healthBox().value).toBe("3000");
      const custom = screen.getByText("Custom parameters").closest("div");
      expect(custom?.textContent).not.toContain(
        "luarules/gadgets/unit_areaattack.lua",
      );
      expect(custom?.textContent).toContain("3 files read the whole");
      cleanup();

      openSaved(GAME.name, withParam);
      expect(healthBox().value).toBe("5000");
      expect(
        screen.getByText("Custom parameters").closest("div")?.textContent,
      ).toContain("luarules/gadgets/unit_areaattack.lua");
    });
  });

  /**
   * Issue #1272: the interesting tweak is a new unit rather than a changed
   * number, and a new unit is a copy of an old one.
   */
  describe("copying a unit", () => {
    const openForm = async () => {
      screen.getByRole("button", { name: /Copy unit/ }).click();
      return (await screen.findByLabelText(
        /Internal name/,
      )) as HTMLInputElement;
    };

    const copy = async (key: string, displayName: string) => {
      const keyBox = await openForm();
      fireEvent.change(keyBox, { target: { value: key } });
      fireEvent.change(screen.getByLabelText(/Name in game/), {
        target: { value: displayName },
      });
      fireEvent.click(
        screen.getByRole("button", { name: /^(Add unit|Replace )/ }),
      );
      await waitFor(() =>
        expect(screen.queryByLabelText(/Internal name/)).toBeNull(),
      );
    };

    const listRow = (key: string) =>
      screen
        .getAllByRole("button")
        .find((b) => b.textContent?.includes(key) && b.tagName === "BUTTON");

    it("adds the copy to the browser and opens it, with the source's values", async () => {
      show();
      await copy("armcom4", "Overlord");

      // Selected, named what it was called, and keyed by its new internal name.
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "Overlord",
      );
      expect(healthBox().value).toBe("3000");
      expect(screen.getByLabelText("Metal cost")).toHaveProperty(
        "value",
        "1200",
      );
      expect(screen.getByText("1 unit added")).toBeTruthy();

      // In the same list as the game's own units, marked as one of ours.
      const row = listRow("armcom4");
      expect(row?.textContent).toContain("Overlord");
      expect(
        within(row as HTMLElement).getByTitle(
          "A unit you added, copied from armcom",
        ),
      ).toBeTruthy();
    });

    it("lets the copy be edited like any other unit", async () => {
      show();
      await copy("armcom4", "Overlord");
      type(healthBox(), "9000");
      expect(healthBox().value).toBe("9000");
      // The value it was copied with is still on screen, said as what it is.
      expect(screen.getByText(/Copied value: 3000/)).toBeTruthy();
      expect(screen.getByText("1 change, 1 unit added")).toBeTruthy();

      // And the unit it came from is untouched.
      fireEvent.click(listRow("armcom") as HTMLElement);
      expect(healthBox().value).toBe("3000");
    });

    /**
     * The property `overrides.test.ts` guards, from the page's end: a copy is a
     * whole definition and must not arrive as an override of every field.
     */
    it("records no changes at all for the copy itself", async () => {
      show();
      await copy("armcom4", "Overlord");
      expect(screen.queryByText(/\d+ changes?/)).toBeNull();
      expect(screen.queryByLabelText(/^Reset .* to the inherited value$/)) //
        .toBeNull();
    });

    /**
     * A copy carries the source's `customParams`, and the scan is keyed on the
     * parameter rather than on the unit, so a copy's parameters have the same
     * answer the original's did. Neither #1272 nor #2661 could test this on its
     * own, since one landed without the other.
     */
    it("keeps a copy's custom parameters one row each, with their notes", async () => {
      mockConsumers = {
        params: {
          canareaattack: {
            sites: [
              {
                file: "luarules/gadgets/unit_areaattack.lua",
                reads: 1,
                writes: 0,
              },
            ],
            files: 1,
          },
        },
        wholeTableFiles: 9,
        filesScanned: 957,
        truncated: false,
        errors: [],
      };
      show({ armcom: { ...ARMCOM, customParams: { canareaattack: "1" } } });
      await copy("armcom4", "Overlord");

      // On the copy, not on the unit it came from.
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "Overlord",
      );
      expect(screen.getByLabelText("canareaattack")).toHaveProperty(
        "value",
        "1",
      );
      const custom = screen.getByText("Custom parameters").closest("div");
      expect(custom?.textContent).toContain(
        "luarules/gadgets/unit_areaattack.lua",
      );
    });

    it("copies the unit as the project has it, edits included", async () => {
      show();
      type(healthBox(), "5000");
      await copy("armcom4", "Overlord");
      expect(healthBox().value).toBe("5000");
      // One change, against the game's armcom, and one unit added. The copy's
      // own 5000 is part of what it is rather than an edit to it.
      expect(screen.getByText("1 change, 1 unit added")).toBeTruthy();
    });

    it("says when a name would replace one of the game's units, before it does", async () => {
      show();
      const keyBox = await openForm();
      fireEvent.change(keyBox, { target: { value: "armcom" } });
      expect(screen.getByText(/is already the game's/).textContent).toContain(
        "Commander",
      );
      expect(
        screen.getByRole("button", { name: "Replace armcom" }),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Add unit" })).toBeNull();

      // And says the other thing for a name nothing is using.
      fireEvent.change(keyBox, { target: { value: "armcom4" } });
      expect(screen.getByText(/Adds armcom4 as a new unit/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add unit" })).toBeTruthy();
    });

    it("refuses a name one of your own copies already has", async () => {
      show();
      await copy("armcom4", "Overlord");
      const keyBox = await openForm();
      fireEvent.change(keyBox, { target: { value: "armcom4" } });
      expect(
        screen.getByText(/You have already added a unit called armcom4/),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add unit" })).toHaveProperty(
        "disabled",
        true,
      );
    });

    /**
     * A replacement is named by the person who made it, not by the game's own
     * name for the unit it stands in for. Beyond All Reason names no unit in
     * its defs, so that name comes from the curated dataset, and it must not
     * reach a unit the dataset has never seen.
     */
    it("names a replacement from what it was given", async () => {
      show({ armaak: ARMAAK }, `/workshop/new?game=${GAME.name}&unit=armaak`, [
        { name: "armaak", fullName: "Archangel" },
      ]);
      await copy("armaak", "Archangel II");
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "Archangel II",
      );
      const row = listRow("armaak");
      expect(row?.textContent).toContain("Archangel II");
      expect(
        within(row as HTMLElement).getByTitle(
          "Your copy of armaak, standing in for the game's own",
        ),
      ).toBeTruthy();
      // One unit in the list, not the game's and yours side by side.
      expect(screen.getByText("1 unit")).toBeTruthy();
    });

    it("takes one back out again", async () => {
      show();
      await copy("armcom4", "Overlord");
      fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
      const confirm = await waitFor(() => {
        const [, inPopover] = screen.getAllByRole("button", {
          name: /^Delete$/,
        });
        if (!inPopover) throw new Error("no delete confirmation");
        return inPopover;
      });
      fireEvent.click(confirm);
      await waitFor(() => expect(listRow("armcom4")).toBeUndefined());
      expect(screen.queryByText(/unit added/)).toBeNull();
      expect(screen.getByText("Pick a unit to see its fields.")).toBeTruthy();
    });
  });

  /**
   * Issue #1274: a unit nothing can build is not in the game, so the roster of
   * what a factory offers is where a mod is actually made. This drives the panel
   * end to end, because the interesting part is the wiring: an edit here has to
   * reach the build menu store and stay out of the override set.
   */
  describe("editing a build menu", () => {
    const entry = `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armlab`;
    const DATASET = [
      { name: "armcom", fullName: "Commander", buildOptions: ["armlab"] },
      { name: "armlab", fullName: "Bot Lab", buildOptions: ["armpw"] },
      { name: "armpw", fullName: "Peewee" },
      { name: "armrock", fullName: "Rocko" },
      { name: "armham", fullName: "Hammer" },
      { name: "corcom", fullName: "Core Commander", buildOptions: ["corak"] },
      { name: "corak", fullName: "The Can" },
    ];
    const SIDES = [
      { name: "Arm", startUnit: "armcom" },
      { name: "Core", startUnit: "corcom" },
    ];

    const openLab = () => {
      mockSides = SIDES;
      const rendered = show({ armlab: ARMLAB, armcom: ARMCOM }, entry, DATASET);
      openBuildMenu();
      return rendered;
    };

    /**
     * Pick a unit out of the add picker's popover.
     *
     * Scoped to the popover on purpose: the browser on the left of the page
     * lists every unit too, so a name looked up across the whole document
     * finds two buttons and neither of them is the one being pressed.
     */
    const addFromPicker = async (name: RegExp) => {
      openBuildMenu();
      fireEvent.click(
        screen.getByRole("button", { name: /Add a unit to this menu/ }),
      );
      const popover = await waitFor(() => {
        const found = document.querySelector('[data-slot="popover-content"]');
        if (!found) throw new Error("the picker did not open");
        return found as HTMLElement;
      });
      fireEvent.click(within(popover).getByRole("button", { name }));
    };

    /** The build menu's rows, in the order they are drawn. */
    const rows = () =>
      screen
        .getAllByRole("listitem")
        .filter((li) => li.querySelector("button[aria-label^='Reorder ']"))
        .map((li) => li.textContent ?? "");

    it("shows the builder's list in the order the game declares it", () => {
      openLab();
      expect(rows().map((r) => r.replace(/\D+/g, "").slice(0, 1))).toEqual([
        "1",
        "2",
        "3",
      ]);
      expect(rows()[0]).toContain("Peewee");
      expect(rows()[1]).toContain("Rocko");
      expect(rows()[2]).toContain("Hammer");
    });

    /**
     * The raw JSON row this used to be. `buildoptions` has an editor of its own
     * now, and two ways to read the same list is one too many.
     */
    it("draws no raw buildoptions field alongside the roster", () => {
      openLab();
      expect(screen.queryByText("buildoptions")).toBeNull();
    });

    it("reorders from the keyboard, one place per press", () => {
      openLab();
      reorder(/^Reorder Peewee/, "ArrowDown");
      expect(rows()[0]).toContain("Rocko");
      expect(rows()[1]).toContain("Peewee");
      reorder(/^Reorder Hammer/, "ArrowUp");
      expect(rows()[1]).toContain("Hammer");
      expect(rows()[2]).toContain("Peewee");
    });

    it("sends a row to either end with Home and End", () => {
      openLab();
      reorder(/^Reorder Hammer/, "Home");
      expect(rows()[0]).toContain("Hammer");
      reorder(/^Reorder Hammer/, "End");
      expect(rows()[2]).toContain("Hammer");
    });

    /** The row at the end of the list has nowhere further to go, and a press
     *  that does nothing must not leave a no-op operation behind. */
    it("records nothing for a press at the end of the list", () => {
      openLab();
      reorder(/^Reorder Peewee/, "ArrowUp");
      reorder(/^Reorder Hammer/, "ArrowDown");
      expect(rows()[0]).toContain("Peewee");
      expect(rows()[2]).toContain("Hammer");
      expect(screen.queryByText(/build menu edit/)).toBeNull();
    });

    /**
     * The handle's other half. A drag ends as one anchored move, exactly like a
     * key press, so this drives the pointer path end to end and checks the row
     * landed where it was dropped.
     */
    it("reorders by dragging a row past another", () => {
      openLab();
      const handle = screen.getByRole("button", { name: /^Reorder Peewee/ });
      const list = handle.closest("ol") as HTMLOListElement;
      // happy-dom lays nothing out, so every row measures as a zero-height box
      // at the origin. The rows are given heights of their own here, which is
      // what the panel measures when the drag starts.
      list.querySelectorAll("li").forEach((row, i) => {
        row.getBoundingClientRect = () =>
          ({ top: i * 40, bottom: i * 40 + 40 }) as DOMRect;
      });
      fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });
      // Past the middle of the third row, so Peewee lands last.
      fireEvent.pointerMove(list, { pointerId: 1, clientY: 110 });
      expect(rows()[2]).toContain("Peewee");
      fireEvent.pointerUp(list, { pointerId: 1 });
      expect(rows()[2]).toContain("Peewee");
      expect(screen.getByText("1 build menu edit")).toBeTruthy();
    });

    /** A drag let go where it started is not an edit. */
    it("records nothing for a drag that lands where it started", () => {
      openLab();
      const handle = screen.getByRole("button", { name: /^Reorder Peewee/ });
      const list = handle.closest("ol") as HTMLOListElement;
      list.querySelectorAll("li").forEach((row, i) => {
        row.getBoundingClientRect = () =>
          ({ top: i * 40, bottom: i * 40 + 40 }) as DOMRect;
      });
      fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });
      fireEvent.pointerMove(list, { pointerId: 1, clientY: 5 });
      fireEvent.pointerUp(list, { pointerId: 1 });
      expect(rows()[0]).toContain("Peewee");
      expect(screen.queryByText(/build menu edit/)).toBeNull();
    });

    it("takes a unit off the menu and offers it back", () => {
      openLab();
      fireEvent.click(
        screen.getByLabelText("Remove Rocko from this build menu"),
      );
      expect(rows()).toHaveLength(2);
      expect(rows().join(" ")).not.toContain("Rocko");
      // Not gone from the game, and not disabled: it is offered back.
      const back = screen.getByTitle("Put Rocko back on this menu");
      fireEvent.click(back);
      expect(rows()).toHaveLength(3);
    });

    /**
     * The single most common real edit: give one side another side's unit. The
     * picker covers the whole game rather than this builder's own faction, and
     * the row that lands says which faction it came from.
     */
    it("adds another faction's unit and says whose it is", async () => {
      openLab();
      await addFromPicker(/The Can/);
      await waitFor(() => expect(rows()).toHaveLength(4));
      expect(rows()[3]).toContain("The Can");
      expect(rows()[3]).toContain("Core");
      expect(rows()[3]).toContain("added");
    });

    /** The join between #1272 and #1274: a copy is only a unit once something
     *  can build it. */
    it("adds a unit the project copied", async () => {
      openLab();
      screen.getByRole("button", { name: /Copy unit/ }).click();
      const keyBox = (await screen.findByLabelText(
        /Internal name/,
      )) as HTMLInputElement;
      fireEvent.change(keyBox, { target: { value: "armlab2" } });
      fireEvent.change(screen.getByLabelText(/Name in game/), {
        target: { value: "Bot Lab II" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Add unit/ }));
      await waitFor(() =>
        expect(screen.queryByLabelText(/Internal name/)).toBeNull(),
      );

      // The copy is open now, so go back to the lab and put the copy on it.
      fireEvent.click(
        screen.getAllByRole("button").find((b) => {
          const text = b.textContent ?? "";
          return text.includes("armlab") && !text.includes("armlab2");
        }) as HTMLElement,
      );
      await addFromPicker(/Bot Lab II/);
      await waitFor(() =>
        expect(rows().some((r) => r.includes("armlab2"))).toBe(true),
      );
      expect(rows().find((r) => r.includes("armlab2"))).toContain("yours");
    });

    /**
     * The point of holding these apart from the overrides. A build menu edit is
     * a change to a list the game still owns, so it is counted as one and it
     * writes nothing into the sparse override set the field rows read.
     */
    it("is counted as a build menu edit, not as a field change", () => {
      openLab();
      reorder(/^Reorder Peewee/, "ArrowDown");
      expect(screen.getByText("1 build menu edit")).toBeTruthy();
      expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();
      // The per-unit override reset is what the override set drives, and it is
      // still absent after a reorder.
      expect(screen.queryByRole("button", { name: /Reset \d+ change/ })).toBe(
        null,
      );
    });

    it("puts the menu back with one press", () => {
      openLab();
      fireEvent.click(
        screen.getByLabelText("Remove Rocko from this build menu"),
      );
      fireEvent.click(screen.getByRole("button", { name: /Reset menu/ }));
      expect(rows()).toHaveLength(3);
      expect(screen.queryByText(/build menu edit/)).toBeNull();
    });

    it("shows no build menu for a unit that builds nothing", () => {
      show();
      expect(screen.queryByText("Build menu")).toBeNull();
    });

    /**
     * Issue #2714. A roster with `builder` off is drawn by us and ignored by
     * the engine, and the four fields that default from `builder` mean the unit
     * has lost repair and reclaim with it. The panel says so and offers to put
     * it right, which is the one edit here that touches the unit's own def.
     */
    describe("a builder whose builder field is off", () => {
      const DEAD = { ...ARMLAB, builder: false };
      const openDead = () => {
        mockSides = SIDES;
        show({ armlab: DEAD, armcom: ARMCOM }, entry, DATASET);
        openBuildMenu();
      };

      it("says the menu will not reach the game, and what else went with it", () => {
        openDead();
        expect(
          screen.getByText(
            /cannot build, so none of this menu reaches the game/,
          ),
        ).toBeTruthy();
        const warning = screen.getByRole("alert");
        for (const field of [
          "canAssist",
          "canReclaim",
          "canRepair",
          "canRestore",
        ])
          expect(warning.textContent).toContain(field);
      });

      it("says nothing on a builder whose flag is on", () => {
        openLab();
        expect(screen.queryByRole("alert")).toBeNull();
      });

      it("switches the field back on and puts the warning away", () => {
        openDead();
        fireEvent.click(
          screen.getByRole("button", { name: /Switch builder on/ }),
        );
        expect(screen.queryByRole("alert")).toBeNull();
      });

      /** It is an edit to the def, so it counts as one. Writing it into the
       *  menu store would be the conflation this panel exists to avoid. */
      it("counts as a field change rather than as a build menu edit", () => {
        openDead();
        fireEvent.click(
          screen.getByRole("button", { name: /Switch builder on/ }),
        );
        expect(screen.queryByText(/build menu edit/)).toBeNull();
        expect(screen.getByText("1 change")).toBeTruthy();
      });
    });

    /** Otherwise the only way back to your own work is to remember where it
     *  was, which is the argument the browser's other marks were added on. */
    it("marks the builder in the browser", () => {
      openLab();
      const row = () =>
        screen
          .getAllByRole("button")
          .find((b) => b.textContent?.includes("armlab"));
      expect(row()?.textContent).not.toContain("menu");
      reorder(/^Reorder Peewee/, "ArrowDown");
      expect(row()?.textContent).toContain("menu");
    });
  });

  /**
   * Issue #2692. A person picking one unit out of Beyond All Reason's 564
   * recognises the picture long before the name, and the name on its own does
   * not even identify it there: four units are called "Advanced Aircraft
   * Plant", one per side.
   */
  describe("build pictures and factions", () => {
    const UNITS = {
      armcom: ARMCOM,
      armlab: ARMLAB,
      armpw: {
        name: "armpw",
        humanName: "Peewee",
        health: 100,
        buildpic: "ARMPW.DDS",
      },
      corcom: { name: "corcom", humanName: "Core Commander" },
      corak: { name: "corak", humanName: "The Can" },
      /** In the game's defs and on nobody's build menu, so no side reaches it. */
      armflea: { name: "armflea", humanName: "Flea" },
      /**
       * A builder no side reaches, which Beyond All Reason really has: neither
       * commander builds the underwater Advanced Aircraft Plants. Its own menu
       * spans both sides, so it is the case issue #2699 is about.
       */
      armhaapuw: {
        name: "armhaapuw",
        humanName: "Advanced Aircraft Plant",
        builder: true,
        buildoptions: ["armpw", "corak"],
      },
    };
    const DATASET = [
      { name: "armcom", fullName: "Commander", buildOptions: ["armlab"] },
      { name: "armlab", fullName: "Bot Lab", buildOptions: ["armpw"] },
      { name: "armpw", fullName: "Peewee" },
      { name: "corcom", fullName: "Core Commander", buildOptions: ["corak"] },
      { name: "corak", fullName: "The Can" },
      { name: "armflea", fullName: "Flea" },
      {
        name: "armhaapuw",
        fullName: "Advanced Aircraft Plant",
        buildOptions: ["armpw", "corak"],
      },
    ];
    const SIDES = [
      { name: "Arm", startUnit: "armcom" },
      { name: "Core", startUnit: "corcom" },
    ];
    const PEEWEE_PIC = "data:image/png;base64,peewee";

    const open = (unit = "armlab") => {
      mockBuildpics = {
        units: {
          armpw: { icon: PEEWEE_PIC },
          armlab: { icon: "data:image/png;base64,botlab" },
          corak: { iconSkipped: "no-source" },
        },
        errors: [],
      };
      return show(
        UNITS,
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=${unit}`,
        DATASET,
      );
    };

    /** One row of the left-hand list, by the key printed under its name. */
    const listRow = (key: string) =>
      screen
        .getAllByRole("button")
        .find((b) =>
          [...b.querySelectorAll("span")].some((s) => s.textContent === key),
        );

    it("draws each unit's build picture beside its name", () => {
      mockSides = SIDES;
      open();
      expect(listRow("armpw")?.querySelector("img")?.getAttribute("src")).toBe(
        PEEWEE_PIC,
      );
    });

    /**
     * The same answer `UnitPicker` has always given, out of the one component
     * that draws a build pic anywhere in coilbox: a box the size of the picture
     * saying which of "the game ships none" and "coilbox could not read it"
     * happened, so a half-empty list still lines up and still says why.
     */
    it("says so in the picture's place when the game ships none", () => {
      mockSides = SIDES;
      open();
      const row = listRow("corak");
      expect(row?.querySelector("img")).toBeNull();
      expect(row?.textContent).toContain("no pic");
    });

    it("claims nothing about a picture the read has not answered for yet", () => {
      mockSides = SIDES;
      show(
        UNITS,
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armlab`,
        DATASET,
      );
      const row = listRow("armpw");
      expect(row?.querySelector("img")).toBeNull();
      expect(row?.textContent).not.toContain("no pic");
    });

    /** The side leads the second line and the key follows it, so the row still
     *  carries the thing the rest of coilbox joins on. */
    it("names the side the game's build graph reaches each unit from", () => {
      mockSides = SIDES;
      open();
      expect(listRow("armpw")?.textContent).toBe("PeeweeArm·armpw");
      expect(listRow("corak")?.textContent).toBe("no picThe CanCore·corak");
    });

    /** Saying "Arm" on all of a one-sided game's rows tells nobody anything. */
    it("says nothing about a side for a game that declares one", () => {
      mockSides = [{ name: "Arm", startUnit: "armcom" }];
      open();
      expect(listRow("armpw")?.textContent).toBe("Peeweearmpw");
    });

    /** A unit no side's build graph reaches is one the game has no opinion
     *  about, so the row says nothing rather than guessing. */
    it("says nothing about a side for a unit no side builds", () => {
      mockSides = SIDES;
      open();
      expect(listRow("armflea")?.textContent).toBe("no picFleaarmflea");
    });

    /**
     * Issue #2699. The badge means "this row's unit is not on the builder's own
     * side", and a builder with no side of its own cannot make that comparison.
     * Marking every row instead says exactly as much as marking none of them,
     * and it hides the one thing the badge is for. So an unknown own side means
     * "cannot say" and nothing is badged.
     */
    it("badges nothing on a builder no side's build graph reaches", () => {
      mockSides = SIDES;
      open("armhaapuw");
      openBuildMenu();
      const menu = screen
        .getAllByRole("listitem")
        .filter((li) => li.querySelector("button[aria-label^='Reorder ']"));
      // Both rows are drawn: one Arm unit and one Core unit, on a menu whose
      // builder is neither.
      expect(menu).toHaveLength(2);
      expect(menu[0].textContent).toContain("Peewee");
      expect(menu[1].textContent).toContain("The Can");
      const badges = menu.flatMap((li) =>
        [...li.querySelectorAll("span")]
          .map((s) => s.textContent)
          .filter((text) => text === "Arm" || text === "Core"),
      );
      expect(badges).toEqual([]);
    });

    it("draws the pictures in a builder's roster too", () => {
      mockSides = SIDES;
      open();
      openBuildMenu();
      const row = screen
        .getAllByRole("listitem")
        .filter((li) => li.querySelector("button[aria-label^='Reorder ']"))
        .find((li) => li.textContent?.includes("Peewee"));
      expect(row?.querySelector("img")?.getAttribute("src")).toBe(PEEWEE_PIC);
    });

    /** A copy is in no archive, so unitsync has never heard of it. It carries
     *  its source's `buildpic` and draws that picture in the game, so it draws
     *  it here (`unitPics.ts`). */
    it("gives a copy the picture of the unit it was copied from", async () => {
      mockSides = SIDES;
      open("armpw");
      screen.getByRole("button", { name: /Copy unit/ }).click();
      const keyBox = (await screen.findByLabelText(
        /Internal name/,
      )) as HTMLInputElement;
      fireEvent.change(keyBox, { target: { value: "armpw2" } });
      fireEvent.change(screen.getByLabelText(/Name in game/), {
        target: { value: "Peewee II" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Add unit/ }));
      await waitFor(() => expect(listRow("armpw2")).toBeDefined());
      // The copy carries `armpw`'s `buildpic`, so that is the picture it will
      // draw in the game.
      expect(listRow("armpw2")?.querySelector("img")?.getAttribute("src")).toBe(
        PEEWEE_PIC,
      );
    });
  });

  /**
   * Issue #2649. Taking a unit out of one factory's list is a roster change and
   * taking it out of the game is not, so the two have separate controls, say
   * different things, and above all keep separate stores: the mark must write
   * nothing into the overrides, the copies or the build menu operations, or
   * switching a unit back on could not restore its placements exactly.
   */
  describe("switching a unit off", () => {
    const PEEWEE: Record<string, unknown> = {
      name: "armpw",
      humanName: "Peewee",
      health: 100,
    };
    const UNITS = { armcom: ARMCOM, armlab: ARMLAB, armpw: PEEWEE };
    const DATASET = [
      { name: "armcom", fullName: "Commander", buildOptions: ["armlab"] },
      { name: "armlab", fullName: "Bot Lab", buildOptions: ["armpw"] },
      { name: "armpw", fullName: "Peewee" },
      { name: "armrock", fullName: "Rocko" },
      { name: "armham", fullName: "Hammer" },
    ];

    const openAt = (unit: string) =>
      show(
        UNITS,
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=${unit}`,
        DATASET,
      );

    /**
     * A row in the browser on the left, found by the internal key printed under
     * the name. By key rather than by text, because a copy called `armcom2`
     * contains `armcom` and the two rows are both on screen at once.
     */
    const browserRow = (key: string) =>
      screen
        .getAllByRole("button")
        .find(
          (b) => b.querySelector("span.font-mono")?.textContent === key,
        ) as HTMLElement;

    /** The build menu's rows, in the order they are drawn. */
    const rows = () =>
      screen
        .getAllByRole("listitem")
        .filter((li) => li.querySelector("button[aria-label^='Reorder ']"))
        .map((li) => li.textContent ?? "");

    /** Whether the open unit's switch is on. Read off the attribute, because
     *  happy-dom does not reflect it onto the element as a property. */
    const isOff = (name: string) =>
      screen.getByLabelText(`Disable ${name}`).getAttribute("aria-checked") ===
      "true";

    it("switches a unit off and says what that will do", () => {
      openAt("armcom");
      expect(screen.queryByText(/unit disabled/)).toBeNull();

      fireEvent.click(screen.getByLabelText("Disable Commander"));

      expect(screen.getByText("1 unit disabled")).toBeTruthy();
      expect(
        screen.getByText(/comes off every build menu when this is compiled/),
      ).toBeTruthy();
    });

    /**
     * Issue #2710. The note used to go under the unit's internal name, in the
     * left half of a row the controls shared, so switching a unit off widened
     * that half, wrapped the controls onto a line of their own and left the
     * switch somewhere else. It goes below the controls now, which is the only
     * place it can appear without moving them.
     */
    it("leaves the switch where it is when it is pressed", () => {
      openAt("armcom");
      const toggle = () => screen.getByLabelText("Disable Commander");
      const before = rowPlacement();

      fireEvent.click(toggle());

      expect(rowPlacement()).toEqual(before);
      // And the note the press added is below it rather than above.
      const note = screen.getByText(
        /comes off every build menu when this is compiled/,
      );
      expect(
        toggle().compareDocumentPosition(note) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("switches it back on again, leaving nothing behind", () => {
      openAt("armcom");
      const toggle = () => screen.getByLabelText("Disable Commander");
      fireEvent.click(toggle());
      fireEvent.click(toggle());
      expect(screen.queryByText(/unit disabled/)).toBeNull();
      expect(
        screen.queryByText(/comes off every build menu when this is compiled/),
      ).toBeNull();
    });

    it("keeps the mark when another unit is picked and then this one again", () => {
      openAt("armcom");
      fireEvent.click(screen.getByLabelText("Disable Commander"));

      fireEvent.click(browserRow("armlab"));
      expect(isOff("Bot Lab")).toBe(false);

      fireEvent.click(browserRow("armcom"));
      expect(isOff("Commander")).toBe(true);
      expect(screen.getByText("1 unit disabled")).toBeTruthy();
    });

    /** The rule #2664 set for the overrides, which holds for this too: the
     *  mark names a unit in one game's table and says nothing about another. */
    it("does not carry the mark onto another game's unit of the same name", () => {
      openAt("armcom");
      fireEvent.click(screen.getByLabelText("Disable Commander"));
      cleanup();

      openNew(GAME_2.name, UNITS);
      expect(isOff("Commander")).toBe(false);
      expect(screen.queryByText(/unit disabled/)).toBeNull();
      cleanup();

      openSaved(GAME.name, UNITS);
      expect(isOff("Commander")).toBe(true);
    });

    /**
     * The whole point of the issue on screen: a disabled unit keeps its row and
     * its place in the order, marked, rather than vanishing into the list of
     * units somebody took off this menu on purpose.
     */
    it("shows a disabled unit in its place on the menu, not as one taken off", () => {
      mockSides = [];
      openAt("armpw");
      fireEvent.click(screen.getByLabelText("Disable Peewee"));
      fireEvent.click(browserRow("armlab"));
      openBuildMenu();

      expect(rows()).toHaveLength(3);
      expect(rows()[0]).toContain("Peewee");
      expect(rows()[0]).toContain("disabled");
      expect(rows()[1]).not.toContain("disabled");
      // Which is not the same thing as being taken off this menu, and the panel
      // must not offer to put back a unit nobody removed.
      expect(screen.queryByText(/Taken off this menu/)).toBeNull();
      expect(screen.getByText("3 units, in order, 1 disabled")).toBeTruthy();
    });

    /** It is not a menu edit, so it is not counted as one either. */
    it("is not counted as a build menu edit", () => {
      mockSides = [];
      openAt("armpw");
      fireEvent.click(screen.getByLabelText("Disable Peewee"));
      expect(screen.queryByText(/build menu edit/)).toBeNull();
    });

    /**
     * The guarantee the issue turns on, driven through the page rather than
     * over the stores: a project with a change of every other kind in it is
     * untouched by the switch, and comes back exactly as it was.
     */
    it("writes nothing into the changes, the copies or the build menus", async () => {
      mockSides = [];
      openAt("armcom");

      // A field change.
      type(healthBox(), "5000");
      // A copy.
      fireEvent.click(screen.getByRole("button", { name: /Copy unit/ }));
      fireEvent.change(await screen.findByLabelText(/Internal name/), {
        target: { value: "armcom2" },
      });
      fireEvent.change(screen.getByLabelText(/Name in game/), {
        target: { value: "Commander II" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Add unit/ }));
      await waitFor(() =>
        expect(screen.queryByLabelText(/Internal name/)).toBeNull(),
      );
      // A build menu edit.
      fireEvent.click(browserRow("armlab"));
      openBuildMenu();
      reorder(/^Reorder Peewee/, "ArrowDown");

      const SUMMARY = "1 change, 1 unit added, 1 build menu edit";
      expect(screen.getByText(SUMMARY)).toBeTruthy();
      const before = rows();

      fireEvent.click(screen.getByLabelText("Disable Bot Lab"));
      expect(screen.getByText(`${SUMMARY}, 1 unit disabled`)).toBeTruthy();
      expect(rows()).toEqual(before);

      fireEvent.click(screen.getByLabelText("Disable Bot Lab"));
      expect(screen.getByText(SUMMARY)).toBeTruthy();
      expect(rows()).toEqual(before);
      // And the copy and the field change are still exactly where they were.
      expect(browserRow("armcom2")).toBeTruthy();
      fireEvent.click(browserRow("armcom"));
      expect(healthBox().value).toBe("5000");
    });

    /** Design decision, stated in the code: the mark blocks nothing, because it
     *  is reversible and blocking would only mean switching on and off again. */
    it("still lets a disabled unit be edited and copied", () => {
      openAt("armcom");
      fireEvent.click(screen.getByLabelText("Disable Commander"));
      type(healthBox(), "5000");
      expect(healthBox().value).toBe("5000");
      expect(screen.getByText("1 change, 1 unit disabled")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Copy unit/ })).toHaveProperty(
        "disabled",
        false,
      );
    });

    it("marks a disabled unit in the browser", () => {
      openAt("armcom");
      expect(browserRow("armcom").textContent).not.toContain("off");
      fireEvent.click(screen.getByLabelText("Disable Commander"));
      expect(
        within(browserRow("armcom")).getByTitle(/^Disabled:/),
      ).toBeTruthy();
    });
  });

  /**
   * Issue #1282. The edits used to live in this component and die with it.
   * They now go into a saved project as they are made, so the page has to be
   * closable, and undo has to reach back over them.
   */
  describe("saving and undoing", () => {
    const units = { armcom: ARMCOM, armlab: ARMLAB };
    const dataset = [
      { name: "armcom", fullName: "Commander" },
      { name: "armlab", fullName: "Bot Lab" },
    ];
    const openAt = (unit: string, checksum = "abc") =>
      show(
        units,
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=${unit}`,
        dataset,
        [],
        {},
        checksum,
      );

    /** A row in the unit browser, found by the internal name it shows. */
    const browserRow = (key: string) =>
      screen
        .getAllByRole("button")
        .find(
          (b) => b.querySelector("span.font-mono")?.textContent === key,
        ) as HTMLElement;

    /**
     * The rule #2696 kept: someone who followed "Edit in Unit tweaks" from a
     * unit's page has chosen a unit and not a project, so looking at it leaves
     * nothing behind and the first edit is what starts the project.
     */
    it("starts a project on the first edit and says which one", () => {
      openAt("armcom");
      expect(saved()).toEqual([]);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Unit tweaks",
      );

      type(healthBox(), "5000");

      expect(saved()).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        `${GAME.name} tweaks`,
      );
    });

    /** And the URL becomes the project's own, so reloading or sharing the page
     *  lands back in what was started rather than starting a second one. */
    it("moves the page onto the project it started", () => {
      openAt("armcom");
      type(healthBox(), "5000");
      cleanup();

      openSaved(GAME.name, units);
      expect(healthBox().value).toBe("5000");
      expect(screen.getByText("1 change")).toBeTruthy();
    });

    it("still has the edits after the page is closed and reopened", () => {
      openAt("armcom");
      type(healthBox(), "5000");
      fireEvent.click(screen.getByLabelText("Disable Commander"));
      cleanup();

      // The same storage, a brand new page: what reopening the app and picking
      // the project off the list does.
      openSaved(GAME.name, units);
      expect(healthBox().value).toBe("5000");
      expect(screen.getByText("1 change, 1 unit disabled")).toBeTruthy();
      expect(screen.getByLabelText("Disable Commander")).toHaveProperty(
        "dataset.state",
        "checked",
      );
    });

    it("undoes and redoes the last change", () => {
      openAt("armcom");
      expect(screen.getByLabelText("Undo")).toHaveProperty("disabled", true);

      type(healthBox(), "5000");
      expect(screen.getByLabelText("Undo")).toHaveProperty("disabled", false);

      fireEvent.click(screen.getByLabelText("Undo"));
      expect(healthBox().value).toBe("3000");
      expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();

      fireEvent.click(screen.getByLabelText("Redo"));
      expect(healthBox().value).toBe("5000");
      expect(screen.getByText("1 change")).toBeTruthy();
    });

    it("walks back through several changes, in order", () => {
      openAt("armcom");
      type(healthBox(), "5000");
      fireEvent.click(screen.getByLabelText("Disable Commander"));
      expect(screen.getByText("1 change, 1 unit disabled")).toBeTruthy();

      fireEvent.click(screen.getByLabelText("Undo"));
      expect(screen.getByText("1 change")).toBeTruthy();
      expect(healthBox().value).toBe("5000");

      fireEvent.click(screen.getByLabelText("Undo"));
      expect(screen.queryByText(/^\d+ changes?/)).toBeNull();
      expect(healthBox().value).toBe("3000");
      expect(screen.getByLabelText("Undo")).toHaveProperty("disabled", true);
    });

    /** One press, whatever it took to make the change. Four stores are cleared
     *  when a copy is deleted, and all four have to come back together. */
    it("brings a deleted copy back with its own edits", async () => {
      openAt("armcom");
      fireEvent.click(screen.getByRole("button", { name: /Copy unit/ }));
      fireEvent.change(await screen.findByLabelText(/Internal name/), {
        target: { value: "armcom2" },
      });
      fireEvent.change(screen.getByLabelText(/Name in game/), {
        target: { value: "Commander II" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Add unit/ }));
      await waitFor(() =>
        expect(screen.queryByLabelText(/Internal name/)).toBeNull(),
      );
      type(healthBox(), "9000");
      fireEvent.click(screen.getByLabelText("Disable Commander II"));
      expect(screen.getByText("1 change, 1 unit added, 1 unit disabled"));

      fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
      const confirm = await waitFor(() => {
        const [, inPopover] = screen.getAllByRole("button", {
          name: /^Delete$/,
        });
        if (!inPopover) throw new Error("no delete confirmation");
        return inPopover;
      });
      fireEvent.click(confirm);
      await waitFor(() => expect(screen.queryByText(/unit added/)).toBeNull());

      fireEvent.click(screen.getByLabelText("Undo"));
      expect(
        screen.getByText("1 change, 1 unit added, 1 unit disabled"),
      ).toBeTruthy();
      fireEvent.click(browserRow("armcom2"));
      expect(healthBox().value).toBe("9000");
      expect(screen.getByLabelText("Disable Commander II")).toHaveProperty(
        "dataset.state",
        "checked",
      );
    });

    /**
     * Issue #2664 again, from the project's side: a game's project is its own
     * and so is its history. Since #2696 the history has to survive the editor
     * being unmounted for that to hold, which is why the stacks live in the
     * module rather than in the page (`history.ts`).
     */
    it("keeps two games' projects and undo stacks apart", () => {
      openNew(GAME.name, units);
      type(healthBox(), "5000");
      cleanup();

      openNew(GAME_2.name, units);
      expect(healthBox().value).toBe("3000");
      expect(screen.getByLabelText("Undo")).toHaveProperty("disabled", true);
      type(healthBox(), "1234");
      fireEvent.click(screen.getByLabelText("Undo"));
      expect(healthBox().value).toBe("3000");
      cleanup();

      openSaved(GAME.name, units);
      // The first game's edit is untouched by anything done in the second, and
      // its own undo step is still there.
      expect(healthBox().value).toBe("5000");
      expect(screen.getByLabelText("Undo")).toHaveProperty("disabled", false);
    });

    /** The checksum a project records is a fact about what it was written
     *  against. Which edits an update actually broke is issue #1281. */
    it("says when the game has changed since the project was started", () => {
      openAt("armcom");
      type(healthBox(), "5000");
      cleanup();

      const project = saved().find((p) => p.gameName === GAME.name);
      show(
        units,
        `/workshop/${project?.id}?unit=armcom`,
        dataset,
        [],
        {},
        "moved on",
      );
      expect(
        screen.getByText(new RegExp(`${GAME.name} has changed`)),
      ).toBeTruthy();
    });

    /**
     * A project started from the list names a game nobody had read, so it has
     * no checksum to compare against. The first open that can read the game
     * fills it in rather than leaving #1281 with nothing to work from.
     */
    it("records what the game checksummed to for a project started without one", () => {
      const project = {
        id: "2f0f5a2e-0000-4000-8000-000000000000",
        name: "Started from the list",
        gameName: GAME.name,
        edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      storage.set(PROJECTS_KEY, JSON.stringify([project]));

      show(units, `/workshop/${project.id}?unit=armcom`, dataset);

      expect(saved()[0]).toHaveProperty("authoredChecksum", "abc");
      // Not an edit to the project, so it does not restamp when it changed.
      expect(saved()[0]).toHaveProperty("updatedAt", project.updatedAt);
      expect(screen.queryByText(/has changed since/)).toBeNull();
    });
  });

  /**
   * Renaming from inside the editor (issue #2711). Until this the only way was
   * to go back to the list and find the card, which is the wrong way round: you
   * find out a name is wrong while you are working under it.
   *
   * What is worth proving is that it reaches the store rather than only the
   * heading, because the list and the breadcrumb read the store and a rename
   * that only redrew this page would look right and be lost.
   */
  describe("renaming the open project", () => {
    const units = { armcom: ARMCOM };

    /** Open the drawer from the header, which is the only way in. */
    const openRename = () =>
      fireEvent.click(screen.getByRole("button", { name: /Rename/ }));

    it("offers nothing to rename before the first edit has started one", () => {
      openNew(GAME.name, units);
      expect(screen.queryByRole("button", { name: /Rename/ })).toBeNull();
    });

    it("writes the new name to the heading and to the store", async () => {
      openNew(GAME.name, units);
      type(healthBox(), "5000");
      expect(saved()[0].name).toBe(`${GAME.name} tweaks`);

      openRename();
      fireEvent.change(await screen.findByLabelText("Project name"), {
        target: { value: "Slower tanks" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(saved()[0].name).toBe("Slower tanks");
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Slower tanks",
      );
    });

    it("changes what the project says it is for at the same time", async () => {
      openNew(GAME.name, units);
      type(healthBox(), "5000");

      openRename();
      fireEvent.change(
        await screen.findByLabelText("What the project is for"),
        {
          target: { value: "Everything on tracks costs more." },
        },
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(saved()[0]).toMatchObject({
        name: `${GAME.name} tweaks`,
        description: "Everything on tracks costs more.",
      });
    });

    /** The game is the one thing a rename may not touch: every edit in the
     *  project is a patch against this game's own units (issue #2664). */
    it("shows the game it is against and does not offer to change it", async () => {
      openNew(GAME.name, units);
      type(healthBox(), "5000");

      openRename();
      expect(await screen.findByText(GAME.name)).toBeTruthy();
      expect(screen.queryByLabelText("Game for the new project")).toBeNull();
    });

    /** Renaming is not an edit, so it costs no undo step and does not change
     *  what the header says is in the project. */
    it("leaves the edits and the undo stack alone", async () => {
      openNew(GAME.name, units);
      type(healthBox(), "5000");

      openRename();
      fireEvent.change(await screen.findByLabelText("Project name"), {
        target: { value: "Slower tanks" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByText("1 change")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(healthBox().value).toBe("3000");
      expect(saved()[0].name).toBe("Slower tanks");
    });
  });

  /**
   * Picking a file instead of typing a path (issue #2648). The point of these is
   * the wiring: that a lowercased def key still finds the note describing it,
   * that the picker offers the archive's real members, and that taking one
   * writes an ordinary override which resets like any other.
   */
  describe("picking an asset out of the game's archive", () => {
    const ARCHIVE = [
      { path: "objects3d/Units/ARMAAK.s3o", size: 2048 },
      { path: "objects3d/Units/ARMAAP.s3o", size: 4096 },
      { path: "scripts/Units/ARMAAK.cob", size: 512 },
      { path: "unitpics/ARMAAK.DDS", size: 256 },
      { path: "gamedata/icontypes.lua", size: 64 },
    ];

    const openArmaak = () => {
      mockArchiveFiles = ARCHIVE;
      show(
        { armaak: ARMAAK },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armaak`,
        [{ name: "armaak", fullName: "Anti-Air Turret" }],
      );
    };

    const modelBox = () => screen.getByLabelText("Model") as HTMLInputElement;

    it("offers Browse on a model field and not on a field that is not a path", () => {
      openArmaak();
      expect(screen.getByLabelText("Browse for Model")).toBeTruthy();
      expect(screen.queryByLabelText("Browse for Health")).toBeNull();
    });

    it("offers nothing while the archive listing has not landed", () => {
      mockArchiveFiles = [];
      show(
        { armaak: ARMAAK },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armaak`,
        [{ name: "armaak", fullName: "Anti-Air Turret" }],
      );
      expect(screen.queryByLabelText("Browse for Model")).toBeNull();
    });

    it("lists the archive's models, named as the definition would write them", async () => {
      openArmaak();
      fireEvent.click(screen.getByLabelText("Browse for Model"));
      const drawer = await screen.findByRole("dialog");
      // Relative to objects3d/, which is what the engine reads the field under,
      // and only the models: the script and the picture are other fields.
      expect(within(drawer).getByText("Units/ARMAAP.s3o")).toBeTruthy();
      expect(within(drawer).queryByText(/ARMAAK\.cob/)).toBeNull();
      expect(within(drawer).queryByText(/ARMAAK\.DDS/)).toBeNull();
    });

    it("writes the picked file as an ordinary override that resets", async () => {
      openArmaak();
      expect(modelBox().value).toBe("Units/ARMAAK.s3o");

      fireEvent.click(screen.getByLabelText("Browse for Model"));
      const drawer = await screen.findByRole("dialog");
      fireEvent.click(within(drawer).getByText("Units/ARMAAP.s3o"));
      fireEvent.click(within(drawer).getByRole("button", { name: /Use this/ }));

      await waitFor(() => expect(modelBox().value).toBe("Units/ARMAAP.s3o"));
      expect(screen.getByText("1 change")).toBeTruthy();

      fireEvent.click(screen.getByLabelText(/^Reset Model/));
      expect(modelBox().value).toBe("Units/ARMAAK.s3o");
      expect(screen.queryByText("1 change")).toBeNull();
    });

    /** The typo the issue is about, said beside the field rather than left for
     *  the game to refuse the unit over. */
    it("says when a value points at nothing in the archive", async () => {
      openArmaak();
      expect(screen.queryByText(/has no model at this path/)).toBeNull();
      type(modelBox(), "Units/ARMAAQ.s3o");
      await waitFor(() =>
        expect(
          screen.getByText(/Test Game has no model at this path/),
        ).toBeTruthy(),
      );
    });
  });

  /**
   * Issue #2651, and the answer #663 closed without. A unit built in the lego
   * builder and exported into a game folder is a definition the game will read
   * and nothing could build, because no part of coilbox looked at the folder
   * afterwards. This is that look: the unit turns up in the list, edits through
   * the ordinary field rows, and goes on a factory's menu through the ordinary
   * build menu editor.
   */
  describe("a unit built in the lego builder", () => {
    /** The definition `legoUnitDef` writes, as the export receipt holds it. */
    const SKYFORT: Record<string, unknown> = {
      name: "Sky Fortress",
      description: "Sky Fortress, built with coilbox's unit builder.",
      objectname: "skyfort",
      script: "skyfort.lua",
      footprintx: 4,
      footprintz: 4,
      maxdamage: 1000,
      canmove: false,
    };

    function legoProject(over: Partial<LegoProject> = {}): LegoProject {
      return {
        schemaVersion: LEGO_SCHEMA_VERSION,
        id: "proj-1",
        name: "Sky Fortress",
        unitName: "skyfort",
        packId: "lego",
        packVersion: "1",
        createdAt: "",
        updatedAt: "",
        rootPieceId: "root",
        pieces: [],
        exported: {
          dir: GAME.primaryArchive.path,
          at: "2026-09-07T12:00:00.000Z",
          unitName: "skyfort",
          files: [],
          def: SKYFORT,
        },
        ...over,
      };
    }

    const openBuilt = (projects: LegoProject[] = [legoProject()]) => {
      mockLegoProjects = projects;
      return show(
        { armcom: ARMCOM },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=skyfort`,
        [{ name: "armcom", fullName: "Commander" }],
      );
    };

    it("appears in the game's unit list", () => {
      openBuilt();
      expect(screen.getAllByText("Sky Fortress").length).toBeGreaterThan(0);
      expect(screen.getByText("1 built unit")).toBeTruthy();
    });

    it("says which project built it rather than a unit it was copied from", () => {
      openBuilt();
      expect(
        screen.getByText(
          /Built in the unit builder as Sky Fortress and exported into Test Game/,
        ),
      ).toBeTruthy();
    });

    it("edits through the ordinary field rows", () => {
      openBuilt();
      // The builder writes the Total Annihilation spelling of health, which is
      // the field the page draws for it.
      const health = screen.getByLabelText(
        "Health (old name)",
      ) as HTMLInputElement;
      expect(health.value).toBe("1000");
      type(health, "4000");
      expect(health.value).toBe("4000");
      expect(screen.getAllByText(/1 change/).length).toBeGreaterThan(0);
      // Against the definition the export wrote, not against the game.
      expect(screen.getByText(/Exported value: 1000/)).toBeTruthy();
    });

    /**
     * A built unit is already a file in the game folder, so it is not work this
     * page is holding and it is not an edit anybody made here. Since #1282 that
     * has a sharper consequence than a banner: nothing about it may reach the
     * saved project, or the project would claim work the user never did and go
     * stale the moment the file is edited by hand.
     */
    it("is not counted as a change to the project", () => {
      openBuilt();
      expect(screen.getByText("1 built unit")).toBeTruthy();
      expect(screen.queryByText(/unit added/)).toBeNull();
      expect(screen.queryByText(/\d+ changes?/)).toBeNull();
    });

    it("starts no project, so undo has nothing to take back", () => {
      openBuilt();
      expect(screen.queryByText(/^Saving to/)).toBeNull();
      expect(screen.getByLabelText("Undo")).toHaveProperty("disabled", true);
      expect(screen.getByLabelText("Redo")).toHaveProperty("disabled", true);
      expect(storage.get(PROJECTS_KEY)).toBeNull();
    });

    /** The project holds the units copied on this page and nothing else, so
     *  editing a built unit saves the edit without adopting the unit. */
    it("keeps the built unit out of a project an edit does start", () => {
      openBuilt();
      type(
        screen.getByLabelText("Health (old name)") as HTMLInputElement,
        "4321",
      );

      const projects = JSON.parse(storage.get(PROJECTS_KEY) ?? "[]");
      expect(projects).toHaveLength(1);
      expect(projects[0].edits.clones).toEqual({});
      expect(projects[0].edits.overrides).toEqual({
        skyfort: { maxdamage: 4321 },
      });
      // One step, and it is the field. Undoing does not remove the unit.
      fireEvent.click(screen.getByLabelText("Undo"));
      expect(screen.getAllByText("Sky Fortress").length).toBeGreaterThan(0);
      expect(screen.getByText("1 built unit")).toBeTruthy();
      expect(screen.getByLabelText("Undo")).toHaveProperty("disabled", true);
    });

    it("cannot be deleted from here, since the file is the builder's", () => {
      openBuilt();
      expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    });

    it("stays out of a game it was not exported into", () => {
      mockLegoProjects = [legoProject()];
      show(
        { armcom: ARMCOM },
        `/workshop/new?game=${encodeURIComponent(GAME_2.name)}&unit=armcom`,
        [{ name: "armcom", fullName: "Commander" }],
      );
      expect(screen.queryByText("Sky Fortress")).toBeNull();
    });

    /**
     * The usual case once the game's read catches up. `units/<name>.lua` is a
     * file in the game, so the engine reads it and the def table already has
     * the unit. It is still attributed, and the definition on the page is the
     * game's own, because the export writes that file once and then leaves it
     * alone for hand editing.
     */
    it("attributes a unit the game's own read already has", () => {
      mockLegoProjects = [legoProject()];
      show(
        { armcom: ARMCOM, skyfort: { ...SKYFORT, maxdamage: 9000 } },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=skyfort`,
        [{ name: "armcom", fullName: "Commander" }],
      );
      expect(
        screen.getByText(
          /Built in the unit builder as Sky Fortress and exported into Test Game/,
        ),
      ).toBeTruthy();
      expect(
        (screen.getByLabelText("Health (old name)") as HTMLInputElement).value,
      ).toBe("9000");
      // It is the game's unit, not one this page put up, so nothing calls it a
      // copy and nothing offers to delete it.
      expect(screen.queryByText(/copied from/)).toBeNull();
      expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    });

    /**
     * The export never overwrites a `units/<name>.lua` that is already there,
     * so a name the game uses leaves the game's own definition in place. The
     * page must show that definition rather than the one the export generated.
     */
    it("does not stand its definition in front of the game's own", () => {
      mockLegoProjects = [
        legoProject({
          exported: {
            dir: GAME.primaryArchive.path,
            at: "",
            unitName: "armcom",
            files: [],
            def: SKYFORT,
          },
        }),
      ];
      show(
        { armcom: ARMCOM },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armcom`,
        [{ name: "armcom", fullName: "Commander" }],
      );
      expect((healthBox() as HTMLInputElement).value).toBe("3000");
      expect(screen.queryByText(/in place of the game's own/)).toBeNull();
    });

    it("goes on a factory's build menu like any other unit", async () => {
      mockLegoProjects = [legoProject()];
      mockSides = [{ name: "Arm", startUnit: "armcom" }];
      show(
        { armlab: ARMLAB, armcom: ARMCOM },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armlab`,
        [
          { name: "armcom", fullName: "Commander", buildOptions: ["armlab"] },
          { name: "armlab", fullName: "Bot Lab", buildOptions: ["armpw"] },
          { name: "armpw", fullName: "Peewee" },
          { name: "armrock", fullName: "Rocko" },
          { name: "armham", fullName: "Hammer" },
        ],
      );

      openBuildMenu();
      fireEvent.click(
        screen.getByRole("button", { name: /Add a unit to this menu/ }),
      );
      const popover = await waitFor(() => {
        const found = document.querySelector('[data-slot="popover-content"]');
        if (!found) throw new Error("the picker did not open");
        return found as HTMLElement;
      });
      fireEvent.click(
        within(popover).getByRole("button", { name: /Sky Fortress/ }),
      );

      expect(screen.getByText(/1 build menu edit/)).toBeTruthy();
      expect(
        screen.getByLabelText("Remove Sky Fortress from this build menu"),
      ).toBeTruthy();
    });
  });

  /**
   * Issue #2651's other half. A movement class names an entry in the game's own
   * move definitions, so it is picked out of what this game's units already
   * move on rather than typed against a file nobody has open.
   */
  describe("the movement class", () => {
    /**
     * Keyed the way Balanced Annihilation writes them, all lower case, which
     * is not how the engine's registry spells the same field. The two must
     * resolve to one row reading the game's own value: keying this picker off
     * the registry's spelling drew an empty box over a unit that had a class.
     */
    const GROUND: Record<string, Record<string, unknown>> = {
      armcom: ARMCOM,
      armpw: { name: "armpw", canmove: true, movementclass: "ARMCOMKBOT" },
      armstump: { name: "armstump", canmove: true, movementclass: "TANKSMALL" },
      armrock: { name: "armrock", canmove: true, movementclass: "ARMCOMKBOT" },
    };

    const openPeewee = () =>
      show(
        GROUND,
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armpw`,
        [{ name: "armpw", fullName: "Peewee" }],
      );

    it("is picked from the classes this game's units move on", () => {
      openPeewee();
      const picker = screen.getByLabelText(
        "Movement class",
      ) as HTMLSelectElement;
      expect([...picker.options].map((o) => o.value)).toEqual([
        "ARMCOMKBOT",
        "TANKSMALL",
      ]);
      expect(picker.value).toBe("ARMCOMKBOT");
    });

    it("writes a pick as an ordinary override that resets", () => {
      openPeewee();
      const picker = screen.getByLabelText(
        "Movement class",
      ) as HTMLSelectElement;
      fireEvent.change(picker, { target: { value: "TANKSMALL" } });
      expect(screen.getByText("1 change")).toBeTruthy();

      fireEvent.click(screen.getByLabelText(/^Reset Movement class/));
      expect(
        (screen.getByLabelText("Movement class") as HTMLSelectElement).value,
      ).toBe("ARMCOMKBOT");
      expect(screen.queryByText("1 change")).toBeNull();
    });

    /**
     * The failure #663 recorded, said where the class is picked instead of
     * leaving the user with a unit that is silently not in the game.
     */
    it("says nothing about a unit whose two halves agree", () => {
      openPeewee();
      expect(screen.queryByText(/drops it at load/)).toBeNull();
      expect(screen.queryByText(/no effect until Can move is on/)).toBeNull();
    });

    it("warns that a moving unit with no class is dropped at load", () => {
      show(
        { ...GROUND, armflea: { name: "armflea", canMove: true } },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armflea`,
        [{ name: "armflea", fullName: "Flea" }],
      );
      expect(screen.getByText(/drops it at load/)).toBeTruthy();
    });

    /** The quieter half: a class nothing will ever read. */
    it("warns that a class on a unit that does not move has no effect", () => {
      show(
        { ...GROUND, armtl: { name: "armtl", movementClass: "TANKSMALL" } },
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=armtl`,
        [{ name: "armtl", fullName: "Torpedo Launcher" }],
      );
      expect(screen.getByText(/no effect until Can move is on/)).toBeTruthy();
    });

    /**
     * A built unit is why this matters. It arrives static, because the builder
     * has no game to name a class out of, and picking one here is the edit that
     * turns it into a unit somebody can drive (issues #663 and #2651).
     */
    it("is the field a built unit arrives without", () => {
      mockLegoProjects = [
        {
          schemaVersion: LEGO_SCHEMA_VERSION,
          id: "proj-1",
          name: "Sky Fortress",
          unitName: "skyfort",
          packId: "lego",
          packVersion: "1",
          createdAt: "",
          updatedAt: "",
          rootPieceId: "root",
          pieces: [],
          exported: {
            dir: GAME.primaryArchive.path,
            at: "",
            unitName: "skyfort",
            files: [],
            def: { name: "Sky Fortress", maxdamage: 1000, canmove: false },
          },
        },
      ];
      show(
        GROUND,
        `/workshop/new?game=${encodeURIComponent(GAME.name)}&unit=skyfort`,
        [{ name: "armpw", fullName: "Peewee" }],
      );

      // The definition names no class, so without this the relevant view would
      // hide the row and the fix with it.
      const picker = screen.getByLabelText(
        "Movement class",
      ) as HTMLSelectElement;
      expect([...picker.options].map((o) => o.value)).toEqual([
        "ARMCOMKBOT",
        "TANKSMALL",
      ]);

      fireEvent.change(picker, { target: { value: "TANKSMALL" } });
      expect(screen.getByText(/no effect until Can move is on/)).toBeTruthy();
      fireEvent.click(screen.getByLabelText("Can move"));
      expect(screen.queryByText(/no effect until Can move is on/)).toBeNull();
      expect(screen.queryByText(/drops it at load/)).toBeNull();
    });
  });
});
