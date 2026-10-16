// @vitest-environment happy-dom

/**
 * The movement picker in the builder (issue #3255): what it says when it has no
 * game, when none of the game's classes fit, and what picking a class writes.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LegoProject, newProject } from "../../model";
import { MovementSection } from "./MovementSection";

const testGame = vi.fn();
const unitDefs = vi.fn();

vi.mock("./useTestGame", () => ({ useTestGame: () => testGame() }));
vi.mock("../../../workshop/config", () => ({
  useUnitDefs: () => unitDefs(),
}));

const GAME = {
  name: "Splinter Faction 0.1.89",
  primaryArchive: { name: "SplinterFaction_0.1.89.sdz" },
};

function haveGame() {
  testGame.mockReturnValue({
    target: { enginePath: "/e", dataDir: "/d" },
    targetLoading: false,
    scan: { data: { games: [GAME] } },
    game: GAME,
  });
}

function haveDefs(moveDefs: unknown[]) {
  unitDefs.mockReturnValue({
    defs: {
      moveDefs,
      units: {
        lozdiamondback: {
          canmove: true,
          movementclass: "WHEELEDTANK2",
          speed: 120,
          turnrate: 600,
        },
      },
    },
    defsFor: GAME.primaryArchive.name,
    status: "ready",
    error: null,
  });
}

function project(role: string, over: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Rover",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-16T00:00:00Z",
  });
  return {
    ...base,
    pieces: [{ ...base.pieces[0], role }],
    ...over,
  };
}

const BOUNDS = {
  mid: [0, 0, 0] as [number, number, number],
  sizeX: 32,
  sizeY: 10,
  sizeZ: 32,
};

beforeEach(() => {
  haveGame();
  haveDefs([{ name: "WHEELEDTANK2", footprintx: 2 }, { name: "SHIP3" }]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MovementSection", () => {
  it("says when there is no game to read classes from", () => {
    testGame.mockReturnValue({
      target: { enginePath: "/e", dataDir: "/d" },
      targetLoading: false,
      scan: { data: { games: [] } },
      game: undefined,
    });
    unitDefs.mockReturnValue({
      defs: null,
      defsFor: null,
      status: "idle",
      error: null,
    });
    render(
      <MovementSection
        project={project("wheel")}
        bounds={BOUNDS}
        onMovementChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "No game is installed, so there is no game to read classes from.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("says when none of the game's classes fit the build", () => {
    render(
      <MovementSection
        project={project("leg.l1.thigh")}
        bounds={BOUNDS}
        onMovementChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Splinter Faction 0.1.89 has no walker movement class, so this unit does not move.",
      ),
    ).toBeTruthy();
  });

  it("writes the picked class with the game's own speed and turn rate", () => {
    const onMovementChange = vi.fn();
    render(
      <MovementSection
        project={project("wheel")}
        bounds={BOUNDS}
        onMovementChange={onMovementChange}
      />,
    );
    expect(
      screen.getByText(
        "Splinter Faction 0.1.89's vehicle classes, from its movedefs.lua",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "Movement class" }));
    expect(screen.queryByRole("option", { name: /SHIP3/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /WHEELEDTANK2/ }));
    expect(onMovementChange).toHaveBeenCalledWith({
      moveClass: "WHEELEDTANK2",
      speed: 120,
      turnRate: 600,
      speedFrom: "Median of 1 Splinter Faction 0.1.89 units on WHEELEDTANK2",
      turnRateFrom: "Median of 1 Splinter Faction 0.1.89 units on WHEELEDTANK2",
    });
  });

  it("says when the classes come off the unit table instead", () => {
    haveDefs([]);
    render(
      <MovementSection
        project={project("wheel")}
        bounds={BOUNDS}
        onMovementChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Classes Splinter Faction 0.1.89's units use, not narrowed by kind: its movedefs.lua could not be read",
      ),
    ).toBeTruthy();
  });

  it("flags a stored class the game does not declare", () => {
    render(
      <MovementSection
        project={project("wheel", {
          movement: { moveClass: "TANK9", speed: 50 },
        })}
        bounds={BOUNDS}
        onMovementChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Splinter Faction 0.1.89 has no TANK9 class, so the engine drops this unit at load. Pick another.",
      ),
    ).toBeTruthy();
  });

  it("drops where a number came from once it is set by hand", () => {
    const onMovementChange = vi.fn();
    render(
      <MovementSection
        project={project("wheel", {
          movement: {
            moveClass: "WHEELEDTANK2",
            speed: 120,
            speedFrom: "Median of 1",
          },
        })}
        bounds={BOUNDS}
        onMovementChange={onMovementChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Speed/), {
      target: { value: "80" },
    });
    expect(onMovementChange).toHaveBeenCalledWith({
      moveClass: "WHEELEDTANK2",
      speed: 80,
    });
  });
});
