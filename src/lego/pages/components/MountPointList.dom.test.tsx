// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type LegoPiece, type LegoProject, newProject } from "../../model";

import { MountPointList } from "./MountPointList";

afterEach(cleanup);

const hull: LegoPiece = {
  id: "hull",
  name: "hull",
  parentId: "root",
  partId: null,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  mountPoints: [{ connector: "+y", name: "Turret", accepts: ["Turret"] }],
};

const base = newProject({
  id: "p",
  rootPieceId: "root",
  name: "tank",
  packId: "lego",
  packVersion: "1",
  now: "2026-10-18T00:00:00Z",
});
const project: LegoProject = {
  ...base,
  pieces: [
    ...base.pieces,
    hull,
    {
      ...hull,
      id: "gun",
      name: "Cannon",
      parentId: "hull",
      mountPoints: undefined,
      connection: { connector: "-y", to: "+y" },
    },
  ],
};

const connectors = [
  { id: "+y", label: "top" },
  { id: "-y", label: "bottom" },
];

describe("MountPointList", () => {
  it("shows the name, the categories and what sits on the mount", () => {
    render(
      <MountPointList
        piece={hull}
        project={project}
        connectors={connectors}
        onMark={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText("Mount point name") as HTMLInputElement).value,
    ).toBe("Turret");
    expect(screen.getByText("top: Cannon")).toBeTruthy();
  });

  it("saves the categories typed, split on commas", () => {
    const onChange = vi.fn();
    render(
      <MountPointList
        piece={hull}
        project={project}
        connectors={connectors}
        onMark={vi.fn()}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    const field = screen.getByLabelText("Categories Turret takes");
    fireEvent.change(field, { target: { value: "Turret, Side weapon" } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledWith("+y", {
      accepts: ["Turret", "Side weapon"],
    });
  });

  it("unmarks a mount point", () => {
    const onRemove = vi.fn();
    render(
      <MountPointList
        piece={hull}
        project={project}
        connectors={connectors}
        onMark={vi.fn()}
        onChange={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unmark Turret" }));
    expect(onRemove).toHaveBeenCalledWith("+y");
  });
});
