// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addLoadout } from "../../loadouts";
import { type LegoProject, newProject } from "../../model";
import { LoadoutPicker } from "./LoadoutPicker";

afterEach(cleanup);

const BASE: LegoProject = {
  ...newProject({
    id: "p",
    rootPieceId: "root",
    name: "tank",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  }),
};
BASE.pieces.push({
  id: "gun",
  name: "gun",
  parentId: "root",
  partId: null,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

let n = 0;
const TWO = addLoadout(BASE, { newId: () => `l${++n}`, name: "Rockets" });

function open(project: LegoProject, selectedId: string | null = null) {
  const onEdit = vi.fn();
  render(
    <LoadoutPicker project={project} selectedId={selectedId} onEdit={onEdit} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Loadouts" }));
  const applied = () =>
    (onEdit.mock.calls[0][0] as (p: LegoProject) => LegoProject)(project);
  return { onEdit, applied };
}

describe("LoadoutPicker", () => {
  it("offers no switch on a unit without loadouts, and adds one as its own step", () => {
    const { onEdit, applied } = open(BASE);
    expect(screen.queryByRole("combobox", { name: "Loadout" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onEdit.mock.calls[0][1]).toEqual({ alone: true });
    expect(applied().loadouts).toHaveLength(2);
  });

  it("shows the active loadout in the switch", () => {
    open(TWO);
    expect(
      screen.getByRole("combobox", { name: "Loadout" }).textContent,
    ).toContain("Rockets");
  });

  it("deletes a loadout", () => {
    const { applied } = open(TWO);
    fireEvent.click(screen.getByRole("button", { name: "Delete Rockets" }));
    expect(applied().loadouts).toBeUndefined();
  });

  it("makes the selected piece this loadout's own", () => {
    const { applied } = open(TWO, "gun");
    fireEvent.click(screen.getByRole("button", { name: "Only Rockets" }));
    expect(applied().pieces.find((p) => p.id === "gun")?.inLoadout).toBe(true);
  });

  it("locks a loadout from its row", () => {
    const { applied } = open(TWO);
    const lock = screen.getByRole("button", { name: "Lock Rockets" });
    expect(lock.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(lock);
    expect(applied().loadouts?.find((l) => l.name === "Rockets")?.locked).toBe(
      true,
    );
  });

  it("says a loadout is locked, and by which module", () => {
    const held = {
      ...TWO,
      pieces: TWO.pieces.map((p) =>
        p.id === "gun" ? { ...p, module: { id: "m1", instance: "i" } } : p,
      ),
      lockedModules: ["m1"],
    };
    const onEdit = vi.fn();
    render(
      <LoadoutPicker
        project={held}
        selectedId={null}
        onEdit={onEdit}
        moduleNames={new Map([["m1", "Rocket pod"]])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Loadouts" }));
    expect(screen.getAllByText("Locked by Rocket pod")).toHaveLength(2);
    expect(
      screen.getByRole("combobox", { name: "Loadout" }).textContent,
    ).toContain("(locked)");
    expect(
      screen
        .getByRole("button", { name: "Lock module Rocket pod" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("locks and frees a module", () => {
    const held = {
      ...TWO,
      pieces: TWO.pieces.map((p) =>
        p.id === "gun" ? { ...p, module: { id: "m1", instance: "i" } } : p,
      ),
    };
    const { applied } = open(held);
    fireEvent.click(screen.getByRole("button", { name: "Lock module m1" }));
    expect(applied().lockedModules).toEqual(["m1"]);
  });
});
