// @vitest-environment happy-dom

/**
 * The fit check in the builder (issue #3305): what it says with no game, what
 * it reads when the unit is in the game, and where the fix link goes.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LegoProject, newProject } from "../../model";
import { GameFitSection } from "./GameFitSection";

const testGame = vi.fn();
const unitDefs = vi.fn();

vi.mock("./useTestGame", () => ({ useTestGame: () => testGame() }));
vi.mock("../../../workshop/config", () => ({
  useUnitDefs: () => unitDefs(),
}));
vi.mock("../../../workshop/project", () => ({
  useModProjects: () => ({ projects: [] }),
}));

const GAME = {
  name: "Splinter Faction 0.1.89",
  primaryArchive: {
    name: "SplinterFaction_0.1.89.sdd",
    path: "/games/SplinterFaction.sdd",
  },
};

const IMPORTED = {
  source: "objects3d/a.s3o",
  game: {
    name: GAME.name,
    archive: GAME.primaryArchive.name,
    member: "objects3d/a.s3o",
  },
} as LegoProject["imported"];

const BOUNDS = {
  mid: [0, 0, 0] as [number, number, number],
  sizeX: 32,
  sizeY: 10,
  sizeZ: 32,
};

function project(over: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Rover",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-16T00:00:00Z",
  });
  return { ...base, imported: IMPORTED, ...over };
}

function haveGame() {
  testGame.mockReturnValue({
    target: { enginePath: "/e", dataDir: "/d" },
    targetLoading: false,
    scan: { data: { games: [GAME] } },
  });
}

function haveDefs(units: Record<string, Record<string, unknown>>) {
  unitDefs.mockReturnValue({
    defs: {
      units,
      moveDefs: [{ name: "TANK2", speedmodclass: 0 }],
      armorDefs: { tanks: ["lozdiamondback"] },
    },
    defsFor: GAME.primaryArchive.name,
    status: "ready",
    error: null,
  });
}

function show(p: LegoProject) {
  render(
    <MemoryRouter>
      <GameFitSection project={p} bounds={BOUNDS} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  haveGame();
  haveDefs({
    lozdiamondback: {
      category: "TANK MOBILE",
      canmove: true,
      movementclass: "TANK2",
      speed: 90,
    },
    wall: { category: "BUILDING NOTAIR", canmove: false },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GameFitSection", () => {
  it("says a unit with no game cannot be checked", () => {
    show(project({ imported: undefined }));
    expect(
      screen.getByText("Choose a game for this unit to check it against."),
    ).toBeTruthy();
  });

  it("checks a unit of parts against the game it records (#3257)", () => {
    show(
      project({
        imported: undefined,
        game: { name: GAME.name, archive: GAME.primaryArchive.name },
      }),
    );
    expect(screen.getByText("As the builder would write it")).toBeTruthy();
  });

  it("says nothing can be checked for a unit for no game", () => {
    show(project({ game: null }));
    expect(
      screen.getByText("Choose a game for this unit to check it against."),
    ).toBeTruthy();
  });

  it("checks the definition the builder writes before the first export", () => {
    show(project());
    expect(screen.getByText("As the builder would write it")).toBeTruthy();
    expect(screen.getByText(/^Armour class: default/)).toBeTruthy();
    expect(screen.getByText(/^No category/)).toBeTruthy();
    expect(
      screen.getByText("Similar units use building, notair."),
    ).toBeTruthy();
    expect(screen.getByText("This unit does not move.")).toBeTruthy();
    expect(screen.queryByText("Change in Unit tweaks")).toBeNull();
  });

  it("reads the game's own entry once the unit is exported into it", () => {
    haveDefs({
      rover: {
        category: "TANK MOBILE",
        canmove: true,
        movementclass: "TANK2",
        speed: 50,
      },
      lozdiamondback: { category: "TANK MOBILE" },
    });
    show(
      project({
        exported: {
          dir: "/games/SplinterFaction.sdd",
          at: "2026-10-16T00:00:00Z",
          unitName: "rover",
          def: {},
          files: [],
        },
      }),
    );
    expect(screen.getByText("From the exported file")).toBeTruthy();
    expect(screen.getByText("Category: tank mobile.")).toBeTruthy();
    expect(screen.getByText("Movement class: TANK2.")).toBeTruthy();
    const link = screen.getByText("Change in Unit tweaks");
    expect(link.getAttribute("href")).toContain("unit=rover");
  });

  it("says when the game could not be read", () => {
    unitDefs.mockReturnValue({
      defs: null,
      defsFor: null,
      status: "error",
      error: "worker missing",
    });
    show(project());
    expect(
      screen.getByText(
        "Could not read Splinter Faction 0.1.89: worker missing",
      ),
    ).toBeTruthy();
  });
});
