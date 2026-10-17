// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LegoGuide, LegoProject } from "../../model";
import { newProject } from "../../model";
import { GuidesPopover } from "./GuidesPopover";

afterEach(cleanup);

const BASE: LegoProject = newProject({
  id: "p",
  rootPieceId: "root",
  name: "walker",
  packId: "lego",
  packVersion: "1",
  now: "2026-10-17T00:00:00Z",
});

function open(guides: LegoGuide[] = [], symmetryPlane = false) {
  const onEdit = vi.fn();
  const onPick = vi.fn();
  render(
    <GuidesPopover
      guides={guides}
      onEdit={onEdit}
      picking={null}
      onPick={onPick}
      symmetryPlane={symmetryPlane}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Guides" }));
  /** The unit as it is after the one edit the panel asked for. */
  const applied = (project: LegoProject = BASE) =>
    (onEdit.mock.calls[0][0] as (p: LegoProject) => LegoProject)(project);
  return { onEdit, onPick, applied };
}

const GUIDE: LegoGuide = { id: "g", name: "wheel line", axis: "x", offset: 12 };

describe("GuidesPopover", () => {
  it("adds a guide on the chosen axis at the typed offset", () => {
    const { applied } = open();
    fireEvent.click(screen.getByRole("button", { name: "Z axis" }));
    fireEvent.change(screen.getByLabelText("Offset"), {
      target: { value: "-4.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(applied().guides).toMatchObject([{ axis: "z", offset: -4.5 }]);
  });

  it("will not add a guide with no usable offset", () => {
    open();
    fireEvent.change(screen.getByLabelText("Offset"), {
      target: { value: "far" },
    });

    expect(
      (screen.getByRole("button", { name: "Add" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renames a guide", () => {
    const { applied } = open([GUIDE]);
    const field = screen.getByLabelText("Name of wheel line");
    fireEvent.change(field, { target: { value: "axle" } });
    fireEvent.blur(field);

    expect(applied({ ...BASE, guides: [GUIDE] }).guides?.[0].name).toBe("axle");
  });

  it("moves a guide by editing its number", () => {
    const { applied } = open([GUIDE]);
    const field = screen.getByLabelText("Offset of wheel line");
    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.blur(field);

    expect(applied({ ...BASE, guides: [GUIDE] }).guides?.[0].offset).toBe(20);
  });

  it("hides and shows a guide", () => {
    const { applied } = open([GUIDE]);
    fireEvent.click(screen.getByRole("button", { name: "Hide wheel line" }));

    expect(applied({ ...BASE, guides: [GUIDE] }).guides?.[0].hidden).toBe(true);
  });

  it("deletes a guide", () => {
    const { applied } = open([GUIDE]);
    fireEvent.click(screen.getByRole("button", { name: "Delete wheel line" }));

    expect("guides" in applied({ ...BASE, guides: [GUIDE] })).toBe(false);
  });

  it("arms a click on the model for the chosen axis and closes", () => {
    const { onPick } = open();
    fireEvent.click(screen.getByRole("button", { name: "Y axis" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Click the model to place it" }),
    );

    expect(onPick).toHaveBeenCalledWith({ kind: "plane", axis: "y" });
    expect(screen.queryByLabelText("Offset")).toBeNull();
  });

  it("adds a line along the chosen axis through the typed point", () => {
    const { applied } = open();
    fireEvent.click(screen.getByRole("button", { name: "line" }));
    fireEvent.click(screen.getByRole("button", { name: "Z axis" }));
    fireEvent.change(screen.getByLabelText("X position"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Y position"), {
      target: { value: "-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(applied().guides).toMatchObject([
      { kind: "line", axis: "z", point: [3, -2, 0] },
    ]);
  });

  it("arms a click on the model for a line", () => {
    const { onPick } = open();
    fireEvent.click(screen.getByRole("button", { name: "line" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Click the model to place it" }),
    );

    expect(onPick).toHaveBeenCalledWith({ kind: "line", axis: "x" });
  });

  it("moves a line by editing a coordinate", () => {
    const line: LegoGuide = {
      id: "l",
      name: "axle",
      kind: "line",
      axis: "z",
      point: [3, 2, 0],
    };
    const { applied } = open([line]);
    const field = screen.getByLabelText("Y of axle");
    fireEvent.change(field, { target: { value: "7" } });
    fireEvent.blur(field);

    expect(applied({ ...BASE, guides: [line] }).guides?.[0].point).toEqual([
      3, 7, 0,
    ]);
  });

  it("lists the symmetry plane as locked, with nothing to edit or delete", () => {
    open([], true);

    expect(screen.getByText("Symmetry (x = 0)")).toBeTruthy();
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.queryByLabelText(/Delete Symmetry/)).toBeNull();
    expect(screen.queryByLabelText(/Name of Symmetry/)).toBeNull();
  });

  it("does not list the symmetry plane unless symmetry is on", () => {
    open([GUIDE]);

    expect(screen.queryByText("Symmetry (x = 0)")).toBeNull();
  });
});
