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
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnitDefsResult } from "@/content/bindings";

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

let mockDefs: UnitDefsResult = {
  units: {},
  weaponDefs: {},
  unitErrors: [],
  errors: [],
  checksum: "abc",
};
let mockStatus = "ready";
/** The curated dataset the page joins for names, keyed by internal def key. */
let mockDataset: { name: string; fullName?: string }[] = [];

vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => ({ selected: SELECTED }),
  useUnitsyncScan: () => ({
    data: { games: [GAME], maps: [] },
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
}));

vi.mock("../config", () => ({
  useUnitDefs: () => ({
    defs: mockDefs,
    status: mockStatus,
    error: null,
    reload: () => {},
    loading: mockStatus === "loading",
  }),
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

function show(
  units: Record<string, Record<string, unknown>> = { armcom: ARMCOM },
  entry = `/workshop?game=${encodeURIComponent(GAME.name)}&unit=armcom`,
  dataset: { name: string; fullName?: string }[] = [
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
});
