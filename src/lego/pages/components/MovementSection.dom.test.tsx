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
const OTHER_GAME = {
  name: "Metal Factions",
  primaryArchive: { name: "MetalFactions.sdz" },
};

/** A unit imported from Splinter Faction, so it belongs to that game. */
const IMPORTED = {
  source: "objects3d/a.s3o",
  game: {
    name: GAME.name,
    archive: GAME.primaryArchive.name,
    member: "objects3d/a.s3o",
  },
} as LegoProject["imported"];

function haveGame() {
  testGame.mockReturnValue({
    target: { enginePath: "/e", dataDir: "/d" },
    targetLoading: false,
    scan: { data: { games: [GAME, OTHER_GAME] } },
    // The Test drawer's pick. A unit's movement must not follow it.
    game: OTHER_GAME,
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
    imported: IMPORTED,
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
  it("offers nothing to a unit with no game, whatever the Test drawer picked", () => {
    render(
      <MovementSection
        project={project("wheel", { imported: undefined })}
        bounds={BOUNDS}
        onMovementChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "This unit has no game, so there are no movement classes to offer.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Metal Factions/)).toBeNull();
  });

  it("does not take the folder a unit was exported into as its game", () => {
    render(
      <MovementSection
        project={project("wheel", {
          imported: undefined,
          exported: {
            dir: "/games/SplinterFaction.sdd",
            at: "2026-10-16T00:00:00Z",
            unitName: "rover",
            def: {},
            files: [],
          },
        })}
        bounds={BOUNDS}
        onMovementChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "This unit has no game, so there are no movement classes to offer.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("reads the unit's imported game, not the Test drawer's", () => {
    render(
      <MovementSection
        project={project("wheel")}
        bounds={BOUNDS}
        onMovementChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Splinter Faction 0.1.89's vehicle classes, from its movedefs.lua",
      ),
    ).toBeTruthy();
  });

  it("says a game that is not installed cannot be read", () => {
    testGame.mockReturnValue({
      target: { enginePath: "/e", dataDir: "/d" },
      targetLoading: false,
      scan: { data: { games: [OTHER_GAME] } },
      game: OTHER_GAME,
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
        "Splinter Faction 0.1.89 is not installed, so there are no movement classes to read.",
      ),
    ).toBeTruthy();
  });

  it("keeps a stored class on a unit with no game and says it is not from one", () => {
    const onMovementChange = vi.fn();
    render(
      <MovementSection
        project={project("wheel", {
          imported: undefined,
          movement: { moveClass: "TANK9", speed: 50 },
        })}
        bounds={BOUNDS}
        onMovementChange={onMovementChange}
      />,
    );
    expect(
      screen.getByText(
        "TANK9 is not from this unit's game, because it has none.",
      ),
    ).toBeTruthy();
    expect(onMovementChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("combobox", { name: "Movement class" }),
    ).toBeTruthy();
  });

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
        "Splinter Faction 0.1.89 is not installed, so there are no movement classes to read.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("offers a legged build the vehicle classes and says the game has no walker class", () => {
    render(
      <MovementSection
        project={project("leg.l1.thigh")}
        bounds={BOUNDS}
        onMovementChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Splinter Faction 0.1.89 has no walker class, so these are its nearest kind",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Movement class" }),
    ).toBeTruthy();
  });

  it("says when none of the game's classes fit the build", () => {
    haveDefs([{ name: "SHIP3" }]);
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

  it("edits acceleration and brake rate, and clearing one drops its note", () => {
    const onMovementChange = vi.fn();
    render(
      <MovementSection
        project={project("wheel", {
          movement: {
            moveClass: "WHEELEDTANK2",
            speed: 120,
            acceleration: 0.5,
            accelerationFrom: "Median of 2 SF units on WHEELEDTANK2",
          },
        })}
        bounds={BOUNDS}
        onMovementChange={onMovementChange}
      />,
    );
    expect(
      screen.getByText("Median of 2 SF units on WHEELEDTANK2"),
    ).toBeTruthy();
    expect(
      screen.getByText("Not set, the engine brakes at the acceleration"),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Brake rate/), {
      target: { value: "0.075" },
    });
    expect(onMovementChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ brakeRate: 0.075, acceleration: 0.5 }),
    );
    fireEvent.change(screen.getByLabelText(/^Acceleration/), {
      target: { value: "" },
    });
    const cleared = onMovementChange.mock.calls.at(-1)?.[0];
    expect(cleared).not.toHaveProperty("acceleration");
    expect(cleared).not.toHaveProperty("accelerationFrom");
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
