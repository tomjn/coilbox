// @vitest-environment happy-dom

/**
 * The family view (issue #3283), opened from the loadout picker: a column per
 * loadout, the rows that differ marked, the rest behind a switch, and a click
 * on a column switching to it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { duplicateLoadout, switchLoadout } from "../../loadouts";
import { type LegoProject, newProject } from "../../model";
import { LoadoutPicker } from "./LoadoutPicker";

vi.mock("./WeaponsSection", () => ({
  useWeaponSource: () => ({
    gameName: null,
    weaponDefs: null,
    projects: [],
    unavailable: null,
  }),
}));

vi.mock("./useBuildMenuSource", () => ({
  useBuildMenuSource: () => ({
    gameName: null,
    gameFolder: null,
    units: null,
    checksum: undefined,
    installed: [],
    unavailable: "Choose a game for this unit first.",
  }),
}));
vi.mock("@/workshop/project", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/workshop/project")>()),
  useModProjects: () => ({ projects: [] }),
}));

afterEach(cleanup);

function chassis(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Tank",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  const at = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  return {
    ...base,
    unitName: "tank",
    pieces: [
      ...base.pieces,
      {
        id: "hull",
        name: "hull",
        parentId: "root",
        partId: null,
        ...at,
        mountPoints: [
          { connector: "top", name: "Turret", accepts: ["gun"] },
          { connector: "side", name: "Pod", accepts: ["pod"] },
        ],
      },
      {
        id: "cannon",
        name: "cannon",
        parentId: "hull",
        partId: null,
        ...at,
        inLoadout: true,
        connection: { connector: "base", to: "top" },
      },
    ] as LegoProject["pieces"],
  };
}

let n = 0;
function two(): LegoProject {
  const made = duplicateLoadout(chassis(), { newId: () => `l${++n}` });
  const renamed = {
    ...made,
    pieces: made.pieces.map((p) =>
      p.id === "cannon" ? { ...p, name: "rocket" } : p,
    ),
  };
  return switchLoadout(renamed, made.loadouts?.[0].id as string);
}

function show(project: LegoProject) {
  const onEdit = vi.fn();
  render(<LoadoutPicker project={project} selectedId={null} onEdit={onEdit} />);
  return onEdit;
}

describe("the family view", () => {
  it("is not offered for a unit with one loadout or none", () => {
    show(chassis());
    expect(
      screen.queryByRole("button", { name: "Compare loadouts" }),
    ).toBeNull();
    cleanup();
    const one = { ...chassis(), loadouts: [{ id: "a", name: "A" }] };
    show({ ...one, activeLoadout: "a" });
    expect(
      screen.queryByRole("button", { name: "Compare loadouts" }),
    ).toBeNull();
  });

  it("shows a column per loadout with its name and export name", () => {
    show(two());
    fireEvent.click(screen.getByRole("button", { name: "Compare loadouts" }));
    expect(
      screen.getByRole("button", { name: "Switch to Loadout 1" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Switch to Loadout 1 copy" }),
    ).toBeTruthy();
    expect(screen.getByText("tank_loadout_1")).toBeTruthy();
    expect(screen.getByText("tank_loadout_1_copy")).toBeTruthy();
  });

  it("shows the mount that differs and hides the one that does not", () => {
    show(two());
    fireEvent.click(screen.getByRole("button", { name: "Compare loadouts" }));
    expect(screen.getByText("Turret")).toBeTruthy();
    expect(screen.getByText("cannon")).toBeTruthy();
    expect(screen.getByText("rocket")).toBeTruthy();
    expect(screen.queryByText("Pod")).toBeNull();

    fireEvent.click(screen.getByLabelText("Show 1 identical row"));
    expect(screen.getByText("Pod")).toBeTruthy();
  });

  it("says so when the loadouts are the same", () => {
    show(duplicateLoadout(chassis(), { newId: () => `s${++n}` }));
    fireEvent.click(screen.getByRole("button", { name: "Compare loadouts" }));
    expect(screen.getByText("These loadouts are the same.")).toBeTruthy();
  });

  it("switches to the loadout whose column is clicked", () => {
    const project = two();
    const onEdit = show(project);
    fireEvent.click(screen.getByRole("button", { name: "Compare loadouts" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to Loadout 1 copy" }),
    );
    expect(onEdit.mock.calls[0][1]).toEqual({ alone: true });
    const applied = (
      onEdit.mock.calls[0][0] as (p: LegoProject) => LegoProject
    )(project);
    expect(applied.activeLoadout).toBe(project.loadouts?.[1].id);
  });
});
