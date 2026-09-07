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
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomParamsResult, UnitDefsResult } from "@/content/bindings";

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

const GAME = {
  name: "Test Game",
  primaryArchive: { name: "testgame.sdd" },
};

/** A second, unrelated game that happens to name a unit the same thing. */
const GAME_2 = {
  name: "Test Game 2",
  primaryArchive: { name: "testgame2.sdd" },
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
/** The game's sides, which the build menu panel reads to name a faction. */
let mockSides: { name: string; startUnit: string }[] = [];

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
  useUnitsyncUnitBuildpics: () => null,
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
// implement, and switching games is the one test here that needs to drive it.
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

const { default: UnitPage } = await import("./UnitPage");

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
  entry = `/workshop?game=${encodeURIComponent(GAME.name)}&unit=armcom`,
  dataset: { name: string; fullName?: string; buildOptions?: string[] }[] = [
    { name: "armcom", fullName: "Commander" },
  ],
) {
  mockDefs = {
    units,
    weaponDefs: {},
    unitErrors: [],
    errors: [],
    checksum: "abc",
  };
  mockDataset = dataset;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/workshop" element={<UnitPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The health box, which most tests below drive. */
const healthBox = () => screen.getByLabelText("Health") as HTMLInputElement;

const type = (input: HTMLInputElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

afterEach(() => {
  cleanup();
  mockStatus = "ready";
  mockDataset = [];
  mockSides = [];
  mockConsumers = null;
  mockConsumersByArchive = {};
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
    const entry = `/workshop?game=${encodeURIComponent(GAME.name)}&unit=armaak`;

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
    show({ armcom: ARMCOM }, `/workshop?game=${encodeURIComponent(GAME.name)}`);
    expect(screen.getByText("Pick a unit to see its fields.")).toBeTruthy();
  });

  it("asks for a game before showing any units", () => {
    show({ armcom: ARMCOM }, "/workshop");
    expect(screen.getByText("Pick a game to see its units.")).toBeTruthy();
  });

  it("says it is still reading while the defs load", () => {
    mockStatus = "loading";
    show();
    expect(screen.getByText(/Reading every unit definition/)).toBeTruthy();
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
   * must say nothing about another game's unit of the same name, even though
   * both games are open in the same page across the switch.
   */
  describe("switching games", () => {
    it("does not carry an edit from one game onto another game's unit of the same name", () => {
      show();
      type(healthBox(), "5000");
      expect(screen.getByText("1 change")).toBeTruthy();

      fireEvent.change(screen.getByLabelText("Game"), {
        target: { value: GAME_2.name },
      });
      fireEvent.click(
        screen
          .getAllByRole("button")
          .find((b) => b.textContent?.includes("armcom")) as HTMLElement,
      );

      expect(healthBox().value).toBe("3000");
      expect(screen.queryByText(/^\d+ changes?$/)).toBeNull();
    });

    it("keeps the edit for when the first game is picked again", () => {
      show();
      type(healthBox(), "5000");

      fireEvent.change(screen.getByLabelText("Game"), {
        target: { value: GAME_2.name },
      });
      fireEvent.change(screen.getByLabelText("Game"), {
        target: { value: GAME.name },
      });
      fireEvent.click(
        screen
          .getAllByRole("button")
          .find((b) => b.textContent?.includes("armcom")) as HTMLElement,
      );

      expect(healthBox().value).toBe("5000");
      expect(screen.getByText("1 change")).toBeTruthy();
    });

    /**
     * Issues #2664 and #2661 both scope a game's own read out of a flat map,
     * and neither could prove the other switches correctly on its own: the
     * consumer scan is keyed per game the same way overrides now are, so an
     * edit and a consumer note must change together rather than one lagging
     * behind the other.
     */
    it("switches the custom parameter rows and their consumer notes with the game", () => {
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
      show({ armcom: { ...ARMCOM, customParams: { canareaattack: "1" } } });
      type(healthBox(), "5000");
      expect(
        screen.getByText("Custom parameters").closest("div")?.textContent,
      ).toContain("luarules/gadgets/unit_areaattack.lua");

      fireEvent.change(screen.getByLabelText("Game"), {
        target: { value: GAME_2.name },
      });
      fireEvent.click(
        screen
          .getAllByRole("button")
          .find((b) => b.textContent?.includes("armcom")) as HTMLElement,
      );

      expect(healthBox().value).toBe("3000");
      const custom = screen.getByText("Custom parameters").closest("div");
      expect(custom?.textContent).not.toContain(
        "luarules/gadgets/unit_areaattack.lua",
      );
      expect(custom?.textContent).toContain("3 files read the whole");

      fireEvent.change(screen.getByLabelText("Game"), {
        target: { value: GAME.name },
      });
      fireEvent.click(
        screen
          .getAllByRole("button")
          .find((b) => b.textContent?.includes("armcom")) as HTMLElement,
      );

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
      show({ armaak: ARMAAK }, `/workshop?game=${GAME.name}&unit=armaak`, [
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
    const entry = `/workshop?game=${encodeURIComponent(GAME.name)}&unit=armlab`;
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
      return show({ armlab: ARMLAB, armcom: ARMCOM }, entry, DATASET);
    };

    /**
     * Pick a unit out of the add picker's popover.
     *
     * Scoped to the popover on purpose: the browser on the left of the page
     * lists every unit too, so a name looked up across the whole document
     * finds two buttons and neither of them is the one being pressed.
     */
    const addFromPicker = async (name: RegExp) => {
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
        .filter((li) => li.querySelector("button[aria-label^='Move ']"))
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

    it("reorders with the arrow buttons", () => {
      openLab();
      fireEvent.click(screen.getByLabelText("Move Peewee down"));
      expect(rows()[0]).toContain("Rocko");
      expect(rows()[1]).toContain("Peewee");
      fireEvent.click(screen.getByLabelText("Move Hammer up"));
      expect(rows()[1]).toContain("Hammer");
      expect(rows()[2]).toContain("Peewee");
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
      fireEvent.click(screen.getByLabelText("Move Peewee down"));
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
  });
});
