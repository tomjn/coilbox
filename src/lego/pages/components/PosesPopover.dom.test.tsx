// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type LegoProject, newProject } from "../../model";
import { PosesPopover } from "./PosesPopover";

afterEach(cleanup);

const BASE: LegoProject = {
  ...newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  }),
  poses: [{ id: "a", name: "Raised", pieces: { gone: { turn: [1, 0, 0] } } }],
};

function open(options: { posing?: boolean; changed?: boolean } = {}) {
  const handlers = {
    onPosingChange: vi.fn(),
    onSave: vi.fn(),
    onApply: vi.fn(),
    onOverwrite: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onReset: vi.fn(),
  };
  render(
    <PosesPopover
      project={BASE}
      posing={options.posing ?? false}
      changed={options.changed ?? false}
      {...handlers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Poses" }));
  return handlers;
}

describe("PosesPopover", () => {
  it("switches the posing mode on and off", () => {
    const { onPosingChange } = open();
    fireEvent.click(screen.getByRole("button", { name: "Pose the unit" }));
    expect(onPosingChange).toHaveBeenCalledWith(true);
  });

  it("offers a name and a save only while posing, and only for a changed pose", () => {
    open();
    expect(screen.queryByLabelText("Pose name")).toBeNull();
  });

  it("saves the held pose under the typed name", () => {
    const { onSave } = open({ posing: true, changed: true });
    fireEvent.change(screen.getByLabelText("Pose name"), {
      target: { value: "Crouch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("Crouch");
  });

  it("will not save a pose that matches the built shape", () => {
    open({ posing: true, changed: false });
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("applies, duplicates and deletes a pose", () => {
    const { onApply, onDuplicate, onDelete } = open();
    fireEvent.click(screen.getByRole("button", { name: "Apply Raised" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Raised" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Raised" }));
    expect(onApply).toHaveBeenCalledWith("a");
    expect(onDuplicate).toHaveBeenCalledWith("a");
    expect(onDelete).toHaveBeenCalledWith("a");
  });

  it("renames a pose when the field is left", () => {
    const { onRename } = open();
    const field = screen.getByLabelText("Name of Raised");
    fireEvent.change(field, { target: { value: "Arms up" } });
    fireEvent.blur(field);
    expect(onRename).toHaveBeenCalledWith("a", "Arms up");
  });

  it("overwrites only while posing a changed pose", () => {
    const first = open();
    expect(
      (
        screen.getByRole("button", {
          name: "Overwrite Raised",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(first.onOverwrite).not.toHaveBeenCalled();
    cleanup();

    const { onOverwrite } = open({ posing: true, changed: true });
    fireEvent.click(screen.getByRole("button", { name: "Overwrite Raised" }));
    expect(onOverwrite).toHaveBeenCalledWith("a");
  });

  it("says how many of a pose's pieces have been deleted", () => {
    open();
    expect(screen.getByText("1 piece deleted")).toBeTruthy();
  });
});
