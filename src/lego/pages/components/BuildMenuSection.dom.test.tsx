// @vitest-environment happy-dom

/**
 * Variants on a build menu (issue #3288): the exported loadouts are offered,
 * the rest say to export first, and adding or removing writes the workshop's
 * own operations into the game's project, making one when the game has none.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyBuildMenu } from "@/workshop/buildMenus";
import {
  EMPTY_EDITS,
  type GameEdits,
  type ModProject,
} from "@/workshop/project";
import { type LegoExport, type LegoProject, newProject } from "../../model";
import { BuildMenuSection } from "./BuildMenuSection";

const source = vi.fn();
const createProject = vi.fn();
const applyEdits = vi.fn();
let projects: ModProject[] = [];

vi.mock("./useBuildMenuSource", () => ({ useBuildMenuSource: () => source() }));
vi.mock("@/workshop/project", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/workshop/project")>()),
  useModProjects: () => ({ projects, createProject, applyEdits }),
}));

const FOLDER = "/games/SF.sdd";
const GAME = "Splinter Faction 0.1.89";

const receipt = (unitName: string): LegoExport =>
  ({ dir: FOLDER, at: "", unitName, def: {}, files: [] }) as LegoExport;

function chassis(): LegoProject {
  return {
    ...newProject({
      id: "p",
      rootPieceId: "root",
      name: "Tank",
      packId: "lego",
      packVersion: "1",
      now: "2026-10-18T00:00:00Z",
    }),
    loadouts: [
      { id: "a", name: "Basic", exported: receipt("tank_basic") },
      {
        id: "b",
        name: "Medium",
        upgradesFrom: "a",
        exported: receipt("tank_medium"),
      },
      { id: "c", name: "Heavy", upgradesFrom: "b" },
    ],
  };
}

function ready(over: Record<string, unknown> = {}) {
  source.mockReturnValue({
    gameName: GAME,
    gameFolder: FOLDER,
    units: { sflab: { name: "Lab", buildoptions: ["sfscout"] } },
    checksum: "sum",
    installed: [],
    unavailable: null,
    ...over,
  });
}

function saved(edits: GameEdits = EMPTY_EDITS): ModProject {
  return {
    id: "w1",
    name: "My tweaks",
    gameName: GAME,
    edits,
    createdAt: "",
    updatedAt: "",
  };
}

/** The edits a call to applyEdits would produce from the project's own. */
function applied(from: GameEdits): GameEdits {
  const update = applyEdits.mock.calls[0][1] as (e: GameEdits) => GameEdits;
  return update(from);
}

beforeEach(() => {
  projects = [];
  createProject.mockReset();
  applyEdits.mockReset();
  ready();
});
afterEach(cleanup);

describe("the build menu section", () => {
  it("offers exported loadouts and says to export the rest first", () => {
    render(<BuildMenuSection project={chassis()} />);
    expect(screen.getByLabelText("Basic")).toBeTruthy();
    expect(screen.getByLabelText("Medium")).toBeTruthy();
    expect(screen.queryByLabelText("Heavy")).toBeNull();
    expect(screen.getByText("Heavy")).toBeTruthy();
    expect(screen.getAllByText("Export it first.")).toHaveLength(1);
  });

  it("says why when the game cannot be read", () => {
    ready({ unavailable: "Choose a game for this unit first." });
    render(<BuildMenuSection project={chassis()} />);
    expect(screen.getByText("Choose a game for this unit first.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("adds all the exported variants, in chain order, to the game's project", () => {
    projects = [saved()];
    render(<BuildMenuSection project={chassis()} />);
    expect(screen.getByText("Saved in My tweaks.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(applyEdits.mock.calls[0][0]).toBe("w1");
    expect(applied(EMPTY_EDITS).menus.sflab).toEqual([
      { op: "add", unit: "tank_basic" },
      { op: "add", unit: "tank_medium" },
    ]);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("adds only the variants ticked", () => {
    projects = [saved()];
    render(<BuildMenuSection project={chassis()} />);
    fireEvent.click(screen.getByLabelText("Medium"));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(applied(EMPTY_EDITS).menus.sflab).toEqual([
      { op: "add", unit: "tank_medium" },
    ]);
  });

  it("removes variants that are on the menu", () => {
    projects = [
      saved({
        ...EMPTY_EDITS,
        menus: { sflab: [{ op: "add", unit: "tank_basic" }] },
      }),
    ];
    render(<BuildMenuSection project={chassis()} />);
    expect(screen.getByText("On the menu")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Add" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("Basic"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const after = applied(projects[0].edits);
    expect(after.menus).toEqual({});
    expect(applyBuildMenu(["sfscout"], after.menus.sflab ?? [])).toEqual([
      "sfscout",
    ]);
  });

  it("starts a project for a game with none, with the operations in it", () => {
    render(<BuildMenuSection project={chassis()} />);
    expect(screen.getByText(`Starts ${GAME} tweaks.`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(applyEdits).not.toHaveBeenCalled();
    const made = createProject.mock.calls[0][0];
    expect(made.name).toBe(`${GAME} tweaks`);
    expect(made.gameName).toBe(GAME);
    expect(made.authoredChecksum).toBe("sum");
    expect(made.edits.menus.sflab).toEqual([
      { op: "add", unit: "tank_basic" },
      { op: "add", unit: "tank_medium" },
    ]);
  });
});
