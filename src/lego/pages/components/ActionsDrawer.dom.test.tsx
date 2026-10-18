// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LegoProject } from "../../model";
import { newProject } from "../../model";
import { ActionsDrawer } from "./ActionsDrawer";

afterEach(cleanup);

function piece(name: string) {
  return {
    id: name,
    name,
    parentId: "root",
    partId: null,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  };
}

const BASE = newProject({
  id: "p",
  rootPieceId: "root",
  name: "mech",
  packId: "lego",
  packVersion: "1",
  now: "2026-10-18T00:00:00Z",
});

const ACTION = {
  id: "a",
  name: "Plant",
  trigger: "StartMoving",
  loop: true,
  keys: [
    { pose: "up", seconds: 1 },
    { pose: "out", seconds: 2 },
  ],
};

const PROJECT: LegoProject = {
  ...BASE,
  pieces: [...BASE.pieces, piece("arm")],
  poses: [
    { id: "up", name: "Raised", pieces: { arm: { turn: [1, 0, 0] } } },
    { id: "out", name: "Swung", pieces: { arm: { turn: [0, 1, 0] } } },
  ],
  actions: [ACTION],
};

function open(project = PROJECT) {
  const onEdit = vi.fn();
  const onPlay = vi.fn();
  render(
    <ActionsDrawer
      project={project}
      actionId="a"
      onOpenChange={vi.fn()}
      onEdit={onEdit}
      onPlay={onPlay}
      playing={false}
    />,
  );
  return { onEdit, onPlay };
}

/** The project an edit produces from the one on screen. */
function applied(onEdit: ReturnType<typeof vi.fn>): LegoProject {
  const change = onEdit.mock.calls[0][0] as (p: LegoProject) => LegoProject;
  return change(PROJECT);
}

describe("ActionsDrawer", () => {
  it("lists the keys with their times and the length", () => {
    open();
    expect(screen.getByLabelText("Seconds to reach key 1")).toHaveProperty(
      "value",
      "1",
    );
    expect(screen.getByLabelText("Seconds to reach key 2")).toHaveProperty(
      "value",
      "2",
    );
    expect(screen.getByText("3 s")).toBeTruthy();
  });

  it("says which call-in stops a loop", () => {
    open();
    expect(screen.getByText("Stops on StopMoving.")).toBeTruthy();
  });

  it("times a key", () => {
    const { onEdit } = open();
    fireEvent.change(screen.getByLabelText("Seconds to reach key 2"), {
      target: { value: "1.5" },
    });
    expect(applied(onEdit).actions?.[0].keys[1].seconds).toBe(1.5);
  });

  it("removes and reorders keys", () => {
    const first = open();
    fireEvent.click(screen.getByRole("button", { name: "Remove key 1" }));
    expect(applied(first.onEdit).actions?.[0].keys.map((k) => k.pose)).toEqual([
      "out",
    ]);
    cleanup();
    const second = open();
    fireEvent.click(screen.getByRole("button", { name: "Move key 1 later" }));
    expect(applied(second.onEdit).actions?.[0].keys.map((k) => k.pose)).toEqual(
      ["out", "up"],
    );
  });

  it("turns looping off", () => {
    const { onEdit } = open();
    fireEvent.click(screen.getByRole("switch"));
    expect(applied(onEdit).actions?.[0].loop).toBe(false);
  });

  it("sets how long it eases in and out, and clears it back to the unit's time", () => {
    const { onEdit } = open({ ...PROJECT, actionBlend: 0.4 });
    const blendIn = screen.getByLabelText(
      "Seconds to ease in from where the pieces are",
    );
    expect(blendIn).toHaveProperty("placeholder", "0.4");
    fireEvent.change(blendIn, { target: { value: "0.25" } });
    expect(applied(onEdit).actions?.[0].blendIn).toBe(0.25);
    cleanup();
    const own = { ...PROJECT, actions: [{ ...ACTION, blendOut: 1 }] };
    const out = open(own);
    fireEvent.change(screen.getByLabelText("Seconds to ease back to rest"), {
      target: { value: "" },
    });
    const change = out.onEdit.mock.calls[0][0] as (
      p: LegoProject,
    ) => LegoProject;
    expect(change(own).actions?.[0]).not.toHaveProperty("blendOut");
  });

  it("plays the action", () => {
    const { onPlay } = open();
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    expect(onPlay).toHaveBeenCalledWith("a");
  });

  it("names a deleted pose rather than hiding the key", () => {
    open({ ...PROJECT, poses: [PROJECT.poses?.[1] as never] });
    expect(screen.getByText("Deleted pose")).toBeTruthy();
  });

  it("points a unit with no poses at where to save one", () => {
    open({
      ...PROJECT,
      poses: undefined,
      actions: [{ ...ACTION, keys: [] }],
    });
    expect(screen.getByText(/Save a pose first/)).toBeTruthy();
  });
});
