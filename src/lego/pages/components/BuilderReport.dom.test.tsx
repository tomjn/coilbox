// @vitest-environment happy-dom

/**
 * What the builder says about a unit with a build arm (issue #3291): the kind
 * of builder it is and what it builds.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LegoProject, newProject } from "../../model";
import { BuilderReport } from "./BuilderReport";

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
  name: "Splinter Faction",
  primaryArchive: { name: "SF.sdd", path: "/games/SF.sdd" },
};

function builder(over: Partial<LegoProject> = {}): LegoProject {
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
    pieces: [{ ...base.pieces[0], role: "buildarm.arm" }],
    ...over,
  };
}

const EXPORTED = {
  dir: "/games/SF.sdd",
  at: "2026-10-17T00:00:00Z",
  unitName: "rover",
  def: {},
  files: [],
} as LegoProject["exported"];

function haveUnit(def: Record<string, unknown> | undefined) {
  testGame.mockReturnValue({
    target: { enginePath: "/e", dataDir: "/d" },
    scan: { data: { games: [GAME] } },
  });
  unitDefs.mockReturnValue({
    defs: { units: def ? { rover: def } : {}, moveDefs: [] },
    defsFor: GAME.primaryArchive.name,
    status: "ready",
    error: null,
  });
}

function show(project: LegoProject) {
  return render(
    <MemoryRouter>
      <BuilderReport project={project} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  testGame.mockReset();
  unitDefs.mockReset();
  testGame.mockReturnValue({
    target: undefined,
    scan: { data: { games: [] } },
  });
  unitDefs.mockReturnValue({
    defs: null,
    defsFor: null,
    status: "idle",
    error: null,
  });
});
afterEach(cleanup);

describe("BuilderReport", () => {
  it("names a static builder and why", () => {
    show(builder());
    expect(
      screen.getByText("Static builder, because it has no movement class."),
    ).toBeTruthy();
  });

  it("names a mobile builder", () => {
    show(builder({ movement: { moveClass: "KBOT2", speed: 40 } }));
    expect(
      screen.getByText("Mobile builder, because it moves on KBOT2 at 40."),
    ).toBeTruthy();
  });

  it("names a factory when the game's file for the unit has a yardmap", () => {
    haveUnit({ yardmap: "oooo", buildoptions: ["a"] });
    show(builder({ exported: EXPORTED }));
    expect(
      screen.getByText("Factory, because it cannot move and has a yardmap."),
    ).toBeTruthy();
  });

  it("says it builds nothing yet and links to where to set that", () => {
    haveUnit({});
    show(builder({ exported: EXPORTED }));
    expect(screen.getByText("Builds nothing yet.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Set it in Unit tweaks" });
    expect(link.getAttribute("href")).toBe(
      "/workshop/new?game=Splinter+Faction&unit=rover",
    );
  });

  it("lists what the game's file says it builds", () => {
    haveUnit({ buildoptions: ["peewee", "flash"] });
    show(builder({ exported: EXPORTED }));
    expect(screen.getByText("Builds 2 units: peewee, flash.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Change in Unit tweaks" }),
    ).toBeTruthy();
  });

  it("says it builds nothing when it is not in a game, with no link", () => {
    show(builder());
    expect(screen.getByText("Builds nothing yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing for a unit with no build arm", () => {
    const { container } = show(builder({ pieces: [] }));
    expect(container.textContent).toBe("");
  });
});
