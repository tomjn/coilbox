// @vitest-environment happy-dom

/**
 * The weapon picker in the builder (issue #3274): what it says with no game,
 * what it offers once the game is read, and the stats and arc beside a pick.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_EDITS, type ModProject } from "@/workshop/project";
import { type LegoPiece, type LegoProject, newProject } from "../../model";
import { WeaponsSection } from "./WeaponsSection";

const testGame = vi.fn();
const unitDefs = vi.fn();
const modProjects = vi.fn();

vi.mock("./useTestGame", () => ({ useTestGame: () => testGame() }));
vi.mock("@/workshop/config", () => ({ useUnitDefs: () => unitDefs() }));
vi.mock("@/workshop/project", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/workshop/project")>()),
  useModProjects: () => modProjects(),
}));

const GAME = {
  name: "Splinter Faction 0.1.89",
  primaryArchive: {
    name: "SplinterFaction_0.1.89.sdd",
    path: "/games/SplinterFaction.sdd",
  },
};

const LIBRARY: ModProject = {
  id: "w1",
  name: "Lasers",
  gameName: GAME.name,
  edits: {
    ...EMPTY_EDITS,
    weapons: {
      laser_copy: { key: "laser_copy", source: "emg", def: { range: 300 } },
    },
  },
  createdAt: "",
  updatedAt: "",
};

function project(
  weapon?: LegoPiece["weapon"],
  over: Partial<LegoProject> = {},
): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Rover",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    imported: {
      source: "objects3d/a.s3o",
      game: {
        name: GAME.name,
        archive: GAME.primaryArchive.name,
        member: "objects3d/a.s3o",
      },
    } as LegoProject["imported"],
    pieces: [
      base.pieces[0],
      {
        ...base.pieces[0],
        id: "t",
        name: "turret",
        parentId: "root",
        role: "turret",
        ...(weapon ? { weapon } : {}),
      },
    ],
    ...over,
  };
}

const onWeaponChange = vi.fn();

function show(p: LegoProject) {
  render(<WeaponsSection project={p} onWeaponChange={onWeaponChange} />);
}

beforeEach(() => {
  testGame.mockReturnValue({
    target: { enginePath: "/e", dataDir: "/d" },
    targetLoading: false,
    scan: { data: { games: [GAME] } },
  });
  unitDefs.mockReturnValue({
    defs: {
      units: {},
      weaponDefs: {
        armpw_emg: { range: 400, reloadtime: 1.5, damage: { default: 120 } },
      },
    },
    defsFor: GAME.primaryArchive.name,
    status: "ready",
    error: null,
  });
  modProjects.mockReturnValue({ projects: [LIBRARY] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WeaponsSection", () => {
  it("shows nothing on a unit with no turret or aim point", () => {
    const p = project();
    show({ ...p, pieces: [p.pieces[0]] });
    expect(screen.queryByText("Weapons")).toBeNull();
  });

  it("says a game is needed only once the picker is opened", () => {
    show(project(undefined, { imported: undefined }));
    expect(screen.queryByText(/Choose a game for this unit first/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Weapon for turret" }));
    expect(screen.getByText("Choose a game for this unit first.")).toBeTruthy();
  });

  it("offers the library and the game's weapons, and picks one", () => {
    show(project());
    expect(screen.getByText(", fires nothing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Weapon for turret" }));
    expect(screen.getByText("Lasers")).toBeTruthy();
    expect(screen.getByText("laser_copy")).toBeTruthy();
    fireEvent.click(screen.getByText("armpw_emg"));
    expect(onWeaponChange).toHaveBeenCalledWith("t", {
      fires: { from: "game", name: "armpw_emg" },
    });
  });

  it("offers the weapons of the game a unit of parts records (#3257)", () => {
    show(
      project(undefined, {
        imported: undefined,
        game: { name: GAME.name, archive: GAME.primaryArchive.name },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Weapon for turret" }));
    expect(screen.getByText("armpw_emg")).toBeTruthy();
  });

  it("does not fall back to the export folder for a unit for no game", () => {
    show(
      project(undefined, {
        imported: undefined,
        game: null,
        exported: {
          dir: GAME.primaryArchive.path ?? "",
          at: "2026-10-17T00:00:00Z",
          unitName: "rover",
          def: {},
          files: [],
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Weapon for turret" }));
    expect(screen.getByText("Choose a game for this unit first.")).toBeTruthy();
  });

  it("shows the picked weapon's numbers and takes an arc", () => {
    show(project({ fires: { from: "game", name: "armpw_emg" } }));
    expect(screen.getByText(", weapon 1")).toBeTruthy();
    expect(
      screen.getByText("Range 400, 120 damage, reloads in 1.5s"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Facing, degrees right")).toBeNull();
    fireEvent.change(screen.getByLabelText("Arc, degrees"), {
      target: { value: "180" },
    });
    expect(onWeaponChange).toHaveBeenCalledWith("t", {
      fires: { from: "game", name: "armpw_emg" },
      arc: 180,
    });
  });

  it("asks where a narrower arc faces", () => {
    show(project({ fires: { from: "game", name: "armpw_emg" }, arc: 90 }));
    expect(screen.getByLabelText("Facing, degrees right")).toBeTruthy();
  });

  it("says when a library weapon's project is gone", () => {
    modProjects.mockReturnValue({ projects: [] });
    show(
      project({ fires: { from: "library", projectId: "w1", key: "laser" } }),
    );
    expect(screen.getByText("Its workshop project is gone.")).toBeTruthy();
  });
});
