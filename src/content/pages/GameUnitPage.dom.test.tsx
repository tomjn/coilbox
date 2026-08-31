// @vitest-environment happy-dom
/**
 * Drives `GameUnitPage` under a real DOM, following the mocking shape
 * `GameUnitsPage.dom.test.tsx` uses: the unitsync hooks are mocked so the test
 * exercises the rendered page rather than a real scan. `useUnitsyncUnitModel`
 * is mocked too, because `UnitHero` calls it directly (via the page).
 *
 * `useUnitRenders` is mocked at the hook boundary rather than at the bindings
 * it calls: its own cache-then-draw wiring, including "asks about all four
 * angles" and "a cached render is not redrawn", is `useUnitRenders.test.tsx`'s
 * job, run against real WebGL/IPC stand-ins. Mocking it here keeps this file
 * about what the page does with whatever the hook reports, not about the hook
 * itself.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnitDatasetEntry } from "../bindings";

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

const GAME_NAME = "Test Game";

let mockUnits: UnitDatasetEntry[] = [];
let mockModelPending = false;
let mockRenders: Record<
  string,
  { angle: string; status: string; url?: string; message?: string }
> = {};
const mockIconSrc = "mock-icon-src";
// A def key the buildpics mock deliberately resolves nothing for, so a test
// can render a unit with no build picture without the mock's own blanket
// "every id gets an icon" behaviour hiding that case.
const mockNoIconId = "unpicturedtarget";
const ANGLE_LABELS: Record<string, string> = {
  top: "Top down",
  front: "Front",
  side: "Side",
  angled: "Angled",
};

vi.mock("./components/useUnitRenders", () => ({
  useUnitRenders: () => mockRenders,
  angleLabel: (angle: string) => ANGLE_LABELS[angle] ?? angle,
}));

vi.mock("../config", () => ({
  useScanTargetSelection: () => ({ selected: SELECTED }),
  useUnitsyncScan: () => ({
    data: {
      games: [
        {
          name: GAME_NAME,
          primaryArchive: { name: "test.sdz" },
          dependencyArchives: [],
          info: {},
        },
      ],
      maps: [],
      errors: [],
    },
    loading: false,
    error: null,
    run: () => {},
  }),
  useUnitsyncGameInfo: () => ({
    info: {
      sides: [],
      unitCount: mockUnits.length,
      units: [],
      options: [],
      errors: [],
    },
    loading: false,
  }),
  useUnitsyncUnitDataset: () => ({
    dataset: { units: mockUnits, errors: [] },
    status: "ready",
  }),
  // Keys the result by exactly the id(s) it was handed, the way the real
  // worker keys its map with exactly the string it was passed (it does not
  // lowercase anything itself). This is what makes a fetch/read key mismatch
  // in the page visible: fetching under the dataset's original-case name but
  // reading under the lowercased route param would look up a key this mock
  // never populated.
  useUnitsyncUnitBuildpics: (
    _enginePath?: string,
    _dataDir?: string,
    _gameArchive?: string,
    units?: string[],
  ) =>
    units && units.length > 0
      ? {
          units: Object.fromEntries(
            units
              .filter((u) => u !== mockNoIconId)
              .map((u) => [u, { icon: mockIconSrc }]),
          ),
        }
      : null,
  useUnitsyncUnitModel: () =>
    mockModelPending
      ? { model: null, loading: true, failed: false }
      : { model: null, loading: false, failed: false },
}));

const { default: GameUnitPage } = await import("./GameUnitPage");

afterEach(cleanup);

interface UnitFixture {
  name: string;
  fullName?: string;
  buildOptions?: string[];
  morphTargets?: ({ into: string } & Record<string, unknown>)[];
  mobile?: boolean;
  footprintX?: number;
  footprintZ?: number;
  maxSlope?: number;
  floatOnWater?: boolean;
  minWaterDepth?: number;
  maxWaterDepth?: number;
}

function renderUnit(
  id: string,
  units: UnitFixture[],
  opts: {
    modelPending?: boolean;
    renders?: Record<
      string,
      { angle: string; status: string; url?: string; message?: string }
    >;
  } = {},
) {
  mockUnits = units as UnitDatasetEntry[];
  mockModelPending = opts.modelPending ?? false;
  mockRenders = opts.renders ?? {};
  return render(
    <MemoryRouter
      initialEntries={[
        `/content/games/${encodeURIComponent(GAME_NAME)}/units/${id}`,
      ]}
    >
      <Routes>
        <Route
          path="/content/games/:name/units/:unit"
          element={<GameUnitPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GameUnitPage", () => {
  it("names the unit and shows its def key", async () => {
    renderUnit("armsolar", [{ name: "armsolar", fullName: "Solar Collector" }]);
    expect(
      await screen.findByRole("heading", { name: "Solar Collector" }),
    ).toBeTruthy();
    expect(screen.getByText("armsolar")).toBeTruthy();
  });

  it("has no close control of its own: the page's own breadcrumb is the only way back", async () => {
    // The hero used to be `UnitModelPanel`, whose close button read as a
    // cross even though it navigated rather than closed anything. The page
    // has its own "Back" link already, so there is nothing here to relabel.
    renderUnit("armsolar", [{ name: "armsolar", fullName: "Solar Collector" }]);
    await screen.findByRole("heading", { name: "Solar Collector" });
    expect(screen.queryByLabelText("Close model view")).toBeNull();
    expect(screen.queryByLabelText("Back to the units grid")).toBeNull();
    expect(screen.getByRole("link", { name: /back/i })).toBeTruthy();
  });

  it("shows all four rendered angles, each labelled", async () => {
    renderUnit(
      "armsolar",
      [{ name: "armsolar", fullName: "Solar Collector" }],
      {
        renders: {
          top: { angle: "top", status: "ready", url: "armsolar-top.webp" },
          front: { angle: "front", status: "drawing" },
          side: { angle: "side", status: "checking" },
          angled: {
            angle: "angled",
            status: "unavailable",
            message: "This unit's definition names no model.",
          },
        },
      },
    );
    await screen.findByRole("heading", { name: "Solar Collector" });

    expect(screen.getByText("Top down")).toBeTruthy();
    expect(screen.getByText("Front")).toBeTruthy();
    expect(screen.getByText("Side")).toBeTruthy();
    expect(screen.getByText("Angled")).toBeTruthy();

    // The one angle already drawn shows its picture rather than a status word.
    const img = screen.getByAltText("Top down render of this unit");
    expect(img.getAttribute("src")).toBe("armsolar-top.webp");

    // A render this unit has none of says so, rather than showing a broken
    // image or nothing at all.
    expect(
      screen.getByText("This unit's definition names no model."),
    ).toBeTruthy();
  });

  it("is readable while the model is still loading", async () => {
    // The model hook never resolves here. Leading with the model is a layout
    // decision, so everything the dataset already holds must be on screen anyway.
    // Task 4 adds the stats and relationships below this, and they inherit the
    // same guarantee.
    renderUnit(
      "armsolar",
      [{ name: "armsolar", fullName: "Solar Collector" }],
      { modelPending: true },
    );
    expect(
      await screen.findByRole("heading", { name: "Solar Collector" }),
    ).toBeTruthy();
    expect(screen.getByText("armsolar")).toBeTruthy();
  });

  it("says plainly when the game has no such unit", async () => {
    renderUnit("nosuchunit", [{ name: "armsolar" }]);
    expect(await screen.findByText(/not in this game/i)).toBeTruthy();
  });

  it("fetches and reads the buildpic under the same key, even when the dataset's def key isn't lowercase", async () => {
    // The dataset entry's own name is mixed-case, as a game may write it. The
    // route param ("armsolar") is always lowercase. A page that fetched with
    // `unit.name` but read with the lowercased id would ask the mock for
    // "ArmSolar" and look up "armsolar", missing every time.
    const { container } = renderUnit("armsolar", [
      { name: "ArmSolar", fullName: "Solar Collector" },
    ]);
    await screen.findByRole("heading", { name: "Solar Collector" });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(mockIconSrc);
  });

  it("shows a picture card, not plain text, for what it builds and what builds it", async () => {
    renderUnit("armlab", [
      { name: "armcom", fullName: "Commander", buildOptions: ["armlab"] },
      { name: "armlab", fullName: "Bot Lab", buildOptions: ["armpw"] },
      { name: "armpw", fullName: "Peewee" },
    ]);
    const built = await screen.findByRole("link", { name: "Peewee" });
    expect(built.querySelector("img")?.getAttribute("src")).toBe(mockIconSrc);
    const builder = screen.getByRole("link", { name: "Commander" });
    expect(builder.querySelector("img")?.getAttribute("src")).toBe(mockIconSrc);
  });

  it("lists a unit's whole upgrade path with what the game asks for at each step", async () => {
    renderUnit("fedcommander", [
      {
        name: "fedcommander",
        fullName: "Commander",
        morphTargets: [
          { into: "fedcommander_up1", research: 150, require: "tech1" },
        ],
      },
      { name: "fedcommander_up1", fullName: "Commander Tech 1" },
    ]);
    expect(
      await screen.findByRole("heading", { name: "Upgrade path" }),
    ).toBeTruthy();
    // The card's own label carries the def key too now, so this matches on
    // the name rather than the whole (now longer) accessible name.
    expect(screen.getByRole("link", { name: /Commander Tech 1/ })).toBeTruthy();
    expect(screen.getByText(/research/i)).toBeTruthy();
    expect(screen.getByText(/150/)).toBeTruthy();
  });

  it("tells apart a unit's morph stages even when the game names them all the same", async () => {
    // SplinterFaction's real commander (issue #2063): every tech level reads
    // "Federation of Kala Command Unit", so the def key and the build pic on
    // each card are the only things left that tell one stage from another.
    const SHARED_NAME = "Federation of Kala Command Unit";
    renderUnit("fedcommander_up1", [
      {
        name: "fedcommander",
        fullName: SHARED_NAME,
        morphTargets: [{ into: "fedcommander_up1" }],
      },
      {
        name: "fedcommander_up1",
        fullName: SHARED_NAME,
        morphTargets: [{ into: "fedcommander_up2", research: 150 }],
      },
      { name: "fedcommander_up2", fullName: SHARED_NAME },
    ]);
    const heading = await screen.findByRole("heading", {
      name: "Upgrade path",
    });
    // biome-ignore lint/style/noNonNullAssertion: the heading's own section is always its parent
    const section = within(heading.closest("section")!);

    // All three stages are on the page, distinguished by their def keys. (The
    // page's identity block above also prints the current stage's id, so
    // these three are checked against the upgrade-path section alone rather
    // than the whole page.)
    expect(section.getByText("fedcommander")).toBeTruthy();
    expect(section.getByText("fedcommander_up1")).toBeTruthy();
    expect(section.getByText("fedcommander_up2")).toBeTruthy();

    // The stage a reader is already on is not a link to itself.
    expect(
      section.queryByRole("link", { name: /fedcommander_up1/ }),
    ).toBeNull();
    expect(section.getByText("Current")).toBeTruthy();

    // The stage before and after it still link onward, to different pages.
    const earlier = section.getByRole("link", { name: /fedcommander$/ });
    const later = section.getByRole("link", { name: /fedcommander_up2/ });
    expect(earlier.getAttribute("href")).not.toBe(later.getAttribute("href"));

    // The edge condition into the current stage is still shown.
    expect(section.getByText(/research/i)).toBeTruthy();
    expect(section.getByText("150")).toBeTruthy();
  });

  it("shows the same placeholder as the rest of the page for a build target with no build picture", async () => {
    renderUnit("armlab", [
      { name: "armlab", fullName: "Bot Lab", buildOptions: [mockNoIconId] },
      { name: mockNoIconId, fullName: "Unpictured Target" },
    ]);
    const card = await screen.findByRole("link", {
      name: "Unpictured Target",
    });
    expect(card.querySelector("img")).toBeNull();
  });

  it("lists a builder once even when its buildOptions repeats the target", async () => {
    // A builder whose own `buildOptions` names this unit twice used to push
    // itself onto the reverse index twice, giving "What builds it" two
    // identical entries under one duplicate React key.
    renderUnit("armpw", [
      {
        name: "armlab",
        fullName: "Bot Lab",
        buildOptions: ["armpw", "armpw"],
      },
      { name: "armpw", fullName: "Peewee" },
    ]);
    await screen.findByRole("heading", { name: "Peewee" });
    expect(screen.getAllByRole("link", { name: "Bot Lab" })).toHaveLength(1);
  });

  it("shows where a building may stand, under a heading a player understands", async () => {
    renderUnit("armsolar", [
      {
        name: "armsolar",
        mobile: false,
        footprintX: 4,
        footprintZ: 4,
        maxSlope: 10,
        floatOnWater: false,
      },
    ]);
    expect(
      await screen.findByRole("heading", { name: "Where it can be built" }),
    ).toBeTruthy();
    expect(screen.queryByText("Where it stands")).toBeNull();
    expect(screen.getByText(/4 by 4/)).toBeTruthy();
  });

  it("shows no terrain section for a mobile unit", async () => {
    // footprintX, footprintZ and floatOnWater are always present on the
    // wire, mobile or not (model.rs declares them as plain fields, not
    // optional ones), so a presence check alone would show this section on
    // every unit's page. Gating on `mobile` is what keeps a Peewee from
    // reporting whether it floats.
    renderUnit("armpw", [
      {
        name: "armpw",
        fullName: "Peewee",
        mobile: true,
        footprintX: 2,
        footprintZ: 2,
        floatOnWater: false,
      },
    ]);
    await screen.findByRole("heading", { name: "Peewee" });
    expect(screen.queryByText(/2 by 2/)).toBeNull();
    expect(screen.queryByText("Floats")).toBeNull();
  });

  it("treats the engine's water-depth sentinel as no limit, not a real bound", async () => {
    // -10e6/10e6 is the engine's own "no limit" default (bindings.ts), not a
    // declared restriction. A unit carrying only the sentinel on both bounds
    // gets no water depth row at all.
    renderUnit("armsolar", [
      {
        name: "armsolar",
        mobile: false,
        minWaterDepth: -10e6,
        maxWaterDepth: 10e6,
      },
    ]);
    await screen.findByRole("heading", { name: "armsolar" });
    expect(screen.queryByText("Water depth")).toBeNull();
  });

  it("shows a real water depth limit as a plain number, not the engine's unit or its sentinel bound", async () => {
    renderUnit("armsolar", [
      {
        name: "armsolar",
        mobile: false,
        minWaterDepth: -10e6,
        maxWaterDepth: 40,
      },
    ]);
    await screen.findByRole("heading", { name: "armsolar" });
    expect(screen.getByText("Water depth")).toBeTruthy();
    expect(screen.getByText("40 deep")).toBeTruthy();
  });

  it("does not claim the rest block's label as a unit's faction", async () => {
    // The mocked game info reports no sides, so every unit falls into
    // `factionGroups`'s unheaded rest block (id "", label "Other units").
    // That block is not a faction, so the page must say nothing here rather
    // than print the rest block's own label.
    renderUnit("armsolar", [{ name: "armsolar", fullName: "Solar Collector" }]);
    await screen.findByRole("heading", { name: "Solar Collector" });
    expect(screen.queryByText("Other units")).toBeNull();
  });
});
