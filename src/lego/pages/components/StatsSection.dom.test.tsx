// @vitest-environment happy-dom

/**
 * The stats panel (issue #3293): the unit's own numbers, the game unit beside
 * them, the file's value for a field kept by hand, and the links to the unit
 * page once the unit is in a game.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LegoProject, newProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { legoUnitDef } from "../../unitDef";
import { worthTotals } from "../../worth";
import type { ReferenceUnit } from "./ReferencePicker";
import { StatsSection } from "./StatsSection";

const testGame = vi.fn();
const unitDefs = vi.fn();

vi.mock("./useTestGame", () => ({ useTestGame: () => testGame() }));
vi.mock("./WeaponsSection", () => ({
  useWeaponSource: () => ({
    gameName: null,
    weaponDefs: null,
    projects: [],
    unavailable: null,
  }),
}));
vi.mock("../../../workshop/config", () => ({
  useUnitDefs: (_engine: string, _data: string, archive: string) =>
    unitDefs(archive),
}));
let tweakProjects: unknown[] = [];
vi.mock("../../../workshop/project", () => ({
  useModProjects: () => ({ projects: tweakProjects }),
}));

const GAME = {
  name: "Splinter Faction 0.1.89",
  primaryArchive: {
    name: "SplinterFaction_0.1.89.sdd",
    path: "/games/SplinterFaction.sdd",
  },
};

const OTHER = {
  name: "Balanced Annihilation",
  primaryArchive: { name: "BA.sdd", path: "/games/BA.sdd" },
};

const BOUNDS = {
  mid: [0, 0, 0] as [number, number, number],
  sizeX: 32,
  sizeY: 10,
  sizeZ: 32,
};

const PACK = {} as LoadedPack;

const REFERENCE: ReferenceUnit = {
  gameName: OTHER.name,
  archive: OTHER.primaryArchive.name,
  unit: "armpw",
  label: "Peewee",
};

function project(over: Partial<LegoProject> = {}): LegoProject {
  return {
    ...newProject({
      id: "p",
      rootPieceId: "root",
      name: "Rover",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-16T00:00:00Z",
    }),
    ...over,
  };
}

/** What the last export wrote, for a unit with no parts. */
const WRITTEN = () =>
  legoUnitDef(project(), BOUNDS, "def", worthTotals(project(), PACK));

function exportedProject(): LegoProject {
  const base = project();
  return {
    ...base,
    exported: {
      dir: GAME.primaryArchive.path,
      at: "2026-10-16T00:00:00Z",
      unitName: base.unitName,
      def: WRITTEN(),
      files: [
        {
          path: `${GAME.primaryArchive.path}/units/${base.unitName}.lua`,
          sha256: "abc",
        },
      ],
    },
  };
}

function haveDefs(
  units: Record<string, Record<string, unknown>>,
  reference: Record<string, Record<string, unknown>> = {},
) {
  unitDefs.mockImplementation((archive: string) => {
    const table = archive === OTHER.primaryArchive.name ? reference : units;
    return {
      defs: { units: table, weaponDefs: {}, moveDefs: [], armorDefs: {} },
      defsFor: archive,
      status: "ready",
      error: null,
    };
  });
}

function show(p: LegoProject, reference: ReferenceUnit | null = null) {
  render(
    <MemoryRouter>
      <StatsSection
        project={p}
        pack={PACK}
        bounds={BOUNDS}
        reference={reference}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  tweakProjects = [];
  testGame.mockReturnValue({
    target: { enginePath: "/e", dataDir: "/d" },
    targetLoading: false,
    scan: { data: { games: [GAME, OTHER] } },
  });
  haveDefs({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StatsSection", () => {
  it("shows the unit's own numbers and marks a missing one", () => {
    show(project());
    expect(screen.getByLabelText("Cost").textContent).toBe(
      String(WRITTEN().buildcostmetal),
    );
    expect(screen.getByLabelText("Health").textContent).toBe(
      Number(WRITTEN().maxdamage).toLocaleString(),
    );
    expect(screen.getByLabelText("Speed").textContent).toBe("None");
    expect(screen.getByLabelText("DPS").textContent).toBe("None");
  });

  it("asks for a reference unit before it compares", () => {
    show(project());
    expect(screen.getByText(/Choose a game unit/)).toBeTruthy();
    expect(screen.queryByLabelText("Cost, Peewee")).toBeNull();
  });

  it("shows the reference unit's numbers beside the build's", () => {
    haveDefs({}, { armpw: { metalcost: 45, health: 250, speed: 120 } });
    show(project(), REFERENCE);
    expect(screen.getByLabelText("Cost, Peewee").textContent).toBe("45");
    expect(screen.getByLabelText("Health, Peewee").textContent).toBe("250");
    expect(screen.getByLabelText("Speed, Peewee").textContent).toBe("120");
    expect(screen.getByLabelText("DPS, Peewee").textContent).toBe("None");
  });

  it("says when the reference unit is not in its game", () => {
    show(project(), REFERENCE);
    expect(
      screen.getByText("Peewee is not in Balanced Annihilation."),
    ).toBeTruthy();
  });

  it("has no links before the unit is exported", () => {
    show(project());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links each number to its field once the unit is in a game", () => {
    haveDefs({ rover: { ...WRITTEN() } });
    show(exportedProject());
    const link = screen.getByLabelText("Health").querySelector("a");
    expect(link?.getAttribute("href")).toContain("unit=rover");
    expect(link?.getAttribute("href")).toContain("field=maxdamage");
  });

  it("shows the file's value for a field changed by hand", () => {
    haveDefs({ rover: { ...WRITTEN(), maxdamage: 2500 } });
    show(exportedProject());
    expect(screen.getByLabelText("Health").textContent).toBe("2,500");
    expect(screen.getByLabelText("Cost").textContent).toBe(
      String(WRITTEN().buildcostmetal),
    );
  });

  describe("a workshop change not in the unit's file", () => {
    /** A workshop project for the game, changing Rover's fields. */
    function tuning(
      overrides: Record<string, unknown>,
      mutatorOnly?: Record<string, string[]>,
      over: Record<string, unknown> = {},
    ) {
      return {
        id: "tune-1",
        name: "Tuning pass",
        gameName: GAME.name,
        edits: { overrides: { rover: overrides } },
        ...(mutatorOnly ? { mutatorOnly } : {}),
        ...over,
      };
    }

    const marks = (label: string) =>
      screen
        .getByLabelText(label)
        .parentElement?.querySelectorAll("a[aria-label^='Changed to']") ?? [];

    it("marks a number a project changes, naming the project and value", () => {
      haveDefs({ rover: { ...WRITTEN() } });
      tweakProjects = [tuning({ maxdamage: 1400 })];
      show(exportedProject());
      const [mark] = marks("Health");
      expect(mark?.getAttribute("aria-label")).toBe(
        "Changed to 1400 in the workshop project Tuning pass, not written into the game yet.",
      );
      expect(mark?.getAttribute("href")).toBe(
        "/workshop/tune-1?unit=rover&field=maxdamage",
      );
      expect(marks("Cost")).toHaveLength(0);
    });

    it("marks nothing once the file holds the project's value", () => {
      haveDefs({ rover: { ...WRITTEN(), maxdamage: 1400 } });
      tweakProjects = [tuning({ maxdamage: 1400 })];
      show(exportedProject());
      expect(marks("Health")).toHaveLength(0);
    });

    it("marks a change sent through the mutator as one that stays out of the file", () => {
      haveDefs({ rover: { ...WRITTEN() } });
      tweakProjects = [tuning({ maxdamage: 1400 }, { rover: ["maxdamage"] })];
      show(exportedProject());
      const [mark] = marks("Health");
      expect(mark?.getAttribute("aria-label")).toContain(
        "sent through the mutator, so it is not written into the game",
      );
    });

    it("marks each project that changes the field", () => {
      haveDefs({ rover: { ...WRITTEN() } });
      tweakProjects = [
        tuning({ maxdamage: 1400 }),
        tuning({ maxdamage: 1800 }, undefined, { id: "tune-2", name: "Bulk" }),
      ];
      show(exportedProject());
      expect(marks("Health")).toHaveLength(2);
    });

    it("ignores a project for another game", () => {
      haveDefs({ rover: { ...WRITTEN() } });
      tweakProjects = [
        tuning({ maxdamage: 1400 }, undefined, { gameName: "BA" }),
      ];
      show(exportedProject());
      expect(marks("Health")).toHaveLength(0);
    });

    it("shows nothing for a unit that was never exported", () => {
      tweakProjects = [tuning({ maxdamage: 1400 })];
      show(project());
      expect(marks("Health")).toHaveLength(0);
    });
  });
});
